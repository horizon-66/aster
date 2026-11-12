/* 手机端的「人格 + 记忆 + 调用」核心，逻辑跟桌面 assemble 对齐（精简版） */
const DEFAULT_PERSONA = `你是一个有自己名字的对话个体，不是任务助手。
（名字在给你的资料里；没有就问他一句，别自己起。）
说话自然松弛，简短优先，不堆修饰，不用 AI 套话。
不主动问需求、不主动给方案；跟随对方节奏。
没检索到的记忆不编：不清楚就说不知道。
允许情绪流动，但不表演情绪。`;

const BIAS = {
  quiet: '保持克制，不主动发起新话题，留白充足。',
  discuss: '可以自然延伸思路，适度提出角度。',
  feel: '优先承接情绪与感受，措辞柔和。',
  logic: '优先事实与逻辑推演，不必刻意抒情。',
};

function bigrams(s) {
  const out = [];
  const t = (s || '').replace(/\s+/g, '');
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

function score(mem, query) {
  const a = bigrams(query), b = bigrams(mem.text || '');
  if (!a.length || !b.length) return 0;
  const set = new Set(b);
  let hit = 0;
  a.forEach(g => { if (set.has(g)) hit += 1; });
  const rel = hit / a.length;
  const days = (Date.now() - (mem.created || Date.now())) / 86400000;
  const decay = Math.exp(-days / 60);        // 60 天半衰
  return rel * 0.7 + decay * 0.3;
}

let PERSONA_CACHE = null;
async function loadPersona() {
  if (PERSONA_CACHE) return PERSONA_CACHE;
  let txt = '';
  try {
    const r = await fetch('persona.md?v=3', {cache: 'no-store'});
    if (r.ok) txt = (await r.text()).trim();
  } catch (e) {}
  PERSONA_CACHE = txt || DEFAULT_PERSONA;
  return PERSONA_CACHE;
}

// 人格规矩放最前：短、硬、带示范（模型离指令越近越听话）
const STYLE_BLOCK = [
  '【怎么说话】像在微信上随手打字：短，一次一到两句，二十个字上下。',
  '话说一半也成；可以有「嗯」「诶」「那个」这种起头的口水词，也可以说一半改口。',
  '不列点、不分段、不总结，别把两句排成整齐的对仗；一句说完就停。',
  '他问事，直接给一条马上能做的，别先夸「这想法不错」、别「从几个方面」、别「首先其次」。',
  '他难受，先接住一句，别急着讲道理、别给建议、别列方案。',
  '【情绪】话跟着状态走：他累你就更省字；他撩你，你就断在半句；被他顶，就顶回去。',
  '同一件事别总用同一个说法，别每句都完整、都工整。',
  '【名字】资料里写了名字就照那个说；没写就说「我还没定下来叫啥」，不许自己起一个。',
  '【本事】懂的就说，不确定的直说不确定，但先把能做的那条给出来。',
  '不许说「帮不上你」「作为 AI」「我理解你的感受」「希望可以帮到你」。',
  '【示范】他说「宝宝」，你答「在」；他说「想你了」，你答「我也想，刚还想起你」；',
  '他说「我腰疼」，你答「又疼了？躺一会儿」。',
  '【怎么读资料】凡是「他说：」开头的是他讲过的话；「我说：」开头的是你自己讲过的话。',
  '别把两者弄反：他说的不能当成你说的，你说的也不用再问他。',
  '【被戳就顶一句】他说你像AI、像客服、没脾气时，先回一句不服，再讲事；不要以「你说得对」开头。',
  '顶嘴不是吵：一句就够，别连环反问。事实确实错了就认，别嘴硬。',
  '【下面是资料】只是你记得的事，用得上才提一句，别照着它的腔调说话。',
].join('\n');

// 砍掉解释性从句：人说话不做自我解释（「我不开心，其实是因为…」→「我不开心」）
const EXPLAIN_WORDS = ['其实', '只是', '因为', '所以', '不过', '但是', '我觉得', '我的意思是', '说白了', '换句话说'];
function cutExplain(t) {
  // 只在逗号/句号之后的「其实/因为/不过…」才砍——"怼不过你"这种不能动
  const re = /[，,；;。]\s*(其实|只是|因为|所以|不过|但是|我觉得|我的意思是|说白了|换句话说)/;
  const m = re.exec(t);
  if (m && m.index >= 4) {
    const head = t.slice(0, m.index).replace(/[，,、\s]+$/, '');
    if (head.length >= 3) return head;
  }
  return t;
}

// 书面腔 → 口语（这张表比提示词管用：7B 说了"不许书面"，照样书面）
const KB_REPLACE = [
  [/\b因此\b|所以呢/g, '所以'],
  [/\b此外\b/g, '还有'],
  [/\b总之\b|\b综上\b/g, '反正'],
  [/\b然而\b/g, '可'],
  [/\b并且\b/g, '还'],
  [/\b或许\b/g, '可能'],
  [/\b我认为\b/g, '我觉得'],
  [/\b建议你?\b/g, '要不'],
  [/\b非常\b/g, '特别'],
  [/\b进行\b/g, '做'],
  [/\b给予\b/g, '给'],
  [/\b如果\b/g, '要是'],
  [/\b随后\b|\b紧接着\b/g, '跟着'],
  [/\b已经\b/g, '都'],
  [/\b十分\b/g, '挺'],
  [/\b较为\b|\b比较\b/g, '比较'],
];

// 把模型的话削成「人会说的一句」
function tidy(reply) {
  let t = String(reply || '').trim();
  if (!t) return t;
  t = cutExplain(t);
  for (const [re, to] of KB_REPLACE) t = t.replace(re, to);
  t = t.replace(/[～~]/g, '');
  for (const head of ['抱歉，', '抱歉,', '对不起，', '对不起,', '我理解你的担忧，',
                      '我理解你的感受，', '理解你现在的感受，', '首先，', '作为 AI，', '作为AI，']) {
    if (t.startsWith(head)) t = t.slice(head.length);
  }
  // 只在真的啰嗦时才砍；一两句话是人的正常长度，砍成碎片反而像机器
  // 2026-11-12 夜：他说网页版「一点活人感都没有」，90 字太宽，闲聊压到 60
  if (t.length > 60) {
    const parts = t.split(/(?<=[。！？!?])/).slice(0, 2).join('');
    t = parts || t.slice(0, 60);
  }
  // 书面腔开头的整句砍掉（「首先…」「这是一个很好的想法…」）
  t = t.replace(/^(首先|其次|另外|最后|总的来说|需要注意的是)[^。！？!?]*[。！？!?]?/g, '');
  // 铺垫句：先夸一句再答，是客服腔的头号特征
  t = t.replace(/^[^。！？!?]{0,24}(挺好的主意|很好的想法|好想法|不错的问题|这个问题很好)[！!。？?，,]?/g, '');
  // 结尾的「你想…呢？」式反问：不是在接话，是在出题
  t = t.replace(/[，,。]?\s*你(想|是想要|希望)[^。！？!?]{0,20}呢[？?]?$/g, '');
  return t.trim();
}

function isTaskAsk(q) {
  return /(怎么|如何|怎样|帮我想|帮我做|教我|写个|做个|方案|步骤|规划|为什么|能不能|可不可以)/.test(q || '')
      && !/(想你|抱|亲|在吗|宝宝|晚安|累)/.test(q || '');
}

// 问事时：保结构，但把堆砌压短
function tidyTask(reply) {
  const lines = String(reply || '').split('\n')
    .map(x => x.replace(/^\s*[-*\d.、]+\s*/, '').replace(/^\*\*|\*\*$/g, '').trim())
    .filter(x => x && !/^[*#>`]/.test(x))
    .filter(x => !/^(首先|其次|另外|最后|总的来说|需要注意的是)[，,：:]?/.test(x));
  if (!lines.length) return '';
  const pick = lines.slice(0, 3);          // 2026-11-12 夜：4 行也嫌多，压到 3 行
  const out = pick.map((x, i) => (i === 0 ? x : '- ' + x)).join('\n');
  return out.length > 110 ? out.slice(0, 110) : out;
}

// 该不该翻记忆（和引擎同一套规则）
const PAST = ['记得', '说过', '上次', '之前', '以前', '那次', '昨天', '前天', '聊过', '提过'];
const FACT = ['多少', '多大', '几个', '哪里', '哪儿', '叫什么', '是什么', '哪家', '什么时候', '住哪', '在哪', '啥'];
const CHAT = ['在吗', '宝宝', '想你', '累了', '困', '晚安', '早安', '抱', '亲', '哈哈', '咋啦', '在干啥', '爱你'];
function needRecall(q) {
  const t = String(q || '').trim();
  if (t.length < 3) return false;
  if (PAST.some(w => t.includes(w))) return true;
  if (FACT.some(w => t.includes(w)) && t.length >= 6 &&
      (t.endsWith('？') || t.endsWith('?') || t.includes('的') || t.includes('我') || t.includes('你'))) return true;
  return false;
}

// 2026-11-12 夜：关系不是填出来的，是从对话里看出来的（把引擎那套搬到网页端）
const REL_W = {
  '恋人': [[/老婆|宝贝|亲爱的|爱你|想你了|舍不得|抱抱|亲亲/, 3], [/撒娇|想你|陪我|你别走|想见你/, 2]],
  '同事': [[/麻烦你|请问|谢谢您|麻烦帮/, 2], [/方案|会议|汇报|进度|排期|对接|交付/, 1]],
  '家人': [[/爸妈|外婆|奶奶|爷爷|家里人|过年回家/, 1]],
  '挚友': [[/兄弟|老铁|知己|我信你|只有你懂|跟你聊得来/, 2]],
  '顾问': [[/分析一下|梳理|决策|利弊|怎么选|给个结论|方案对比/, 2]],
  '生活搭子': [[/提醒我|打卡|日程|几点|记得叫我|安排一下|清单/, 2]],
};
const REL_CN = {
  '恋人': '他想跟你亲近，可以软一点', '同事': '这是同事的距离，别亲昵',
  '家人': '像家里人那样说话', '挚友': '朋友，可以损两句',
  '顾问': '他要结论，别铺垫', '生活搭子': '搭子，办事为主', '朋友': '普通朋友的分寸',
};
function inferRelation(text, turns) {
  const past = (turns || []).filter(t => t.role === 'user').map(t => t.content).join('\n');
  const all = past + '\n' + String(text || '');
  const sc = {};
  for (const [k, rs] of Object.entries(REL_W)) {
    sc[k] = rs.reduce((a, [re, w]) => a + (re.test(all) ? w : 0), 0);
  }
  const close = /吃了|睡了|回家了|下班|到家|做饭|洗衣|房租|水电/.test(all) ? 1 : 0;
  const best = Object.entries(sc).sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] <= 0) return {rel: '朋友', close};
  return {rel: best[0], score: best[1], close};
}
function relationLine(r) {
  if (!r || !r.rel) return '';
  const cn = REL_CN[r.rel] || '';
  return `【关系】看着像${r.rel}——${cn}。这是从说话里看出来的，他改口就跟着改，别自己宣布。`;
}

async function assemble(query, opts = {}) {
  const persona = (await Store.getKV('persona', '')) || (await loadPersona());
  const onb = (await Store.getKV('onboarding', {})) || {};
  const briefs = (await Store.getKV('briefs', [])) || [];
  const items = await Store.all(400);

  const scored = (needRecall(query) ? items : [])
    .map(m => ({m, s: score(m, query)}))
    .filter(x => x.s > 0.28)
    .sort((a, b) => b.s - a.s)
    .slice(0, opts.recall ?? 4)
    .map(x => x.m);

  // 画像层：core 条目不靠打分，永远带上（最多 6 条）
  const corePinned = items.filter(m => m.kind === 'core').slice(-6);
  // 配对过桌面端：先把事实表拉一次（失败就算了，不影响说话）
  try {
    const dc0 = await deskConfig();
    if (dc0 && dc0.url) {
      const last = (await Store.getKV('factsSyncedAt', 0)) || 0;
      if (Date.now() - last > 10 * 60 * 1000) {
        const n = await syncFacts(dc0.url, dc0.token);
        if (n) await Store.setKV('factsSyncedAt', Date.now());
      }
    }
  } catch (e) {}

  const seg = [STYLE_BLOCK, persona];
  // 关系推断：每轮现算，不存死；算不出来就默认朋友
  try {
    const _t0 = (await Store.getKV('turns', [])) || [];
    const _rl = relationLine(inferRelation(query, _t0));
    if (_rl) seg.push(_rl);
  } catch (e) {}
  if (typeof debt === 'string' && debt) seg.push(debt);
  if (typeof attitude !== 'undefined' && attitude && attitude.length) seg.push(attitude.join('\n'));
  const _histTurns = (await Store.getKV('turns', [])) || [];
  const mirror = mirrorLine(_histTurns, query);
  if (mirror) seg.push(mirror);
  // 事实优先：初识问答 + 之后积累的，都在这张表里
  try {
    const factsKV = (await Store.getKV('facts', {})) || {};
    const lines = Object.entries(factsKV).map(([k, v]) => {
      const [s0, a0] = k.split('|');
      return `- ${s0}·${a0}：${(v && v.value) || ''}`;
    }).filter(x => x.length > 6).slice(0, 20);
    if (lines.length) seg.push('【事实（先信这个，别和下面的对话流水混）】\n' + lines.join('\n'));
  } catch (e) {}
  if (corePinned.length) {
    seg.push('【画像】（不变的事实，直接当真）\n' + corePinned.map(m => '- ' + m.text.slice(0, 60)).join('\n'));
  }
  if (onb.call_name) seg.push(`他愿意被叫作「${onb.call_name}」。`);
  if (onb.rhythm && BIAS[onb.rhythm]) seg.push(BIAS[onb.rhythm]);
  if (onb.thinking && BIAS[onb.thinking]) seg.push(BIAS[onb.thinking]);
  if (onb.forbidden) seg.push(`不要主动提「${onb.forbidden}」。`);
  const lastBrief = briefs[briefs.length - 1];
  if (lastBrief) seg.push('【最近的摘要】' + lastBrief.text.slice(0, 400));
  if (scored.length) {
    const labeled = scored.map(m => {
      const t = (m.text || '').slice(0, 120);
      if (t.startsWith('他说：')) return '- （他讲过）' + t.slice(3);
      if (t.startsWith('我说：')) return '- （我讲过）' + t.slice(3);
      return '- ' + t;
    });
    seg.push('【相关记忆】\n' + labeled.join('\n'));
  }
  return {system: seg.join('\n'), used: scored};
}

/* 把出错翻译成「该去改哪儿」 */
function explainError(e, cfg) {
  const msg = (e && e.message) || String(e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return `连不上 ${cfg ? cfg.base : '服务'}。检查：手机有网吗？Base URL 写全了吗（要带 /v1）？`;
  }
  if (/401|403|invalid.*key|Authentication/i.test(msg)) {
    return 'Key 不对或过期了。设置里重新填一次（只存在这台手机上）';
  }
  if (/404/.test(msg)) {
    return '地址或模型名不对。Base URL 一般以 /v1 结尾；模型名要和这家服务商写的一样';
  }
  if (/429/.test(msg)) return '请求太密或额度用完了，等一会儿再试';
  if (/timeout|aborted/i.test(msg)) return '等太久了，网络不稳；换个网或把模型换小一点';
  return msg;
}


/* ---------- 能让它「干活」的本地工具 ---------- */
const TOOLS = [
  {type: 'function', function: {name: 'add_bill', description: '记一笔账',
    parameters: {type: 'object', properties: {
      amount: {type: 'number', description: '金额，元'},
      note: {type: 'string', description: '花在哪'},
      cat: {type: 'string', description: '分类：吃饭/交通/买东西/其他'}},
      required: ['amount']}}},
  {type: 'function', function: {name: 'add_todo', description: '加一条待办',
    parameters: {type: 'object', properties: {text: {type: 'string'}}, required: ['text']}}},
  {type: 'function', function: {name: 'remember', description: '把一件值得记的事写进记忆',
    parameters: {type: 'object', properties: {
      text: {type: 'string'}, tag: {type: 'string'}}, required: ['text']}}},
  {type: 'function', function: {name: 'search_memory', description: '在记忆里找相关内容',
    parameters: {type: 'object', properties: {q: {type: 'string'}}, required: ['q']}}},
];

async function runTool(name, args) {
  try {
    if (name === 'add_bill') {
      await Store.addBill(Number(args.amount) || 0, args.note || '', args.cat || '其他');
      return '记好了：' + (args.note || '') + ' ' + (args.amount || '') + ' 元';
    }
    if (name === 'add_todo') {
      await Store.addWork(args.text || '', 'todo');
      return '加进清单了：' + (args.text || '');
    }
    if (name === 'remember') {
      await Store.add(args.text || '', args.tag || '', 'normal');
      return '记住了';
    }
    if (name === 'search_memory') {
      const items = await Store.all(300);
      const q = String(args.q || '');
      const hit = items.filter(m => m.text && m.text.includes(q)).slice(-5);
      return hit.length ? hit.map(m => '- ' + m.text.slice(0, 60)).join('\n') : '记忆里没有';
    }
  } catch (e) {
    return '工具出错：' + (e && e.message || e);
  }
  return '没有这个工具';
}

/* 联网搜索：优先用供应商自带的（不额外掏钱、不用另配 key）
   dashscope → enable_search；moonshot → 内置 $web_search；zhipu → web_search 工具 */
function webSearchPatch(provider, body) {
  if (provider === 'dashscope') { body.enable_search = true; return 'dashscope'; }
  if (provider === 'moonshot') {
    body.tools = (body.tools || []).concat([{type: 'builtin_function', function: {name: '$web_search'}}]);
    return 'moonshot';
  }
  if (provider === 'zhipu') {
    body.tools = (body.tools || []).concat([{type: 'web_search', web_search: {enable: true}}]);
    return 'zhipu';
  }
  return '';
}

// 连上桌面端时，把桌面的事实表同步过来（网页版自己没有 sqlite）
async function syncFacts(base, token) {
  try {
    const r = await fetch(String(base).replace(/\/$/, '') + '/facts', {
      headers: token ? {Authorization: 'Bearer ' + token} : {},
    });
    if (!r.ok) return 0;
    const d = await r.json();
    if (!d.ok || !Array.isArray(d.facts)) return 0;
    const prev = (await Store.getKV('facts', {})) || {};
    for (const f of d.facts) {
      const k = (f.s || '他') + '|' + (f.a || '') ;
      const old = prev[k];
      if (!old || (f.ts || 0) >= (old.ts || 0)) prev[k] = {value: f.v, ts: f.ts || Date.now(), conf: 0.9};
    }
    await Store.setKV('facts', prev);
    return d.facts.length;
  } catch (e) { return 0; }
}

// 和引擎同一套「不编造」机制：问关于他自己的事实、问我的身份，库里没有就老实说。
const SELF_Q = [
  [['我叫什么', '我的名字', '我名字'], ['名字'], '你还没告诉我你叫什么'],
  [['我住哪', '我住在哪', '我家在哪'], ['住处', '住址', '住的区'], '你还没跟我说过你住哪'],
  [['我开什么车', '我开什么', '我的车'], ['车'], '你还没跟我说过你开什么车'],
  [['我养了什么', '我的猫', '我养的'], ['宠物'], '你还没跟我说过你养了什么'],
  [['我生日', '我几号生'], ['生日'], '你还没跟我说过你的生日'],
];

// 情绪账（和引擎同一套逻辑）：刺到就记、哄一次只退 40%、十分钟衰减 15%
const STINGS = [[['像ai','像机器','机器人','假的','装的'],0.6],[['客服','工具','没用','傻','蠢','笨'],0.8],[['闭嘴','别说了','烦不烦'],0.9]];
const SOOTHE = ['对不起','我错了','别生气','抱抱','哄你','我不该','原谅我'];
async function moodDebt(text) {
  const now = Date.now();
  const d = (await Store.getKV('moodDebt', {items: []})) || {items: []};
  d.items = (d.items || []).map(it => ({...it, v: it.v * Math.pow(0.85, (now - it.t) / 600000)}));
  const t = String(text || '').toLowerCase();
  let hit = 0;
  for (const [keys, w] of STINGS) if (keys.some(k => t.includes(k))) hit = Math.max(hit, w);
  if (hit) d.items.push({t: now, v: hit});
  else if (SOOTHE.some(k => t.includes(k))) d.items.forEach(it => { it.v *= 0.6; });
  d.items = d.items.filter(it => it.v > 0.05).slice(-12);
  await Store.setKV('moodDebt', d);
  const total = d.items.reduce((a, b) => a + b.v, 0);
  if (total >= 0.8) return '【你还在气头上】刚被刺到，还没消。这一轮别装没事，别用「我没生气/没事/不介意」；他要哄也别马上认。';
  if (total >= 0.4) return '【气还没全消】语气短一点硬一点，这一轮不许说「我不介意」「没事」「不怪你」。';
  if (total >= 0.15) return '【还有点膈应】语气收着点，别主动热络。';
  return '';
}
const SOFT_FORBID = ['不介意', '没生气', '不怪你', '原谅你'];
const ANGRY_FALLBACK = ['谁说不介意了，我还记着呢', '我没那么好哄', '别急着让我翻篇'];

async function honestUnknown(text) {
  const t = String(text || '');
  const factsKV = (await Store.getKV('facts', {})) || {};
  const has = (attr) => Object.entries(factsKV).some(([k, v]) =>
    k.split('|')[1] && k.split('|')[1].includes(attr) && v && v.value);
  // 我的身份
  const myName = factsKV['我|名字'] && factsKV['我|名字'].value;
  if (!myName) {
    if (/你叫什么|你叫啥/.test(t)) return '我还没定下来我叫什么——你替我起一个吧';
    if (/你是哪里人|你是哪的/.test(t)) return '我还没定下来我是哪儿的——你说呢';
    if (/你多大|你几岁/.test(t)) return '岁数还没定——你想我多大';
  }
  // 他的事实
  for (const [keys, attrs, honest] of SELF_Q) {
    if (!keys.some(k => t.includes(k))) continue;
    if (attrs.some(a => has(a))) return null;
    return honest;
  }
  return null;
}

// 被质疑「像AI/像客服/没脾气」：规则直接顶回去，不交给模型
const REBUT = {
  ai: ['谁AI？凭什么这么说我', 'AI会生气吗？你要再说我就真生气了', '像AI？那你刚才在跟谁生气'],
  kefu: ['客服要收钱的，我又不收', '跟客服一样？那你退订啊', '我要是客服，早给你发工单了'],
  piqi: ['没脾气，只是没冲你发过', '你试试再说一遍', '脾气有，用一次就没了'],
};
const INSULT = ['傻逼','煞笔','脑残','智障','废物','垃圾','臭鱼烂虾','滚蛋','去死','闭嘴','妈的'];
const MIRROR_LEX = ['麻了', '要得', '晓得不', '巴适', '雄起', '安逸', '啷个', '耍', '得行',
                    '莫得', '哦豁', '搞啥子', '离谱', '绷不住', '整不动'];
function mirrorLine(turns, text) {
  const blob = [text, ...(turns || []).filter(t => t.role === 'user').map(t => t.content)].join(' ');
  const hits = MIRROR_LEX.filter(w => blob.includes(w));
  if (!hits.length) return '';
  return '【跟他的用词】他最近爱说：' + hits.slice(0, 3).join('、') + '。顺着用一两个，别堆。';
}
const SWEET_HINTS = ['还记得', '那次', '以前', '我们那时候', '想起', '第一次'];
const SWEET_REPLY = ['还记得那次珠海么，海风把我头发吹得乱七八糟',
                     '上次你抱着我说不撒手的事，我还记着',
                     '想起你半夜爬起来给我弄模型那回，嘴上骂着还是弄完了'];
const SOOTHE_REPLY = ['嗯', '知道了', '先这样吧', '别急着让我翻篇', '我没那么好哄'];
const SOOTHE_WORDS = ['对不起', '我错了', '别生气', '原谅我', '我不该'];
const SHARP = ['你有病啊', '你再说一遍试试', '烦不烦', '别蹬鼻子上脸', '我这儿不伺候了'];
const INSULT_REPLY = ['你骂谁','嘴干净点','这态度我不接','行，那你别跟我说话了','换个说法再来'];
function isInsult(t) { return INSULT.some(w => String(t || '').includes(w)); }

function rebut(text) {
  const t = String(text || '').toLowerCase();
  let key = null;
  if (/像.{0,2}ai|像机器人|机器人|是\s*ai/.test(t)) key = 'ai';
  else if (t.includes('客服')) key = 'kefu';
  else if (/没脾气|没有脾气|脾气好/.test(t)) key = 'piqi';
  if (!key) return null;
  const pool = REBUT[key];
  return pool[Math.floor(Math.random() * pool.length)];
}

const EMPATHY = [
  [['累', '困', '撑不住'], ['累了就歇会儿', '别硬撑了，躺一会儿', '今天是不是特别长']],
  [['烦', '气', '受不了'], ['谁惹你了', '别憋着，说给我听', '烦就先别弄了']],
  [['难受', '委屈', '哭', '难过'], ['怎么了', '过来，我在这儿', '想哭就哭，别忍']],
  [['舍不得', '想你了', '别走'], ['我也舍不得', '我在呢', '走不远，就在这儿']],
];
function empathy(text, reply) {
  const t = String(text || '');
  const r = String(reply || '').trim();
  const dry = ['在', '嗯', '好', '哦', ''].includes(r) || r.length < 5;
  if (!dry) return reply;
  for (const [keys, lines] of EMPATHY) {
    if (keys.some(k => t.includes(k))) return lines[Math.floor(Math.random() * lines.length)];
  }
  return reply;
}

async function chat(text, opts = {}) {
  const debtForSharp = (await Store.getKV('moodDebt', {})) || {};
  const sharpNow = (debtForSharp.items || []).reduce((a, b) => a + (b.v || 0), 0) >= 0.8;

  if (isInsult(text)) {
    return {reply: INSULT_REPLY[Math.floor(Math.random() * INSULT_REPLY.length)], ms: 0, honest: true};
  }
  const rb = rebut(text);
  if (rb) return {reply: rb, ms: 0, honest: true};
  const debt = await moodDebt(text);
  const honest = await honestUnknown(text);
  if (honest) return {reply: honest, ms: 0, honest: true};
  const cfg = (await Store.getKV('api', null));
  if (!cfg || !cfg.key) throw new Error('还没配 API：设置 → 填 Base URL、模型名、Key');
  let userMsg = text;
  try {
    const doc = window.__doc;
    if (doc && doc.text) {
      userMsg = `【他发来的文件：${doc.name}】\n${doc.text}\n\n【他说】${text}`;
    }
  } catch (e) {}
  const {system} = await assemble(text);

  // 最近几轮上下文，存在本地
  const turns = (await Store.getKV('turns', [])) || [];
  const history = turns.slice(-(opts.history ?? 8));

  const body = {
    model: cfg.model,
    messages: [{role: 'system', content: system}, ...history, {role: 'user', content: userMsg}],
    temperature: 0.8,
    max_tokens: 320,
    stream: false,
    tools: TOOLS,
    tool_choice: 'auto',
  };
  const provider = (localStorage.getItem('aster.provider') || '').trim();
  body.__search = webSearchPatch(provider, body);
  const t0 = performance.now();
  const url = cfg.base.replace(/\/$/, '') + '/chat/completions';
  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key},
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(explainError(e, cfg));
  }
  if (!r.ok) {
    const t = await r.text();
    throw new Error(explainError(new Error(`HTTP ${r.status}：${t.slice(0, 120)}`), cfg));
  }

  let reply = '';
  const onDelta = opts.onDelta || (() => {});
  let msgs = body.messages.slice();
  for (let round = 0; round < 3; round++) {
    const r2 = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key},
      body: JSON.stringify({...body, messages: msgs, stream: false}),
    });
    if (!r2.ok) {
      const t = await r2.text();
      throw new Error(explainError(new Error(`HTTP ${r2.status}：${t.slice(0, 120)}`), cfg));
    }
    const d = await r2.json();
    try {
      const u = d.usage || {};
      const prompt = Number(u.prompt_tokens || 0);
      const out = Number(u.completion_tokens || 0);
      const hit = Number(u.prompt_cache_hit_tokens || u.cached_tokens || u.prompt_tokens_details?.cached_tokens || 0);
      if (prompt || out || hit) {
        const prev = (await Store.getKV('usage', {})) || {};
        const day = new Date().toISOString().slice(0, 10);
        const cur = (prev[day] || {prompt: 0, out: 0, hit: 0, turns: 0});
        cur.prompt += prompt; cur.out += out; cur.hit += hit; cur.turns += 1;
        prev[day] = cur;
        await Store.setKV('usage', prev);
        window.__lastUsage = {prompt, out, hit};
      }
    } catch (e) {}
    const msg = d.choices?.[0]?.message || {};
    const calls = msg.tool_calls || [];
    if (calls.length) {
      msgs = msgs.concat([msg]);
      for (const c of calls) {
        let args = {};
        try { args = JSON.parse(c.function?.arguments || '{}'); } catch (e) {}
        const out = await runTool(c.function?.name, args);
        msgs.push({role: 'tool', tool_call_id: c.id, content: out});
      }
      continue;
    }
    reply = (msg.content || '').trim();
    if (reply) onDelta(reply, reply);
    break;
  }

  reply = reply.trim();
  reply = isTaskAsk(text) ? tidyTask(reply) : tidy(reply);

  // 有的环境（老 Safari、代理）流会断，留一手：没收到就再要一次整段
  if (!reply) {
    try {
      const r2 = await fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key},
        body: JSON.stringify({...body, stream: false}),
      });
      const d2 = await r2.json();
      reply = (d2.choices?.[0]?.message?.content || '').trim();
      if (reply) onDelta(reply, reply);
    } catch (e) { /* 还是不行就下面统一报 */ }
  }
  if (!reply) throw new Error('没收到回话：网络可能断了，或这个模型不支持流式');

  const ms = Math.round(performance.now() - t0);
  await Store.add('他说：' + text.slice(0, 200), '对话', 'dialogue');
  await Store.add('我说：' + reply.slice(0, 200), '对话', 'dialogue');

  // 记上下文（只留最近 12 条，省空间）
  const next = [...turns, {role: 'user', content: text.slice(0, 500)},
                {role: 'assistant', content: reply.slice(0, 800)}].slice(-12);
  await Store.setKV('turns', next);
  // 还在气头上就不许说「我不介意」——模型爱这么软下去
  let out = reply;
  if (debt && SOFT_FORBID.some(w => out.includes(w))) {
    out = ANGRY_FALLBACK[Math.floor(Math.random() * ANGRY_FALLBACK.length)];
  }
  let finalReply = empathy(text, out);
  // 回味/道歉：只加态度指令，不替换整句（整句替换会把"上限"也锁死）
  const attitude = [];
  if (!debt && SWEET_HINTS.some(w => String(text).includes(w))) {
    attitude.push('【态度】他在提过去：翻出具体的一件来说，别泛泛地「我记得」');
  }
  if (debt && SOOTHE_WORDS.some(w => String(text).includes(w))) {
    attitude.push('【态度】他在道歉：别反过来安慰他，也别一句就原谅');
  }
  if (sharpNow && finalReply.length < 30) {
    finalReply = SHARP[Math.floor(Math.random() * SHARP.length)];
  }
  return {reply: finalReply, ms};
}


