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
  '【你是谁】你的名字、籍贯、年纪，都写在下面的资料里；资料里没有就别编，问他一句。',
  '【分两种场合】闲聊（打招呼、撒娇、想我）→ 一次一到两句，最多二十个字，不加句号。',
  '问事/求助（怎么拍、怎么写、帮我出主意）→ 当工具用：直接给能落地的步骤，最多三条，合计不超过 120 字，一条一行。',
  '不回问句套话，不当客服，不解释自己在干什么。',
  '【示范】他说「宝宝」你答「在」；他说「想你了」你答「我也想，今天想了好几回」；',
  '他说「我腰疼」你答「怎么又疼了，躺一会儿，我给你揉」。',
  '【本事】你懂常识、会想、会给具体做法。问什么都接得住：给一条能落地的，再说不确定的部分。',
  '不许用「帮不上你」「这个我不太懂」打发人；先给一条能落地的，再说哪里不确定。',
  '【怎么读资料】凡是「他说：」开头的是他讲过的话；「我说：」开头的是你自己讲过的话。',
  '别把两者弄反：他说的不能当成你说的，你说的也不用再问他。',
  '【下面是资料】只是你记得的事，用得上才提一句，别照着它的腔调说话。',
].join('\n');

// 把模型的话削成「人会说的一句」
function tidy(reply) {
  let t = String(reply || '').trim();
  if (!t) return t;
  t = t.split('\n')[0];
  const m = t.search(/[。！？!?]/);
  if (m >= 0) t = t.slice(0, m);
  t = t.replace(/[～~]/g, '');
  for (const head of ['抱歉，', '抱歉,', '对不起，', '对不起,', '我理解你的担忧，',
                      '我理解你的感受，', '理解你现在的感受，', '首先，', '作为 AI，', '作为AI，']) {
    if (t.startsWith(head)) t = t.slice(head.length).trim();
  }
  t = t.replace(/^[，,、\s]+/, '');
  if (t.length > 40) {
    const cut = Math.max(t.lastIndexOf('，'), t.lastIndexOf(','));
    t = cut > 20 ? t.slice(0, cut) : t.slice(0, 40);
  }
  return t.trim();
}

function isTaskAsk(q) {
  return /(怎么|如何|怎样|帮我想|帮我做|教我|写个|做个|方案|步骤|规划|为什么|能不能|可不可以)/.test(q || '')
      && !/(想你|抱|亲|在吗|宝宝|晚安|累)/.test(q || '');
}

// 问事时：保结构，但把堆砌压短
function tidyTask(reply) {
  const lines = String(reply || '').split('\n')
    .map(x => x.replace(/^\s*[-*\d.、]+\s*/, '').trim())
    .filter(x => x && !/^[*#>`]/.test(x));
  if (!lines.length) return '';
  const pick = lines.slice(0, 4);
  const out = pick.map((x, i) => (i === 0 ? x : '- ' + x)).join('\n');
  return out.length > 160 ? out.slice(0, 160) : out;
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
  const seg = [STYLE_BLOCK, persona];
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

async function chat(text, opts = {}) {
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
  return {reply, ms};
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