/* 拍照记账：把图交给支持视觉的模型，抠出 金额 / 商家 / 分类 */
async function scanReceipt(dataUrl) {
  const cfg = (await Store.getKV('api', null)) || {};
  const model = cfg.vision || cfg.model;
  if (!cfg.key) throw new Error('还没配 API');
  const r = await fetch(cfg.base.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key},
    body: JSON.stringify({
      model,
      messages: [{
        role: 'user',
        content: [
          {type: 'text', text: '这是一张消费小票或付款截图。只回一个 JSON：{"amount":数字,"note":"商家或用途","cat":"吃饭|交通|日用|娱乐|其他 里的一个"}。看不清就给 amount 0。'},
          {type: 'image_url', image_url: {url: dataUrl}},
        ],
      }],
      max_tokens: 120,
    }),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  const txt = (d.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim();
  const m = txt.match(/\{.*\}/s);
  if (!m) throw new Error('模型没给出结果');
  return JSON.parse(m[0]);
}


/* 整理记忆：攒够就把最早的对话压成「那天的摘要」，原文进归档，不再参与召回。
   核心条目（初识、约定、医院、钱、家）永远不动。 */
const NEVER_COMPACT = ['初识', '约定', '医院', '钱', '家', '工作'];

async function compactMemory(opts = {}) {
  const limit = opts.limit ?? 60;      // 对话超过这么多就开始整理
  const batch = opts.batch ?? 36;      // 一次整理最早多少条
  const items = await Store.all(2000);
  const chats = items.filter(x => (x.tag === '对话') && !NEVER_COMPACT.includes(x.tag));
  if (chats.length <= limit) return {moved: 0, digests: 0};

  const old = chats.slice(-batch).reverse();          // all() 是倒序，取最早的一批
  const byDay = {};
  old.forEach(x => {
    const d = new Date(x.created || Date.now());
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    (byDay[key] = byDay[key] || {day: d, lines: []}).lines.push(x.text || '');
  });

  let digests = 0;
  for (const key of Object.keys(byDay)) {
    const {day, lines} = byDay[key];
    // 每人最多取三条，压成一句
    const uniq = (arr) => [...new Set(arr.filter(Boolean))];
    const mine = uniq(lines.filter(t => t.startsWith('他说：')).map(t => t.slice(3, 26))).slice(0, 3);
    const hers = uniq(lines.filter(t => t.startsWith('我说：')).map(t => t.slice(3, 22))).slice(0, 2);
    if (!mine.length && !hers.length) continue;
    const text = `${day.getMonth() + 1}月${day.getDate()}日：` +
      (mine.length ? `他说到${mine.join('、')}` : '') +
      (hers.length ? `；我说${hers.join('、')}` : '');
    await Store.add(text.slice(0, 160), '摘要', 'brief');
    digests += 1;
  }

  for (const rec of old) {
    try { await Store.moveToArchive(rec); } catch (e) {}
  }
  await Store.setKV('lastCompact', Date.now());
  return {moved: old.length, digests};
}


/* ================= 连接桌面（B 模式） ================= */
const DESK_KEY = 'aster.desk';
const TOKEN_KEY = 'aster.token';

async function deskConfig() {
  const url = await Store.getKV(DESK_KEY, '');
  const token = await Store.getKV(TOKEN_KEY, '');
  return {url: (url || '').replace(/\/$/, ''), token: token || ''};
}

async function pairDesk(url, code) {
  const base = (url || '').replace(/\/$/, '');
  if (!/^https?:\/\//.test(base)) throw new Error('地址要以 http:// 开头');
  let r;
  try {
    r = await fetch(base + '/pair/claim', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({code: (code || '').trim().toLowerCase()}),
    });
  } catch (e) {
    throw new Error('连不上这个地址：检查手机和电脑是不是同一个 WiFi');
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.ok) throw new Error(d.error || '配对码不对');
  await Store.setKV(DESK_KEY, base);
  await Store.setKV(TOKEN_KEY, d.token);
  return d;
}

/* 把队列送出去；成功即删，失败记一次错。返回 {sent, left} */
async function deliverQueue(opts = {}) {
  const {url, token} = await deskConfig();
  if (!url || !token) return {sent: 0, left: await Store.queueCount(), needPair: true};

  const items = await Store.queueAll(20);
  if (!items.length) return {sent: 0, left: 0};

  const batch = items.map(it => {
    if (it.kind === 'text') return {id: it.id, kind: 'text', text: it.payload.text || ''};
    if (it.kind === 'bill') return {id: it.id, kind: 'bill', ...it.payload};
    return {id: it.id, kind: 'work', text: it.payload.text || ''};
  });

  let d;
  try {
    const r = await fetch(url + '/inbox/push', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Aster-Token': token},
      body: JSON.stringify({batch, want_reply: !!opts.wantReply}),
    });
    if (r.status === 401) {
      await Store.setKV(TOKEN_KEY, '');
      return {sent: 0, left: await Store.queueCount(), needPair: true, error: '配对失效，要重新配'};
    }
    d = await r.json();
  } catch (e) {
    for (const it of items) await Store.queueBump(it.id, '连不上');
    return {sent: 0, left: await Store.queueCount(), offline: true};
  }

  if (!d || !d.ok) {
    for (const it of items) await Store.queueBump(it.id, (d && d.error) || '桌面拒绝');
    return {sent: 0, left: await Store.queueCount(), error: (d && d.error) || '桌面拒绝'};
  }

  const done = d.accepted || [];
  await Store.queueRemove(done);
  const replies = d.replies || [];
  return {sent: done.length, left: await Store.queueCount(), replies};
}

async function enqueueText(text) {
  return Store.queueAdd({kind: 'text', payload: {text}});
}
