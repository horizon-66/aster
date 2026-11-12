/* 由 index.html 抽出来的脚本：顺序与原页面一致 */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
;
window.onerror = (m, src, line) => {
  document.title = 'ERR ' + m + ' @' + (src||'').split('/').pop() + ':' + line;
  const el = document.createElement('div');
  el.className = 'msg sys';
  el.textContent = '脚本出错：' + m + ' @' + (src||'').split('/').pop() + ':' + line;
  document.getElementById('log')?.appendChild(el);
};
;
const $ = s => document.querySelector(s);
const log = $('#log');
const HIST_KEY = 'aster.ui.history';

async function saveHistory() {
  const rows = [...log.querySelectorAll('.msg')]
    .filter(el => !el.classList.contains('sys'))
    .slice(-60)
    .map(el => ({t: el.textContent, w: el.classList.contains('me') ? 'me' : 'her'}));
  await Store.setKV(HIST_KEY, rows);
}

const add = (text, who = 'her', opts = {}) => {
  if (!opts.allowEmpty && (text === undefined || text === null || String(text).trim() === '')) return null;  // 空的不画（占位气泡除外）
  const el = document.createElement('div');
  el.className = 'msg ' + who;
  el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  if (!opts.silent && who !== 'sys') saveHistory().catch(() => {});
  // 长按：复制 / 删除
  let timer = null;
  el.addEventListener('pointerdown', () => {
    timer = setTimeout(() => {
      const pick = confirm('这条消息：\n\n' + text.slice(0, 80) + '\n\n点「确定」复制，点「取消」删除');
      if (pick) { navigator.clipboard?.writeText(text).catch(() => {}); }
      else { el.remove(); saveHistory().catch(() => {}); }
    }, 700);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev =>
    el.addEventListener(ev, () => clearTimeout(timer)));
  return el;
};

async function restoreHistory() {
  const rows = (await Store.getKV(HIST_KEY, [])) || [];
  rows.slice(-40).forEach(r => add(r.t, r.w, {silent: true}));
}

function status(s) { $('#state').textContent = s; }

async function boot() {
  const mode = await initStore();
  let api = null, n = 0;
  try {
    api = await Store.getKV('api', null);
    n = await Store.count();
  } catch (e) {
    add('本地存储打不开：' + e.message + '（换 Chrome/Safari 再试，或用 https 打开）', 'sys');
    status('存储不可用');
    return;
  }
  status(api ? (localStorage.getItem('aster.lang.m')==='en' ? `${n} records` : `${n} 条记忆`) : (mode === 'ls' ? (localStorage.getItem('aster.lang.m')==='en' ? 'Local only' : '本地存储（简易）') : (localStorage.getItem('aster.lang.m')==='en' ? 'Not set' : '未配置')));
  if (!api) {
    const hint = add('先到「设置」里填 API，填完就能说话（点这里）', 'sys');
    hint.style.cursor = 'pointer';
    hint.onclick = () => document.querySelector('nav button[data-tab=set]')?.click();
  }
  else add('我在', 'her');
}
let __booted = false;
(async () => { if (__booted) return; __booted = true; await boot(); })();
restoreHistory().catch(() => {});
setTimeout(() => { try { if (typeof compactMemory === 'function') compactMemory().catch(() => {}); } catch (e) {} }, 3000);

/* 侧栏「发给它看」：本地文件 / 照相机 两个选择 */
(function () {
  const docInp = document.getElementById('docFile');
  const shotInp = document.getElementById('shotFile');
  if (!docInp || !shotInp) return;

  const sheet = document.createElement('div');
  sheet.id = 'pickSheet';
  sheet.style.cssText = 'position:fixed;inset:0;z-index:95;display:none;align-items:flex-end;background:rgba(0,0,0,.45)';
  sheet.innerHTML = `
    <div style="width:100%;background:#151518;border-radius:18px 18px 0 0;padding:14px 14px 26px;
                color:#eee;font:15px -apple-system,'PingFang SC'">
      <div style="text-align:center;color:#8e8e96;font-size:13px;margin-bottom:10px">发给它看</div>
      <button data-pick="file" style="width:100%;padding:16px;border:0;border-radius:14px;background:rgba(255,255,255,.06);color:#eee;font-size:15px;margin-bottom:8px">选本地文件（图 / PDF / 文本）</button>
      <button data-pick="shot" style="width:100%;padding:16px;border:0;border-radius:14px;background:rgba(255,255,255,.06);color:#eee;font-size:15px;margin-bottom:8px">拍照</button>
      <button data-pick="cancel" style="width:100%;padding:14px;border:0;border-radius:14px;background:transparent;color:#8e8e96;font-size:14px">取消</button>
    </div>`;
  document.body.appendChild(sheet);

  /* 旧入口已移除，保留下面逻辑 */
  if (false) {
    document.getElementById('drawer')?.classList.add('hide');
    sheet.style.display = 'flex';
  };
  sheet.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) { if (e.target === sheet) sheet.style.display = 'none'; return; }
    const kind = b.dataset.pick;
    sheet.style.display = 'none';
    if (kind === 'file') docInp.click();
    if (kind === 'shot') shotInp.click();
  });

  async function handle(f) {
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) { add('文件太大（超过 4MB），换个小的', 'sys'); return; }
    const isImg = /^image\//.test(f.type);
    try {
      if (isImg) {
        const dataUrl = await new Promise((res, rej) => {
          const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f);
        });
        window.__doc = {name: f.name, image: dataUrl};
        add('收到了图：' + (f.name || '照片') + '（识图要模型支持看图）', 'sys');
        const ta = document.getElementById('text');
        if (!ta.value.trim()) ta.value = '看看这个';
        return;
      }
      let txt;
      if (/\.pdf$/i.test(f.name)) {
        add('在读 PDF…', 'sys');
        const {getDocument, GlobalWorkerOptions} = await import('./vendor/pdf.min.mjs');
        GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';
        const doc = await getDocument({data: await f.arrayBuffer()}).promise;
        let out = [];
        const pages = Math.min(doc.numPages, 20);
        for (let i = 1; i <= pages; i++) {
          const pg = await doc.getPage(i);
          const tc = await pg.getTextContent();
          out.push(tc.items.map(it => it.str).join(' '));
        }
        txt = out.join('\n');
      } else {
        txt = await f.text();
      }
      window.__doc = {name: f.name, text: txt.slice(0, 8000)};
      add('收到了：' + f.name + '（' + Math.round(txt.length / 1000) + 'k 字）', 'sys');
      const ta = document.getElementById('text');
      if (!ta.value.trim()) ta.value = '看看这个：' + f.name;
    } catch (e) {
      add('这个格式读不了（先另存成 txt/md/PDF 再发）', 'sys');
    }
  }
  const albumBtn = document.getElementById('toolAlbum');
  const shotBtn = document.getElementById('toolShot');
  const docBtn = document.getElementById('toolDoc');
  if (albumBtn) albumBtn.onclick = () => docInp.click();
  if (shotBtn) shotBtn.onclick = () => shotInp.click();
  if (docBtn) docBtn.onclick = () => docInp.click();
  docInp.onchange = async () => { await handle(docInp.files && docInp.files[0]); docInp.value = ''; };
  shotInp.onchange = async () => { await handle(shotInp.files && shotInp.files[0]); shotInp.value = ''; };
})();

/* 长按输入框 → 切语音；点键盘图标切回来 */
(function () {
  const ta = document.getElementById('text');
  const bar = document.getElementById('voiceBar');
  const kb = document.getElementById('kbBtn');
  if (!ta || !bar || !kb) return;
  let timer = null;

  function toVoice() {
    document.body.classList.add('voiceMode');
    bar.classList.add('on');
    kb.classList.add('on');
    try { ta.blur(); } catch (e) {}
  }
  function toType() {
    document.body.classList.remove('voiceMode');
    bar.classList.remove('on');
    kb.classList.remove('on');
    ta.focus();
  }
  ta.addEventListener('pointerdown', () => {
    timer = setTimeout(toVoice, 550);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev =>
    ta.addEventListener(ev, () => clearTimeout(timer)));
  kb.onclick = toType;

  // voiceBar 自己负责录音：按住录、松开停
  let recording = false;
  bar.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    recording = true; bar.classList.add('rec');
    const mic = document.getElementById('mic');
    if (mic) mic.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}));
  });
  bar.addEventListener('pointerup', () => {
    if (!recording) return;
    recording = false; bar.classList.remove('rec');
    const mic = document.getElementById('mic');
    if (mic) mic.dispatchEvent(new PointerEvent('pointerup', {bubbles: true}));
  });
  bar.addEventListener('pointercancel', () => {
    recording = false; bar.classList.remove('rec');
  });
})();

/* 顶部返回 + 左滑退出（所有页面通用） */
(function () {
  const back = document.getElementById('sheetBack');
  const setSheet = document.getElementById('sheet-set');
  if (back) back.onclick = () => { setSheet.classList.remove('on'); document.body.classList.remove('sheetOpen'); };

  // 左滑：从右往左滑超过 60px 就退出
  let sx = 0, sy = 0, target = null;
  document.addEventListener('touchstart', (e) => {
    const sheet = e.target.closest('.sheet.on');
    target = sheet || null;
    if (!target) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
  }, {passive: true});
  document.addEventListener('touchend', (e) => {
    if (!target) return;
    const dx = e.changedTouches[0].clientX - sx;
    const dy = Math.abs(e.changedTouches[0].clientY - sy);
    if (dx < -60 && dy < 40) {
      target.classList.remove('on');
      document.body.classList.remove('sheetOpen');
    }
    target = null;
  }, {passive: true});
})();

$('#send').onclick = async () => {
  try { await __sendOnce(); } catch (e) {
    add('发送失败：' + (e && e.message || e), 'sys');
  }
};

async function __sendOnce() {
  window.__stopIntro && window.__stopIntro();   // 他开口了，开场乐收掉
  const ta = $('#text');
  const t = ta.value.trim();
  if (!t) return;
  ta.value = '';
  add(t, 'me');
  // B 模式：先把这句话攒进队列，稍后随回复一起送（这步失败也不许把发送卡死）
  let _tk = '';
  try {
    const dc = await deskConfig();
    _tk = (dc && dc.token) || '';
    if (_tk) await enqueueText(t).catch(() => {});
  } catch (e) { _tk = ''; }
  const bubble = add('', 'her', {allowEmpty: true});
  const wait = add('…', 'sys');
  try {
    const {reply, ms} = await chat(t, {
      onDelta: (d, full) => {
        if (wait.parentNode) wait.remove();
        bubble.textContent = full;
        log.scrollTop = log.scrollHeight;
      },
    });
    if (_tk) {
      await Store.queueAdd({kind: 'reply', payload: {text: reply}}).catch(() => {});
      deliverQueue().then(() => window.__paintLink && window.__paintLink()).catch(() => {});
    }
    // 状态栏：条数 · 耗时 · 这一轮的 token / 缓存命中
    const u = window.__lastUsage || {};
    const tok = u.prompt || u.out ? ` · ${u.prompt + u.out} tok` : '';
    const cache = u.prompt ? ` · 缓存 ${u.hit}/${u.prompt}` : '';
    status(localStorage.getItem('aster.lang.m')==='en'
      ? `${await Store.count()} records · ${ms}ms${tok}${cache}`
      : `${await Store.count()} 条记忆 · ${ms}ms${tok}${cache}`);
  } catch (e) {
    if (wait.parentNode) wait.remove();
    bubble.remove();
    add(e.message, 'sys');
  }
};

document.querySelectorAll('nav button').forEach(b => b.onclick = async () => {
  if (b.dataset.tab === 'home') {
    document.querySelectorAll('nav button').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    document.getElementById('viewChat')?.classList.add('on');
    window.__sfx && window.__sfx('view', 0.2);
    ['sheet-memory','sheet-set','sheet-work'].forEach(id => document.getElementById(id).classList.remove('on'));
    return;
  }
  document.querySelectorAll('nav button').forEach(x => x.classList.remove('on'));
  b.classList.add('on');
  if (b.dataset.tab === 'work') await openWork();
  if (b.dataset.tab === 'memory') await openMemory();
  if (b.dataset.tab === 'set') await openSet();
  if (b.dataset.tab === 'chat') { ['sheet-memory','sheet-set','sheet-work'].forEach(id => document.getElementById(id).classList.remove('on')); }
});

async function openMemory() {
  const items = await Store.all(60);
  const total = await Store.count();
  const arch = (await Store.archiveAll()).length;
  const last = await Store.getKV('lastCompact', 0);
  const when = last ? new Date(last) : null;
  const memEn = localStorage.getItem('aster.lang.m') === 'en';
  $('#memCount').textContent = (memEn
    ? `${total} records, stored on this phone only`
    : `临时存在这台手机上，共 ${total} 条`)
    + (memEn ? (arch ? ` · ${arch} archived` : '') : (arch ? ` · 另有 ${arch} 条已归档（不参与召回）` : ''))
    + (memEn ? (when ? ` · last cleanup ${when.getMonth()+1}/${when.getDate()}` : '')
             : (when ? ` · 上次整理 ${when.getMonth()+1}/${when.getDate()}` : ''));
  const box = $('#memList');
  box.innerHTML = items.length ? '' : '<div class="hint">还没有记忆，聊几句就有了</div>';
  items.forEach(it => {
    const el = document.createElement('div');
    el.className = 'mem';
    const d = new Date(it.created || Date.now());
    el.innerHTML = `<em>${(d.getMonth()+1)}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}</em>${(it.text||'').slice(0,80)}`;
    el.style.cursor = 'pointer';
    let timer = null;
    const arm = () => { timer = setTimeout(async () => {
      if (confirm('删掉这条记忆？\n\n' + (it.text || '').slice(0, 60))) {
        await Store.delMemory(it.id);
        openMemory();
      }
    }, 600); };
    el.addEventListener('pointerdown', arm);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => el.addEventListener(ev, () => clearTimeout(timer)));
    box.appendChild(el);
  });
  $('#sheet-memory').classList.add('on');
}
$('#memClose').onclick = () => $('#sheet-memory').classList.remove('on');

function normBase(raw) {
  let b = String(raw || '').trim();
  if (!b) return '';
  if (!/^https?:\/\//i.test(b)) b = 'https://' + b;
  // 页面是 https 时，把 http 自动升成 https（不然浏览器直接拦掉）
  if (location.protocol === 'https:' && /^http:\/\//i.test(b)) b = b.replace(/^http:\/\//i, 'https://');
  b = b.replace(/\/+$/, '');
  if (!/\/v\d+$/i.test(b) && !/\/api\/v\d+$/i.test(b)) b += '/v1';
  return b;
}

// 常见写错的地方，直接说清楚
function baseProblem(b) {
  if (location.protocol === 'https:' && /^http:\/\//i.test(b)) return '地址是 http，页面是 https，浏览器会拦——改成 https';
  return '';
}

async function probeApi(api) {
  if (!api?.base || !api?.model || !api?.key) return null;
  try {
    const r = await fetch(api.base.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + api.key},
      body: JSON.stringify({model: api.model, messages: [{role: 'user', content: '在吗'}], max_tokens: 2}),
    });
    return r.ok;
  } catch { return false; }
}

async function openSet() {
  const api = await Store.getKV('api', null);
  if (api) { $('#base').value = api.base || ''; $('#model').value = api.model || ''; $('#key').value = api.key || ''; $('#vision').value = api.vision || ''; }
  $('#sheet-set').classList.add('on');
  const msg = $('#apiMsg');
  if (api?.key) {
    msg.textContent = '上次存的：' + (api.model || '') + '，正在确认…';
    const ok = await probeApi(api);
    if (ok === true) { msg.style.color = '#3ecf8e'; msg.textContent = '已连上 · ' + api.model + ' · ' + api.base; }
    else if (ok === false) { msg.style.color = '#e8173d'; msg.textContent = '连不上 · 检查 key / 地址 / 是否用 https 打开'; }
  } else {
    msg.textContent = '还没有 key——填好点「保存并连接」';
  }
}
$('#setClose').onclick = () => $('#sheet-set').classList.remove('on');

// 选服务商 = 自动填好地址和模型，普通人只需要贴一个 key
const PROVIDERS = {
  deepseek: {base: 'https://api.deepseek.com/v1', model: 'deepseek-chat'},
  openai: {base: 'https://api.openai.com/v1', model: 'gpt-4o-mini'},
  dashscope: {base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus'},
  zhipu: {base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash'},
  moonshot: {base: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k'},
  siliconflow: {base: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct'},
  ollama: {base: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b'},
  custom: {base: '', model: ''},
};
const pick = document.getElementById('providerPick');
function applyProvider(pid) {
  const cfg = PROVIDERS[pid] || {};
  $('#base').value = cfg.base || '';
  $('#model').value = cfg.model || '';
  localStorage.setItem('aster.provider', pid);
  const noSearch = ['deepseek', 'openai', 'siliconflow', 'ollama', 'custom'];
  const tip = document.getElementById('provTip');
  if (tip) tip.textContent = noSearch.includes(pid)
    ? '这个服务商不自带联网搜索；要问实时的事，换成通义/智谱/Moonshot'
    : '这个服务商自带联网搜索，问实时的事也能答';
}
pick?.addEventListener('change', () => applyProvider(pick.value));
// 一进设置就按当前选中的服务商填好，不用先切一下才生效
try {
  (async () => {
    try {
      const u = (await Store.getKV('usage', {})) || {};
      const day = new Date().toISOString().slice(0, 10);
      const t = u[day];
      const el = document.getElementById('usageLine');
      if (!el) return;
      el.textContent = t
        ? `今天 ${t.turns} 轮 · 输入 ${t.prompt} · 输出 ${t.out} · 缓存命中 ${t.hit}`
        : '今天还没说话';
    } catch (e) {}
  })();

  const saved = localStorage.getItem('aster.provider');
  if (saved && PROVIDERS[saved]) pick.value = saved;
  const baseEl = $('#base');
  if (!baseEl.value.trim()) applyProvider(pick.value || 'deepseek');
} catch (e) {}

$('#saveApi').onclick = async () => {
  const base = normBase($('#base').value), model = $('#model').value.trim(), key = $('#key').value.trim();
  const msg = $('#apiMsg');
  if (!base || !model || !key) { msg.style.color = '#e8173d'; msg.textContent = '三项都要填'; return; }
  const bp = baseProblem(base);
  if (bp) { msg.style.color = '#e8173d'; msg.textContent = bp; return; }
  $('#base').value = base;
  msg.style.color = ''; msg.textContent = '正在连…';
  try {
    await Store.setKV('api', {base, model, key, vision: $('#vision').value.trim()});
  } catch (e) {
    msg.style.color = '#e8173d'; msg.textContent = '存不下来：' + e.message; return;
  }
  // 存完立刻打一次真请求，连上就说连上了
  try {
    const t0 = Date.now();
    const r = await fetch(base.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key},
      body: JSON.stringify({model, messages: [{role: 'user', content: '在吗'}], max_tokens: 4}),
    });
    const ms = Date.now() - t0;
    if (r.ok) {
      msg.style.color = '#3ecf8e';
      msg.textContent = '已连上 · ' + model + ' · ' + ms + 'ms';
      document.getElementById('connDot')?.classList.add('on');
    } else {
      const txt = await r.text().catch(() => '');
      msg.style.color = '#e8173d';
      msg.textContent = r.status === 401 ? '密钥不对：请检查 API Key'
        : r.status === 404 ? '地址不对：检查 Base URL 是否以 /v1 结尾'
        : r.status === 429 ? '请求太频繁或额度用完'
        : '连接失败（HTTP ' + r.status + '）';
    }
  } catch (e) {
    msg.style.color = '#e8173d';
    msg.textContent = '连不上：可能是网络被拦。请确认用 https 打开页面，且地址以 /v1 结尾';
  }
  status(localStorage.getItem('aster.lang.m')==='en' ? `${await Store.count()} records` : `${await Store.count()} 条记忆`);
  const cnt = document.getElementById('count');
  if (cnt) cnt.textContent = localStorage.getItem('aster.lang.m')==='en'
    ? `${await Store.count()} records` : `${await Store.count()} 条记忆`;
};

$('#testApi').onclick = async () => {
  const base = normBase($('#base').value), model = $('#model').value.trim(), key = $('#key').value.trim();
  if (!base || !model || !key) { $('#packMsg').textContent = '三项都要填'; return; }
  const msg2 = $('#apiMsg'); msg2.style.color = ''; msg2.textContent = '测试中…';
  try {
    const r = await fetch(base.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key},
      body: JSON.stringify({model, messages: [{role: 'user', content: '在吗'}], max_tokens: 8}),
    });
    if (r.ok) { msg2.style.color = '#3ecf8e'; msg2.textContent = '通了'; }
    else { msg2.style.color = '#e8173d'; msg2.textContent = `没通：HTTP ${r.status}`; }
  } catch (e) { msg2.style.color = '#e8173d'; msg2.textContent = '没通：' + e.message; }
};

$('#exportPack').onclick = async () => {
  const pack = await Store.exportPack();
  const blob = new Blob([JSON.stringify(pack, null, 1)], {type: 'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `aster-memory-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  // 记住这次导出，之后用来判断要不要提醒
  localStorage.setItem('aster.lastExportAt', String(Date.now()));
  localStorage.setItem('aster.lastExportCount', String(await Store.count()));
  $('#packMsg').textContent = `导出 ${pack.items.length} 条。建议存到网盘或电脑`;
};

$('#importPack').onclick = () => $('#file').click();
$('#file').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const pack = JSON.parse(await f.text());
    const n = await Store.importPack(pack, true);
    $('#packMsg').textContent = `导入 ${n} 条`;
    status(localStorage.getItem('aster.lang.m')==='en' ? `${await Store.count()} records` : `${await Store.count()} 条记忆`);
  const cnt = document.getElementById('count');
  if (cnt) cnt.textContent = localStorage.getItem('aster.lang.m')==='en'
    ? `${await Store.count()} records` : `${await Store.count()} 条记忆`;
  } catch (err) { $('#packMsg').textContent = '导入失败：' + err.message; }
};
;
(function () {
  const sp = document.getElementById('splash');
  if (!sp) return;
  if (sessionStorage.getItem('aster.splash') || location.search.includes('nosplash')) {
    sp.remove(); return;
  }
  sessionStorage.setItem('aster.splash', '1');
  const cv = sp.querySelector('canvas');
  const g = cv.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w, h, ps = [], raf;
  const fit = () => {
    const d = Math.min(devicePixelRatio || 1, 2);
    w = cv.clientWidth; h = cv.clientHeight;
    cv.width = w * d; cv.height = h * d; g.setTransform(d, 0, 0, d, 0, 0);
  };
  const mk = () => ({x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.3 + .3,
    a: Math.random() * .5 + .15, vx: (Math.random() - .5) * .2, vy: -(Math.random() * .22 + .05)});
  const tick = () => {
    g.clearRect(0, 0, w, h);
    ps.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
      g.beginPath(); g.fillStyle = 'rgba(255,84,112,' + p.a + ')';
      g.arc(p.x, p.y, p.r, 0, 6.283); g.fill();
    });
    raf = requestAnimationFrame(tick);
  };
  fit(); ps = Array.from({length: reduce ? 12 : 46}, mk); tick();
  const finish = () => { cancelAnimationFrame(raf); sp.classList.add('out'); setTimeout(() => sp.remove(), 600); };
  setTimeout(finish, reduce ? 500 : 1700);
  sp.addEventListener('click', finish);
})();
;
(function () {
  const box = document.getElementById('letter');
  if (!box) return;
  if (localStorage.getItem('aster.letter') || location.search.includes('noletters')) return;
  box.classList.remove('hide');
  box.querySelector('.go').onclick = () => {
    localStorage.setItem('aster.letter', '1');
    box.classList.add('hide');
  };
})();
;
const $$ = s => document.querySelectorAll(s);
function fmtDay(ts) { const d = new Date(ts); return `${d.getMonth()+1}/${d.getDate()}`; }
function isToday(ts) { const d = new Date(ts), n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate(); }

async function openWork() {
  let list = [];
  try { list = await Store.works(200); }
  catch (e) { (document.getElementById('workMsg')||{}).textContent = '读记录失败：' + e.message; }
  const today = list.filter(w => isToday(w.created));
  $('#workCount').textContent = localStorage.getItem('aster.lang.m') === 'en'
    ? `${today.length} today · ${list.length} total`
    : `今天 ${today.length} 条 · 全部 ${list.length} 条`;
  const box = $('#workList');
  box.innerHTML = today.length ? '' : '<div class="hint">今天还空着。记一条，晚上好回顾</div>';
  today.forEach(w => {
    const el = document.createElement('div');
    el.className = 'wk' + (w.done ? ' done' : '');
    el.innerHTML = `<input type="checkbox" ${w.done ? 'checked' : ''}><span>${w.text}</span>`;
    el.querySelector('input').onchange = async () => {
      await Store.toggleWork(w.id);
      openWork();
    };
    box.appendChild(el);
  });
  $('#sheet-work').classList.add('on');
}

$('#workAdd').onclick = async () => {
  const t = $('#workText').value.trim();
  if (!t) return;
  await Store.addWork(t);
  $('#workText').value = '';
  openWork();
};
$('#workClose').onclick = () => $('#sheet-work').classList.remove('on');
$('#workCopy').onclick = async () => {
  const list = (await Store.works(200)).filter(w => isToday(w.created));
  const text = list.map(w => `${w.done ? '[x]' : '[ ]'} ${w.text}`).join('\n');
  try { await navigator.clipboard.writeText(text); $('#workMsg').textContent = '已复制'; }
  catch (e) { $('#workMsg').textContent = '复制不了：' + e.message; }
};
;
let billCat = '吃饭';
const CATS = ['吃饭', '交通', '日用', '娱乐', '其他'];

function billCatBar() {
  const box = $('#billCats');
  box.innerHTML = '';
  CATS.forEach(c => {
    const b = document.createElement('button');
    b.textContent = c;
    if (c === billCat) b.classList.add('on');
    b.onclick = () => { billCat = c; billCatBar(); };
    box.appendChild(b);
  });
}

async function openBill() {
  const all = await Store.bills(300);
  const today = all.filter(b => isToday(b.created));
  const sum = today.reduce((a, b) => a + (b.amount || 0), 0);
  $('#billTotal').textContent = `今天 ${today.length} 笔 · 合计 ¥${sum.toFixed(2)}`;
  const box = $('#billList');
  box.innerHTML = today.length ? '' : '<div class="hint">今天还没记账</div>';
  today.forEach(b => {
    const el = document.createElement('div');
    el.className = 'bill';
    el.innerHTML = `<em>${b.cat}</em><span>${b.note || '—'}</span><b>¥${Number(b.amount).toFixed(2)}</b><span class="x">×</span>`;
    el.querySelector('.x').onclick = async () => { await Store.delBill(b.id); openBill(); };
    box.appendChild(el);
  });
  billCatBar();
}

$('#segWork').onclick = () => {
  $('#segWork').classList.add('on'); $('#segBill').classList.remove('on');
  $('#paneWork').style.display = 'flex'; $('#paneBill').style.display = 'none';
};
$('#segBill').onclick = () => {
  $('#segBill').classList.add('on'); $('#segWork').classList.remove('on');
  $('#paneWork').style.display = 'none'; $('#paneBill').style.display = 'flex';
  openBill();
};
$('#billAdd').onclick = async () => {
  const amt = parseFloat($('#billAmt').value);
  if (!amt || amt <= 0) { $('#billMsg').textContent = '金额要大于 0'; return; }
  await Store.addBill(amt, $('#billNote').value.trim(), billCat);
  $('#billAmt').value = ''; $('#billNote').value = '';
  $('#billMsg').textContent = '记上了';
  openBill();
};
$('#billClose').onclick = () => $('#sheet-work').classList.remove('on');

/* 深链：?tab=work / ?tab=bill */
(function () {
  const q = location.search;
  if (q.includes('tab=bill')) setTimeout(() => { openWork(); document.getElementById('segBill').click(); }, 250);
  else if (q.includes('tab=work')) setTimeout(() => openWork(), 250);
})();
$('#billCopy').onclick = async () => {
  const today = (await Store.bills(300)).filter(b => isToday(b.created));
  const sum = today.reduce((a, b) => a + (b.amount || 0), 0);
  const text = today.map(b => `${b.cat} ${b.note || ''} ¥${Number(b.amount).toFixed(2)}`).join('\n')
    + `\n合计 ¥${sum.toFixed(2)}`;
  try { await navigator.clipboard.writeText(text); $('#billMsg').textContent = '已复制'; }
  catch (e) { $('#billMsg').textContent = '复制不了：' + e.message; }
};
;
(function () {
  const btn = document.getElementById('mic');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const ta = document.getElementById('text');
  if (!SR) {
    btn.title = '这个浏览器不支持语音输入';
    btn.style.opacity = .45;
    btn.onclick = () => add('这台手机的浏览器不支持语音输入；Chrome 可以，iPhone 的 Safari 不行', 'sys');
    return;
  }
  let rec = null, holding = false, base = '';

  const ensureMic = async () => {
    try {
      const st = await navigator.mediaDevices.getUserMedia({ audio: true });
      st.getTracks().forEach(t => t.stop());
      return true;
    } catch (e) {
      add('麦克风没开权限：点右上角地址旁的锁/ⓘ，把它打开再试', 'sys');
      return false;
    }
  };

  const start = async () => {
    if (holding) return;
    if (!(await ensureMic())) return;
    holding = true;
    base = ta.value;
    btn.classList.add('on');
    status('在听…松开结束');
    try {
      rec = new SR();
      rec.lang = 'zh-CN';
      rec.interimResults = true;
      rec.continuous = true;
      rec.onresult = (e) => {
        let txt = '';
        for (let i = e.resultIndex; i < e.results.length; i++) txt += e.results[i][0].transcript;
        ta.value = (base + txt).slice(0, 2000);
      };
      rec.onerror = (e) => { if (e.error !== 'no-speech') status('没听清：' + e.error); };
      rec.start();
    } catch (e) { status('麦克风打不开'); }
  };

  const stop = () => {
    holding = false;
    btn.classList.remove('on');
    status('');
    try { rec && rec.stop(); } catch (e) {}
  };

  // 按住说话：按下开始、松开结束（微信那种手感）
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); start(); });
  btn.addEventListener('pointerup', (e) => { e.preventDefault(); stop(); });
  btn.addEventListener('pointercancel', stop);
  btn.addEventListener('pointerleave', () => { if (holding) stop(); });
  // 键盘/无障碍：空格也能按
  btn.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') start(); });
  btn.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') stop(); });
})();
;
(function () {
  const cam = document.getElementById('billCam');
  const file = document.getElementById('billFile');
  const msg = document.getElementById('billMsg');
  if (!cam || !file) return;
  cam.onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files[0]; if (!f) return;
    msg.textContent = '识别中…';
    const dataUrl = await new Promise((res) => {
      const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(f);
    });
    try {
      const r = await scanReceipt(dataUrl);
      if (r.amount > 0) {
        (document.getElementById('billAmt')||{}).value = r.amount;
        (document.getElementById('billNote')||{}).value = r.note || '';
        if (CATS.includes(r.cat)) { billCat = r.cat; billCatBar(); }
        msg.textContent = '认出来了，确认一下再点「记」';
      } else {
        msg.textContent = '没认出来，手动填一下金额';
      }
    } catch (e) {
      msg.textContent = '识图要配一个支持看图的模型（设置里可填「识图模型」）：' + e.message;
    }
    file.value = '';
  };
})();

/* 同步到桌面工作台 */
(function () {
  const btn = document.getElementById('syncDesk');
  if (!btn) return;
  btn.onclick = async () => {
    const url = document.getElementById('deskUrl')?.value.trim();
    if (!url) { (document.getElementById('packMsg')||{}).textContent = '先填电脑地址'; return; }
    const items = (await Store.works(200)).map(w => ({text: w.text, kind: w.kind || 'work'}));
    const bills = (await Store.bills(200)).map(b => ({amount: b.amount, note: b.note, cat: b.cat}));
    (document.getElementById('packMsg')||{}).textContent = '推送中…';
    try {
      const r = await fetch(url.replace(/\/$/, '') + '/work/import_json', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({items, bills}),
      });
      const d = await r.json();
      (document.getElementById('packMsg')||{}).textContent = d.ok
        ? `同步好了：记录 ${d.items} 条、账单 ${d.bills} 笔`
        : '没成功：' + (d.error || '');
    } catch (e) {
      (document.getElementById('packMsg')||{}).textContent = '连不上：' + e.message;
    }
  };
})();

/* ---------- 外观：按日出日落自动切 ---------- */
(function () {
  const KEY = 'aster.theme.m';
  function sunTimes(date, lat, lng) {
    const rad = Math.PI / 180;
    const start = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    const n = Math.floor((start - Date.UTC(2000, 0, 1)) / 86400000) + 0.5;
    const L = (280.46 + 0.9856474 * n) % 360;
    const g = (357.528 + 0.9856003 * n) % 360;
    const lam = (L + 1.915 * Math.sin(g * rad) + 0.02 * Math.sin(2 * g * rad)) * rad;
    const eps = (23.439 - 0.0000004 * n) * rad;
    const dec = Math.asin(Math.sin(eps) * Math.sin(lam)) / rad;
    const H = Math.acos((Math.cos(90.833 * rad) - Math.sin(lat * rad) * Math.sin(dec * rad))
                        / (Math.cos(lat * rad) * Math.cos(dec * rad))) / rad;
    const eq = 9.87 * Math.sin(2 * (2 * Math.PI * (0.9856474 * n - 1.397) / 360)) * rad
             - 7.53 * Math.cos(2 * Math.PI * (0.9856474 * n - 1.397) / 360) * rad
             - 1.5 * Math.sin(0.9856474 * n * rad);
    const noon = (720 - 4 * lng - eq) / 1440;
    const dh = (H / 360) * 86400000;
    return {sunrise: new Date(start + noon * 86400000 - dh),
            sunset: new Date(start + noon * 86400000 + dh)};
  }
  const LOC = {lat: 29.56, lng: 106.55};
  const isNight = () => {
    const t = sunTimes(new Date(), LOC.lat, LOC.lng);
    const now = new Date();
    return now < t.sunrise || now >= t.sunset;
  };
  const apply = (mode) => {
    const night = mode === 'dark' || (mode === 'auto' && isNight());
    document.documentElement.classList.toggle('light', !night);
    document.querySelectorAll('#themeChips button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
    localStorage.setItem(KEY, mode);
    const t = sunTimes(new Date(), LOC.lat, LOC.lng);
    const f = (d) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    const line = document.getElementById('sunLine');
    if (line) line.textContent = localStorage.getItem('aster.lang.m') === 'en'
      ? `Sunrise ${f(t.sunrise)} · sunset ${f(t.sunset)} · now ${isNight() ? 'night' : 'day'}`
      : `今天日出 ${f(t.sunrise)}，日落 ${f(t.sunset)} · 现在是${isNight() ? '夜间' : '白天'}`;
  };
  const box = document.getElementById('themeChips');
  if (box) box.onclick = (e) => { const b = e.target.closest('button'); if (b) apply(b.dataset.mode); };
  const qm = new URLSearchParams(location.search).get('theme');
  apply(qm || localStorage.getItem(KEY) || 'auto');
  setInterval(() => { if ((localStorage.getItem(KEY) || 'auto') === 'auto') apply('auto'); }, 60000);
})();

/* ---------- 自动同步到电脑 ---------- */
(function () {
  const KEY = 'aster.autosync';
  const btn = document.getElementById('syncAuto');
  const on = () => localStorage.getItem(KEY) === '1';
  const paint = () => { if (btn) btn.textContent = '自动同步：' + (on() ? '开' : '关'); };
  if (btn) btn.onclick = () => { localStorage.setItem(KEY, on() ? '0' : '1'); paint(); run(true); };
  paint();

  async function push(silent) {
    const url = (document.getElementById('deskUrl')?.value || localStorage.getItem('aster.desk') || '').trim();
    if (!url) { if (!silent) { const el = document.getElementById('packMsg'); if (el) el.textContent = '先填电脑地址'; } return null; }
    localStorage.setItem('aster.desk', url);
    const base = url.replace(/\/$/, '');
    const el = document.getElementById('packMsg');

    // 1) 推：手机的 → 电脑
    const items = (await Store.works(300)).map(w => ({text: w.text, kind: w.kind || 'work'}));
    const bills = (await Store.bills(300)).map(b => ({amount: b.amount, note: b.note, cat: b.cat}));
    const pushed = await fetch(base + '/work/import_json', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({items, bills}),
    }).then(r => r.json());

    // 2) 拉：电脑的 → 手机（按文字 + 当天去重，不重复加）
    let pulled = {items: 0, bills: 0};
    try {
      const back = await fetch(base + '/work/export_json?days=30').then(r => r.json());
      for (const it of (back.items || [])) {
        const day = dayKeyOf(new Date(it.at || Date.now()).getTime());
        if (!(await Store.workExists(it.text, day))) {
          await Store.addWork(it.text, it.kind || 'work');
          pulled.items += 1;
        }
      }
      for (const b of (back.bills || [])) {
        const day = dayKeyOf(new Date(b.at || Date.now()).getTime());
        const m = (b.text || '').match(/¥\s*([\d.]+)/);
        const amount = m ? Number(m[1]) : 0;
        const note = (b.text || '').replace(/^\S+\s*/, '').replace(/¥.*$/, '').trim();
        if (amount && !(await billExists(amount, note, day))) {
          await Store.addBill(amount, note, '其他');
          pulled.bills += 1;
        }
      }
    } catch (e) { /* 老版本桌面没有这个接口，忽略 */ }

    if (!silent && el) {
      el.textContent = (pushed.ok
        ? `推过去：记录 ${pushed.items} 条、账 ${pushed.bills} 笔`
        : '推送没成功：' + (pushed.error || '')) +
        `　|　拉回来：记录 ${pulled.items}、账 ${pulled.bills}`;
    }
    return pushed;
  }
  window.__pushDesk = push;
  const run = async (silent) => { try { await push(silent); } catch (e) {} };
  if (on()) setTimeout(() => run(true), 1500);
})();


/* ---------- 日历 ---------- */
(function () {
  let cursor = new Date();          // 当前看的月份
  let sel = new Date();             // 选中的那一天
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  async function renderCal() {
    const items = await Store.works(500);
    const bills = await Store.bills(500);
    const marks = new Set();
    [...items, ...bills].forEach(x => { const d = new Date(x.created); marks.add(d.toDateString()); });

    const y = cursor.getFullYear(), m = cursor.getMonth();
    (document.getElementById('calMonth')||{}).textContent = `${y} 年 ${m + 1} 月`;
    const first = new Date(y, m, 1);
    const startPad = (first.getDay() + 6) % 7;      // 周一开头
    const days = new Date(y, m + 1, 0).getDate();
    const grid = document.getElementById('calGrid');
    grid.innerHTML = '';
    for (let i = 0; i < startPad; i++) {
      const c = document.createElement('div'); c.className = 'calCell mute'; grid.appendChild(c);
    }
    for (let d = 1; d <= days; d++) {
      const day = new Date(y, m, d);
      const cell = document.createElement('div');
      cell.className = 'calCell';
      if (sameDay(day, new Date())) cell.classList.add('today');
      if (sameDay(day, sel)) cell.classList.add('sel');
      cell.textContent = d;
      if (marks.has(day.toDateString())) {
        const dot = document.createElement('span'); dot.className = 'dot'; cell.appendChild(dot);
      }
      cell.onclick = () => { sel = day; renderCal(); };
      grid.appendChild(cell);
    }

    const list = document.getElementById('calList');
    list.innerHTML = '';
    const dayItems = items.filter(x => sameDay(new Date(x.created), sel));
    const dayBills = bills.filter(x => sameDay(new Date(x.created), sel));
    (document.getElementById('calHint')||{}).textContent =
      `${sel.getMonth() + 1} 月 ${sel.getDate()} 日：记录 ${dayItems.length} 条 · 账 ${dayBills.length} 笔`;
    dayItems.forEach(x => {
      const el = document.createElement('div'); el.className = 'wk' + (x.done ? ' done' : '');
      el.innerHTML = `<span>${x.text}</span>`;
      list.appendChild(el);
    });
    dayBills.forEach(x => {
      const el = document.createElement('div'); el.className = 'bill';
      el.innerHTML = `<em>${x.cat}</em><span>${x.note || '—'}</span><b>¥${Number(x.amount).toFixed(2)}</b>`;
      list.appendChild(el);
    });
    if (!dayItems.length && !dayBills.length) {
      const el = document.createElement('div'); el.className = 'hint'; el.textContent = '这天没有记录';
      list.appendChild(el);
    }
  }

  (document.getElementById('segCal')||{}).onclick = () => {
    ['segWork', 'segBill'].forEach(id => document.getElementById(id).classList.remove('on'));
    document.getElementById('segCal')?.classList.add('on');
    (document.getElementById('paneWork')||{}).style.display = 'none';
    (document.getElementById('paneBill')||{}).style.display = 'none';
    (document.getElementById('paneCal')||{}).style.display = 'flex';
    renderCal();
  };
  ['segWork', 'segBill'].forEach(id => {
    const el = document.getElementById(id);
    const old = el.onclick;
    el.onclick = (e) => {
      document.getElementById('segCal')?.classList.remove('on');
      (document.getElementById('paneCal')||{}).style.display = 'none';
      if (old) old.call(el, e);
    };
  });
  (document.getElementById('calPrev')||{}).onclick = () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1); renderCal(); };
  (document.getElementById('calNext')||{}).onclick = () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1); renderCal(); };
  (document.getElementById('calClose')||{}).onclick = () => document.getElementById('sheet-work')?.classList.remove('on');
})();
document.getElementById('deskLink')?.addEventListener('click', () => {
  window.open('https://asteragent.com/', '_blank');
});

/* ---------- 初识问卷（手机） ---------- */
(function () {
  const box = document.getElementById('obM');
  if (!box) return;
  const QS = [
    {k: 'call_name', q: '你希望我怎么称呼你？', type: 'text', ph: '留空也行'},
    {k: 'rhythm', q: '你更习惯哪一种相处节奏？', type: 'opt',
     opts: [['quiet', '安静一点，不必频繁说话'], ['discuss', '可以一起探讨、交换想法']]},
    {k: 'thinking', q: '看待事情，你更偏向？', type: 'opt',
     opts: [['feel', '先感受氛围与情绪'], ['logic', '先理清逻辑与事实']]},
    {k: 'forbidden', q: '有没有不想被提起的话题？', type: 'text', ph: '可以填「暂时没有」'},
  ];
  const ans = {};
  let i = 0;

  const show = (on) => box.classList.toggle('hide', !on);
  window.__openOnboarding = () => {
    i = 0;
    Object.keys(ans).forEach(k => delete ans[k]);
    paint();
    show(true);
  };

  function paint() {
    const q = QS[i];
    (document.getElementById('obStep')||{}).textContent = (i + 1) + ' / 4';
    (document.getElementById('obTitle')||{}).textContent = q.q;
    const input = document.getElementById('obInput');
    const opts = document.getElementById('obOpts');
    input.value = ans[q.k] || '';
    input.placeholder = q.ph || '';
    if (window.__speakQ) window.__speakQ(i);
    if (q.type === 'text') { input.style.display = 'block'; opts.innerHTML = ''; }
    else {
      input.style.display = 'none';
      opts.innerHTML = '';
      q.opts.forEach(([v, label]) => {
        const d = document.createElement('div');
        d.className = 'opt' + (ans[q.k] === v ? ' sel' : '');
        d.textContent = label;
        d.onclick = () => { ans[q.k] = v; window.__sfx && window.__sfx('tap', 0.28); paint(); };
        opts.appendChild(d);
      });
    }
  }

  (document.getElementById('obNext')||{}).onclick = async () => {
    window.__sfx && window.__sfx('tap', 0.3);
    const q = QS[i];
    if (q.type === 'text') ans[q.k] = document.getElementById('obInput')?.value.trim();
    if (i < QS.length - 1) { i += 1; paint(); return; }
    ans.forbidden_topic = ans.forbidden || '';
    ans.thinking_tendency = ans.thinking || '';
    await Store.setKV('onboarding', ans);
    // 写成一条记忆
    const bits = [];
    if (ans.call_name) bits.push('称呼：' + ans.call_name);
    if (ans.rhythm === 'quiet') bits.push('喜欢安静一点');
    if (ans.rhythm === 'discuss') bits.push('喜欢一起讨论');
    if (ans.thinking === 'feel') bits.push('先感受情绪');
    if (ans.thinking === 'logic') bits.push('先讲逻辑');
    if (ans.forbidden && ans.forbidden !== '暂时没有') bits.push('不想提：' + ans.forbidden);
    if (bits.length) await Store.add('初识：' + bits.join('，'), '初识', 'core');
    show(false);
    window.__sfxDone && window.__sfxDone();
    window.__duckIntro && window.__duckIntro(0.14);
    add('我记住了', 'her');
  };
  (document.getElementById('obSkip')||{}).onclick = async () => {
    window.__duckIntro && window.__duckIntro(0.14);
    await Store.setKV('onboarding', {skip: true}); show(false);
  };

  (async () => {
    const q = new URLSearchParams(location.search);
    if (q.has('noob')) return;
    const saved = await Store.getKV('onboarding', null);
    if (saved) return;
    paint();
    show(true);
  })();
})();

/* 键盘弹出时把输入框顶上来，并把最后一条消息滚到眼前 */
(function () {
  const ta = document.getElementById('text');
  if (!ta || !window.visualViewport) return;
  const vv = window.visualViewport;
  const fit = () => {
    document.body.style.setProperty('--kb', Math.max(0, window.innerHeight - vv.height - vv.offsetTop) + 'px');
  };
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
  fit();
  ta.addEventListener('focus', () => {
    setTimeout(() => {
      const log = document.getElementById('log');
      if (log) log.scrollTop = log.scrollHeight;
      ta.scrollIntoView({block: 'nearest'});
    }, 220);
  });
  // 手机回车就发；电脑 Shift+回车换行
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      document.getElementById('send').click();
    }
  });
})();

/* ---------- 会动的 logo：横着的双螺旋 ---------- */
(function () {
  const cv = document.getElementById('obLogo');
  if (!cv) return;
  const W = 176, H = 60;
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const N = 20;
  let t = 0, vel = 0.011, tilt = 0, target = 0, press = 0, breathT = 0;

  function draw() {
    g.clearRect(0, 0, W, H);
    const cy = H / 2;
    const amp = H * 0.30 * (1 + press * 0.10);
    const left = W * 0.05, span = W * 0.90;
    const roll = (t * 0.5) % 1;
    // 缓慢的明暗起伏：约 7 秒一个来回
    const breath = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(breathT * 0.9));
    const glow = 0.85 + 0.25 * breath;
    const strands = [[], []];

    for (let i = 0; i < N; i++) {
      const u = (i + roll) / N;
      const x = left + u * span;
      const fade = Math.min(1, Math.min(u, 1 - u) * 5);
      const phase = u * Math.PI * 2.4 + t * 1.5;
      const dy = Math.sin(phase) * amp;
      const z = Math.cos(phase);
      strands[0].push({x, y: cy + dy * (1 + tilt * 0.4), z, a: fade});
      strands[1].push({x, y: cy - dy * (1 - tilt * 0.4), z: -z, a: fade});
    }

    for (let i = 0; i < N; i += 2) {
      const a = strands[0][i], b = strands[1][i];
      const d = (a.z + b.z) / 2;
      g.strokeStyle = 'rgba(232,23,61,' + ((0.10 + 0.16 * (d + 1) / 2) * a.a * breath).toFixed(3) + ')';
      g.lineWidth = 1.1;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }

    const all = [...strands[0], ...strands[1]].sort((p1, p2) => p1.z - p2.z);
    all.forEach(p1 => {
      const near = (p1.z + 1) / 2;
      const r = (1.1 + 1.7 * near) * (1 + press * 0.25) * (0.92 + 0.14 * breath);
      const grd = g.createRadialGradient(p1.x, p1.y, 0, p1.x, p1.y, r * 4);
      grd.addColorStop(0, 'rgba(232,23,61,' + ((0.14 + 0.28 * near) * p1.a * breath).toFixed(3) + ')');
      grd.addColorStop(1, 'rgba(232,23,61,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(p1.x, p1.y, r * 4, 0, 7); g.fill();
      g.fillStyle = 'rgba(232,23,61,' + Math.min(1, (0.45 + 0.5 * near) * p1.a * glow).toFixed(3) + ')';
      g.beginPath(); g.arc(p1.x, p1.y, Math.max(1.1, r * 0.55), 0, 7); g.fill();
    });
  }

  function tick() {
    if (!reduce) { t += vel; breathT += 0.016; }
    tilt += (target - tilt) * 0.08;
    press *= 0.92;
    draw();
    requestAnimationFrame(tick);
  }
  tick();

  const onMove = (e) => {
    const r = cv.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    target = ((p.clientX - r.left) / r.width - 0.5) * 1.6;
  };
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerdown', (e) => { press = 1; vel = 0.045; onMove(e); });
  cv.addEventListener('pointerup', () => { vel = 0.011; });
  cv.addEventListener('pointerleave', () => { target = 0; vel = 0.011; });
})();

/* ---------- 中英文 ---------- */
(function () {
  const KEY = 'aster.lang.m';
  const DICT = {
    zh: {home:'首页', chat:'对话', work:'记录', memory:'记忆', set:'设置', say:'说点什么…',
         list:'清单', bill:'账单', cal:'日历', today:'今天', add:'加'},
    en: {home:'Home', chat:'Chat', work:'Notes', memory:'Memory', set:'Settings', say:'Say something…',
         list:'List', bill:'Bills', cal:'Calendar', today:'Today', add:'Add'},
  };
  // 全站文案（中文 → 英文）；切语言时按文本节点替换
  const TEXT_MAP = {
    "本地存储（简易）": "Local only",
    "新话题": "New topic",
    "安静地看着你": "Quietly watching you",
    "还没有情绪": "no mood yet",
    "未连接桌面端，仅可临时记录，无法长久留存": "Not paired with a desktop. Temporary records only.",
    "先到「设置」里填 API，填完就能说话（点这里）": "Add your API key in Settings to start talking (tap here)",
    "说点什么…": "Say something…",
    "在吗": "You there?",
    "今天有点累": "Tired today",
    "帮我想想": "Help me think",
    "随便聊聊": "Just chat",
    "清单": "List",
    "账单": "Bills",
    "日历": "Calendar",
    "今天": "Today",
    "记忆": "Memory",
    "设置": "Settings",
    "首页": "Home",
    "对话": "Chat",
    "记录": "Notes",
    "记一条：做了什么 / 要做什么": "Note what you did / what to do",
    "加": "Add",
    "复制今天的清单": "Copy today's list",
    "关掉": "Close",
    "金额": "Amount",
    "花在哪": "Spent on",
    "记一笔": "Add",
    "删除": "Delete",
    "点一天看当天的记录和账": "Tap a day to see its notes and bills",
    "保存": "Save",
    "测试": "Test",
    "语言": "Language",
    "音效": "Sound",
    "外观": "Theme",
    "记忆整理": "Memory cleanup",
    "跟随时间": "Auto (sun)",
    "白天": "Light",
    "夜间": "Dark",
    "中文": "中文",
    "开": "On",
    "关": "Off",
    "今天 · 花了多少": "Today · spent",
    "记一笔账": "Add a bill",
    "总支出": "Total",
    "未配置": "Not set",
    "条记忆": "records",
    "临时记录": "Temporary records",
    "今天还没记账": "No bills today yet",
    "今天还空着。记一条，晚上好回顾": "Nothing yet today. Add one, review it tonight",
    "关于": "About",
    "到官网下载": "Download from the site",
    "同步": "Sync",
    "同步到电脑": "Sync to desktop",
    "复制今天的账": "Copy today's bills",
    "导入": "Import",
    "导出": "Export",
    "开场那一声、问卷的朗读，都在这里关": "The opening chime and the narration are turned off here",
    "最近": "Recent",
    "未连接 · 只在本机临时记录": "Not paired · temporary records only",
    "本地优先 · 记忆归你": "Local first · memory is yours",
    "桌面版": "Desktop",
    "模型名": "Model",
    "现在整理": "Compact now",
    "立即同步": "Sync now",
    "给第一次打开我的人": "To whoever opens me first",
    "继续": "Continue",
    "自动同步：关": "Auto sync: off",
    "记忆包": "Memory pack",
    "识图模型（选填，拍照记账用）": "Vision model (optional, for photo bills)",
    "跳过初识": "Skip",
    "还没有记忆，聊几句就有了": "No memory yet. Talk a little and it starts",
    "进入": "Come in",
    "连接桌面（主库）· 需原生版": "Pair with desktop · native app only",
    "配对": "Pair",
    "陪着你，慢慢生长": "Growing, slowly, with you",
    "因为我们本来就不做这件事。": "Because we were never doing that.",
    "API Key （只存在这台手机）": "API Key (stays on this phone)",
    "攒够了就把最早的对话压成一句「那天的摘要」，原文进归档；核心记忆不动。": "Once there is enough, the earliest turns get squeezed into a one-line summary; the originals are archived. Core memories stay untouched.",
    "如 gpt-4o-mini / qwen-vl-max": "e.g. gpt-4o-mini / qwen-vl-max",
  };

  function translateDOM(lang) {
    const root = document.body;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(n => {
      const raw = n.nodeValue;
      const key = raw.trim();
      if (!key) return;
      n.__zh = n.__zh || raw;
      const zh = n.__zh.trim();
      if (lang === 'en' && TEXT_MAP[zh]) n.nodeValue = raw.replace(zh, TEXT_MAP[zh]);
      else if (lang === 'zh' && n.__zh) n.nodeValue = n.__zh;
    });
    document.querySelectorAll('[placeholder]').forEach(el => {
      el.__zhp = el.__zhp || el.placeholder;
      const zhp = el.__zhp.trim();
      if (lang === 'en' && TEXT_MAP[zhp]) el.placeholder = TEXT_MAP[zhp];
      else if (lang === 'zh' && el.__zhp) el.placeholder = el.__zhp;
    });
  }

  function apply(lang) {
    const d = DICT[lang] || DICT.zh;
    const navs = document.querySelectorAll('nav button');
    if (navs[0]) navs[0].lastChild.textContent = d.home;
    if (navs[1]) navs[1].lastChild.textContent = d.work;
    if (navs[2]) navs[2].lastChild.textContent = d.memory;
    if (navs[3]) navs[3].lastChild.textContent = d.set;
    const ta = document.getElementById('text');
    if (ta) ta.placeholder = d.say;
    ['segWork','segBill','segCal'].forEach((id, i) => {
      const el = document.getElementById(id);
      if (el) el.textContent = [d.list, d.bill, d.cal][i];
    });
    document.querySelectorAll('#langChips button').forEach(b => b.classList.toggle('on', b.dataset.lang === lang));
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    localStorage.setItem(KEY, lang);
    translateDOM(lang);
  }
  const box = document.getElementById('langChips');
  if (box) box.onclick = (e) => { const b = e.target.closest('button'); if (b) apply(b.dataset.lang); };
  apply(localStorage.getItem(KEY) || 'zh');
})();
document.getElementById('compactBtn')?.addEventListener('click', async () => {
  const el = document.getElementById('compactMsg');
  el.textContent = '整理中…';
  try {
    const r = await compactMemory({limit: 20, batch: 40});
    el.textContent = r.moved ? `整理了 ${r.moved} 条，生成 ${r.digests} 条摘要` : '还不用整理（对话不多）';
  } catch (e) { el.textContent = '没整理成：' + e.message; }
});
document.getElementById('newTopic')?.addEventListener('click', async () => {
  if (!confirm('开个新话题？之前的上下文不再接着说了，记忆照旧保留')) return;
  await Store.setKV('turns', []);
  await Store.setKV('aster.ui.history', []);
  document.getElementById('log').innerHTML = '';
  add('换个话题，重新开始', 'sys');
});
(function () {
  let last = null;
  const say = (t) => { if (t !== last) { last = t; add(t, 'sys'); } };
  window.addEventListener('offline', () => say('没网了，先记着，等有网再发'));
  window.addEventListener('online', () => say('网回来了'));
  if (!navigator.onLine) setTimeout(() => say('现在没网，只能看和记'), 800);
})();

/* ---------- 头像 ---------- */
(function () {
  const img = document.getElementById('myAvatar');
  if (!img) return;
  const KEY = 'aster.avatar';
  const paint = (data) => {
    if (data) { img.src = data; img.style.background = 'transparent'; }
  };
  try { Store.getKV(KEY, null).then(paint); } catch (e) {}
  img.onclick = () => {
    const f = document.createElement('input');
    f.type = 'file'; f.accept = 'image/*';
    f.onchange = async () => {
      const file = f.files[0]; if (!file) return;
      const data = await new Promise(res => {
        const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(file);
      });
      // 压到 256 以内，省空间
      const im = new Image();
      im.onload = async () => {
        const s = 256 / Math.max(im.width, im.height);
        const c = document.createElement('canvas');
        c.width = Math.round(im.width * Math.min(1, s));
        c.height = Math.round(im.height * Math.min(1, s));
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        const out = c.toDataURL('image/jpeg', 0.82);
        await Store.setKV(KEY, out);
        paint(out);
      };
      im.src = data;
    };
    f.click();
  };
})();

/* ---------- 音效与朗读 ---------- */
(function () {
  const SKEY = 'aster.sound';
  const on = () => localStorage.getItem(SKEY) !== '0';
  const audio = {};
  const SRC = { tap: 'sfx/tap.m4a', done: 'sfx/done.m4a', view: 'sfx/view.m4a', stage: 'sfx/stage.m4a', open: 'sfx/open.m4a' };
  const play = (name, vol = 0.7) => {
    if (!on()) return;
    try {
      audio[name] = audio[name] || new Audio(SRC[name] || (name + '.m4a'));
      audio[name].volume = vol;
      audio[name].currentTime = 0;
      audio[name].play().catch(() => {});
    } catch (e) {}
  };
  window.__play = play;

  // 开场音乐：一路放，进主界面只是压低，不停
  let openAudio = null, duckTimer = null;
  const startOpen = () => {
    if (!on()) return;
    try {
      openAudio = openAudio || new Audio('sfx/open.m4a');
      openAudio.preload = 'auto';
      openAudio.loop = true; openAudio.volume = 0.42;
      openAudio.play().catch(() => {});
    } catch (e) {}
  };
  window.__duckIntro = (to = 0.14) => {
    if (!openAudio) return;
    clearInterval(duckTimer);
    duckTimer = setInterval(() => {
      const v = openAudio.volume;
      if (Math.abs(v - to) < 0.01) { openAudio.volume = to; clearInterval(duckTimer); return; }
      openAudio.volume = v + (to - v) * 0.12;
    }, 90);
  };
  window.__stopIntro = () => {
    if (!openAudio) return;
    clearInterval(duckTimer);
    const a = openAudio; openAudio = null;
    let v = a.volume;
    const t = setInterval(() => {
      v = Math.max(0, v - 0.03); a.volume = v;
      if (v <= 0) { clearInterval(t); a.pause(); }
    }, 80);
  };
  // 只有「第一次来（还没做过问卷）」才放整首开场乐；之后每次进来只给一声短的
  const playEntry = () => {
    if (!on()) return;
    try {
      const a = new Audio('sfx/entry.m4a');
      a.volume = 0.5;
      a.play().catch(() => {});
    } catch (e) {}
  };
  // 浏览器不许「没点就响」：先试一次，被拦就等下一次触摸再试，直到真的响
  let audioStarted = false;
  const tryStartAudio = async () => {
    if (audioStarted || !on()) return audioStarted;
    let first = false;
    try { first = !(await Store.getKV('onboarding', null)); } catch (e) { first = true; }
    if (first) startOpen(); else playEntry();
    audioStarted = true;
    return true;
  };
  tryStartAudio();
  const kickAudio = () => { tryStartAudio(); };
  document.addEventListener('pointerdown', kickAudio, true);
  document.addEventListener('touchstart', kickAudio, { passive: true });

  /* 界面音：轻、短，不做满 */
  const sfx = (n, v) => { try { play(n, v ?? 0.35); } catch {} };
  // 问卷答完：一声「完成」
  window.__sfxDone = () => sfx('done', 0.3);
  window.__sfx = sfx;

  // 问卷：每题读出来
  const speakQ = (i) => play('q' + (i + 1), 0.85);
  window.__speakQ = speakQ;
})();

(function () {
  const KEY = 'aster.sound';
  const box = document.getElementById('soundChips');
  if (!box) return;
  const paint = () => {
    const v = localStorage.getItem(KEY) !== '0' ? '1' : '0';
    box.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.sound === v));
  };
  box.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    localStorage.setItem(KEY, b.dataset.sound === '1' ? '1' : '0');
    paint();
    if (b.dataset.sound === '1') window.__play && window.__play('intro', 0.5);
  };
  paint();
})();

/* ---------- 扫一扫配对（浏览器原生 BarcodeDetector；不支持就退回手动） ---------- */
$('#scanPair') && ($('#scanPair').onclick = async () => {
  const msg = $('#pairMsg');
  if (!('BarcodeDetector' in window)) {
    msg.textContent = '这台手机不支持网页扫码，请点「自动查找」或手动填地址';
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (e) {
    msg.textContent = '打不开摄像头（需要 https 并且允许权限）';
    return;
  }
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;background:#000;z-index:9999;display:flex;align-items:center;justify-content:center';
  const v = document.createElement('video');
  v.playsInline = true; v.style.cssText = 'width:100%;height:auto';
  box.appendChild(v); document.body.appendChild(box);
  v.srcObject = stream; await v.play();
  msg.textContent = '把电脑上的二维码框进画面…';
  const det = new BarcodeDetector({ formats: ['qr_code'] });
  const t0 = Date.now();
  const tick = async () => {
    if (Date.now() - t0 > 30000) { stop(); msg.textContent = '没扫到，超时了'; return; }
    try {
      const codes = await det.detect(v);
      if (codes.length && codes[0].rawValue) {
        const url = String(codes[0].rawValue);
        stop();
        const m = url.match(/^(https?:\/\/[^\/]+)/);
        if (m) {
          $('#deskUrl2').value = m[1];
          $('#pairMsg').textContent = '已扫到：' + m[1] + '，点「配对」完成';
        } else { msg.textContent = '这不是配对的码'; }
        return;
      }
    } catch (e) {}
    requestAnimationFrame(tick);
  };
  function stop() {
    try { stream.getTracks().forEach(t => t.stop()); } catch (e) {}
    box.remove();
  }
  tick();
});

/* ---------- 自动查找电脑（同一 Wi-Fi，靠 aster.local 这个名字） ---------- */
$('#autoFindDesk') && ($('#autoFindDesk').onclick = async () => {
  const msg = $('#pairMsg');
  msg.textContent = '正在找…（手机要和电脑连同一个 Wi-Fi）';
  const hosts = ['aster.local'];
  const ports = [8777, 8778, 8779, 8790, 8791, 8792];
  for (const h of hosts) {
    for (const p of ports) {
      const url = `http://${h}:${p}`;
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 1200);
        const r = await fetch(url + '/health', { signal: ctl.signal });
        clearTimeout(t);
        if (r.ok) {
          const d = await r.json();
          if (d && d.engine) {
            $('#deskUrl2').value = url;
            msg.textContent = '找到了：' + url;
            return;
          }
        }
      } catch (e) { /* 继续找下一个 */ }
    }
  }
  msg.textContent = '没找到。网页版可能被浏览器挡住；套壳版可以。也可以手动填地址。';
});

/* ---------- 连接桌面：配对 / 队列 / 状态 ---------- */
(function () {
  const note = document.getElementById('linkNote');
  const state = document.getElementById('linkState');
  const msg = document.getElementById('pairMsg');

  const paint = async () => {
    const {url, token} = await deskConfig();
    const left = await Store.queueCount();
    const EN = localStorage.getItem('aster.lang.m') === 'en';
    const linked = !!(url && token);
    if (note) note.textContent = linked
      ? (EN ? 'Your memory lives on the desktop; this device is just a window'
            : '记忆主库在你的桌面设备，本机仅为交互窗口')
      : (EN ? 'Not paired with a desktop — temporary records only'
            : '未连接桌面端，仅可临时记录，无法长久留存');
    if (state) state.textContent = linked
      ? `已连接 ${url}${left ? ' · 待送 ' + left + ' 条' : ' · 已同步'}`
      : '未连接 · 只在本机临时记录';
    const badge = document.getElementById('count');
    if (badge && linked) badge.textContent = left ? (EN ? `${left} pending` : `${left} 条待送`) : (EN ? 'Synced' : '已同步');
    const u = document.getElementById('deskUrl2');
    if (u && !u.value && url) u.value = url;
  };
  window.__paintLink = paint;
  paint();
  setInterval(() => { paint(); deliverQueue().then(paint).catch(() => {}); }, 30000);

  document.getElementById('pairBtn')?.addEventListener('click', async () => {
    const url = document.getElementById('deskUrl2')?.value.trim();
    const code = document.getElementById('pairCode')?.value.trim();
    msg.textContent = '配对中…';
    try {
      await pairDesk(url, code);
      msg.textContent = '配好了，之后会自动同步';
      await paint();
      await deliverQueue();
      await paint();
    } catch (e) { msg.textContent = e.message; }
  });

  document.getElementById('syncNow')?.addEventListener('click', async () => {
    msg.textContent = '同步中…';
    const r = await deliverQueue();
    msg.textContent = r.needPair ? '还没配对' : r.offline ? '连不上桌面，等会儿再试' : (r.sent ? `送出去 ${r.sent} 条` : '没有待送的东西');
    await paint();
  });
})();

/* ---------- 首页：头像 + 招呼 + 三张卡 ---------- */
(function () {
  const hero = document.getElementById('hero');
  if (!hero) return;
  const log = document.getElementById('log');
  const av = document.getElementById('heroAvatar') || {src: ''};

  const paintHi = () => {
    const h = new Date().getHours();
    const word = h < 6 ? '还没睡' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 19 ? '下午好' : '晚上好';
    (document.getElementById('heroHi')||{}).textContent = word;
    Store.getKV('aster.avatar', null).then(v => { if (v) av.src = v; });
    const src = document.getElementById('myAvatar');
    if (src && src.src) av.src = src.src;
  };
  paintHi();

  const syncHero = () => {
    const has = log.querySelector('.msg:not(.sys)');
    hero.classList.toggle('hide', !!has);
  };
  syncHero();
  new MutationObserver(syncHero).observe(log, {childList: true});

  hero.querySelectorAll('.heroCards button').forEach(b => {
    b.onclick = () => {
      const act = b.dataset.act;
      if (act === 'note') { document.querySelector('nav button[data-tab=work]').click(); return; }
      if (act === 'bill') {
        document.querySelector('nav button[data-tab=work]').click();
        setTimeout(() => document.getElementById('segBill').click(), 120);
        return;
      }
      document.getElementById('text').focus();
    };
  });
})();

/* ---------- 首页 / 抽屉 / 最近 ---------- */
(function () {
  const chat = document.getElementById('viewChat');
  const drawer = document.getElementById('drawer');

  const go = (name) => {
    if (name === 'home') { name = 'chat'; }
    if (name === 'chat') { chat.classList.add('on'); return; }
    if (name === 'about') {
      add('Aster：本地优先的数字个体，记忆存在你自己的设备上', 'sys');
      add('版本 ' + (localStorage.getItem('aster.build') || '1.0.0'), 'sys');
      return;
    }
    if (name === 'bill' || name === 'cal') {
      document.querySelector('nav button[data-tab=work]')?.click();
      setTimeout(() => document.getElementById(name === 'bill' ? 'segBill' : 'segCal')?.click(), 120);
      return;
    }
    document.querySelector(`nav button[data-tab=${name}]`)?.click();
  };
  window.__go = go;

  const mb = document.getElementById('menuBtn');
  if (mb) mb.onclick = () => drawer.classList.remove('hide');
  if (new URLSearchParams(location.search).get('open') === '1') drawer.classList.remove('hide');
  const dm = document.getElementById('drawerMask'); if (dm) dm.onclick = () => drawer.classList.add('hide');
  drawer.querySelectorAll('button[data-go]').forEach(b => b.onclick = () => {
    drawer.classList.add('hide');
    const target = b.dataset.go;
    if (target === 'chat') { chat.classList.add('on'); return; }
    go(target);
  });
  document.querySelectorAll('.acctTools button').forEach(b => b.onclick = () => {
    if (b.dataset.tool === 'new') { newChat(); return; }
    go(b.dataset.tool);
  });
  const nc = document.getElementById('newChat'); if (nc) nc.onclick = newChat;
  const ca = document.getElementById('clearAll'); if (ca) ca.onclick = async () => {
    if (!confirm('清空聊天记录？（记忆不受影响）')) return;
    await Store.setKV('aster.ui.history', []);
    document.getElementById('log').innerHTML = '';
  };

  async function newChat() {
    await Store.setKV('turns', []);
    document.getElementById('log').innerHTML = '';
    go('chat');
    document.getElementById('text').focus();
  }
  window.__newChat = newChat;

  go('chat');

  // 左滑打开抽屉
  let sx = 0, sy = 0;
  document.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, {passive: true});
  document.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - sx;
    const dy = Math.abs(e.changedTouches[0].clientY - sy);
    if (dx > 60 && dy < 40 && !drawer.classList.contains('hide') === false) {
      drawer.classList.remove('hide');
    }
  }, {passive: true});
})();



/* ---------- 信页的背景音乐 ---------- */
(function () {
  const box = document.getElementById('letter');
  if (!box) return;
  const on = () => localStorage.getItem('aster.sound') !== '0';
  let a = null;

  const start = () => {
    if (!on()) return;
    try {
      a = a || new Audio('bgm-letter.m4a');
      a.loop = true; a.volume = 0; a.play().catch(() => {});
      // 三秒淡入
      let v = 0;
      const t = setInterval(() => {
        v = Math.min(0.26, v + 0.02);
        a.volume = v;
        if (v >= 0.26) clearInterval(t);
      }, 120);
    } catch (e) {}
  };
  const stop = () => {
    if (!a) return;
    const t = setInterval(() => {
      a.volume = Math.max(0, a.volume - 0.03);
      if (a.volume <= 0.001) { clearInterval(t); a.pause(); a.currentTime = 0; }
    }, 90);
  };

  // 信显示时开，点「进入」关
  const obs = new MutationObserver(() => {
    if (!box.classList.contains('hide')) start();
  });
  obs.observe(box, {attributes: true, attributeFilter: ['class']});
  if (!box.classList.contains('hide')) start();
  box.querySelector('.go')?.addEventListener('click', stop);
})();

/* ---------- 抽屉里的「最近」：最多三条 ---------- */
(async function () {
  const box = document.getElementById('drawerFeed');
  if (!box) return;
  const today = (ts) => {
    const d = new Date(ts), n = new Date();
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  };
  const rows = [];

  try {
    const items = await Store.all(60);
    const memo = items.find(x => x.kind === 'core' || x.tag === '约定' || x.tag === '初识');
    if (memo) rows.push({t: memo.text.replace(/\n/g, ' ').slice(0, 26), go: 'memory'});
  } catch (e) {}

  try {
    const works = (await Store.works(80)).filter(w => !w.done && today(w.created));
    if (works.length) rows.push({t: works[0].text.slice(0, 26), go: 'work'});
  } catch (e) {}

  try {
    const bills = (await Store.bills(80)).filter(b => today(b.created));
    if (bills.length) {
      const sum = bills.reduce((a, b) => a + (b.amount || 0), 0);
      rows.push({t: `今天花了 ¥${sum.toFixed(0)}`, go: 'bill'});
    }
  } catch (e) {}

  if (!rows.length) return;
  box.innerHTML = '<div class="ft">最近</div>';
  rows.slice(0, 3).forEach(r => {
    const b = document.createElement('button');
    b.innerHTML = `<span class="dot"></span><span>${r.t}</span>`;
    b.onclick = () => {
      document.getElementById('drawer')?.classList.add('hide');
      document.querySelector('nav button[data-tab=work]')?.click();
      if (r.go === 'memory') document.querySelector('nav button[data-tab=memory]')?.click();
      if (r.go === 'bill') setTimeout(() => document.getElementById('segBill').click(), 120);
    };
    box.appendChild(b);
  });
  box.classList.add('on');
})();

/* ---------- 重做初识 ---------- */
document.getElementById('redoOnboarding')?.addEventListener('click', async () => {
  if (!confirm('重新做一遍初识？聊天记录和记忆不会删')) return;
  await Store.setKV('onboarding', null);
  if (window.__openOnboarding) window.__openOnboarding();
  else location.reload();
});

/* 记忆闭环自检：手机上没引擎，就自测本机存储 */
document.getElementById('memLoopBtn')?.addEventListener('click', async () => {
  const el = document.getElementById('memLoopM');
  el.style.color = ''; el.textContent = '检查中…';
  try {
    const token = '探针' + Math.random().toString(36).slice(2, 8);
    await Store.add('我说：闭环' + token, '自检', 'core');
    const items = await Store.all(50);
    const hit = items.some(x => (x.text || '').includes(token));
    const latest = items.find(x => !(x.text || '').includes(token));
    el.style.color = hit ? '#3ecf8e' : '#e8173d';
    el.textContent = hit
      ? `临时记录：存储正常（本机 ${await Store.count()} 条，能写也能读回来）` +
        (latest && latest.text ? `\n最近记得：${String(latest.text).replace(/^我说：/, '').slice(0, 40)}` : '')
      : '临时记录：存不住（写进去了但读不回来）';
  } catch (e) {
    el.style.color = '#e8173d';
    el.textContent = '临时记录：检查失败（' + e.message + '）';
  }
});

/* ---------- 版本自检 / 离线 / 主屏引导 / 导出提醒 ---------- */
(function () {
  // 装在原生壳里（鸿蒙/安卓）时，它已经在桌面上了，不用再「加主屏」
  const native = new URLSearchParams(location.search).get('native') || window.__ASTER_NATIVE || '';
  if (native) {
    const h = document.getElementById('installHint');
    const b = document.getElementById('installBtn');
    if (h) h.textContent = native === 'harmony'
      ? '已经在桌面上了；想要的话可以把「今天」做成服务卡片'
      : '已经在桌面上了';
    if (b) b.style.display = 'none';
  }
  const bar = document.getElementById('banner');
  const say = (html, tone) => {
    if (!bar) return;
    bar.className = 'banner' + (tone === 'warn' ? ' off' : '');
    bar.innerHTML = html;
    bar.hidden = false;
  };
  const hide = () => { if (bar) bar.hidden = true; };

  /* 1) 离线：先存本机，别让人以为坏了 */
  const netLine = () => say('现在没网 · 你说的先存在这台手机上，来了网再送过去',
    'warn');
  window.addEventListener('offline', netLine);
  window.addEventListener('online', () => { hide(); });
  if (!navigator.onLine) netLine();

  /* 2) 版本自检：不强制刷新，给一条提示 */
  // 上次看到的构建号记在本机：下次打开发现变了就提示，不打断当前对话
  let BUILD = localStorage.getItem('aster.build') || null;
  let lastCheck = 0;
  async function checkVersion(force) {
    if (!force && Date.now() - lastCheck < 5 * 60 * 1000) return;
    lastCheck = Date.now();
    try {
      const r = await fetch('version.json?_=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      if (!d || !d.build) return;
      if (!BUILD) { BUILD = d.build; localStorage.setItem('aster.build', BUILD); return; }
      if (d.build !== BUILD) {
        say('有新版本了 · 现在用的还是旧的',
            'warn');
        const b = document.createElement('button');
        b.textContent = '现在换上';
        b.onclick = async () => {
          localStorage.setItem('aster.build', d.build);
          try {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map(r => r.unregister()));
            if (window.caches) {
              const ks = await caches.keys();
              await Promise.all(ks.map(k => caches.delete(k)));
            }
          } catch (e) {}
          location.reload();
        };
        bar.appendChild(b);
        const c = document.createElement('button');
        c.textContent = '下次';
        c.onclick = hide;
        bar.appendChild(c);
      }
    } catch {}
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { checkVersion(false); checkExport(); }
  });
  checkVersion(true);
  // 主存空了但快照里有东西 → 自动回灌（浏览器清了 IDB 也能救回来）
  (async () => {
    try {
      const n = await Store.count();
      const snap = Store.snapshotInfo();
      if (n === 0 && snap && snap.count > 0) {
        const back = await Store.restoreFromSnapshot();
        if (back > 0) say('把上次的快照找回来了 · ' + back + ' 条', 'warn');
      }
    } catch {}
  })();

  (async () => {
    try {
      if (!localStorage.getItem('aster.lastExportAt')) {
        const n = await Store.count();
        if (n > 0) {
          localStorage.setItem('aster.lastExportAt', String(Date.now()));
          localStorage.setItem('aster.lastExportCount', String(n));
        }
      }
    } catch {}
  })();

  /* 3) 主屏引导：ios 只能在设置页提示，安卓用系统的安装事件 */
  let installEvent = null;
  if (!native) window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); installEvent = e;
    if (localStorage.getItem('aster.installPrompted')) return;
    say('把 Aster 放到主屏，像 App 一样打开',
        'warn');
    const b = document.createElement('button');
    b.textContent = '放到主屏';
    b.onclick = async () => { try { installEvent.prompt(); } catch {} hide(); };
    bar.appendChild(b);
    const c = document.createElement('button');
    c.textContent = '不用';
    c.onclick = () => { localStorage.setItem('aster.installPrompted', '1'); hide(); };
    bar.appendChild(c);
  });

  /* 4) 导出提醒：距上次导出 ≥7 天 且新增 ≥20 条 */
  async function checkExport() {
    try {
      const last = Number(localStorage.getItem('aster.lastExportAt') || 0);
      const n = await Store.count();
      const base = Number(localStorage.getItem('aster.lastExportCount') || 0);
      if (!last) return;
      const days = (Date.now() - last) / 86400000;
      if (days >= 7 && n - base >= 20) {
        say('这台手机上已经有 ' + n + ' 条了 · 导出一份留底更稳', 'warn');
        const b = document.createElement('button');
        b.textContent = '现在导出';
        b.onclick = () => { document.getElementById('exportPack')?.click(); hide(); };
        bar.appendChild(b);
        const c = document.createElement('button');
        c.textContent = '过几天';
        c.onclick = hide;
        bar.appendChild(c);
      }
    } catch {}
  }
  window.__checkExport = checkExport;
})();

document.getElementById('installBtn')?.addEventListener('click', () => {
  const el = document.getElementById('installHint');
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  el.textContent = ios
    ? 'Safari 里点底部「分享」→ 往下找「添加到主屏幕」→ 添加'
    : '浏览器菜单（右上角三个点）→「添加到主屏幕」或「安装应用」';
});

/* 声音规格：网页版只能比「规格文件在不在、有没有设定」，发声本身在桌面端 */
(async () => {
  const el = document.getElementById('voiceLockLine');
  if (!el) return;
  try {
    const r = await fetch('voice.lock.json?_=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) { el.textContent = '没有声音规格文件'; return; }
    const d = await r.json();
    const set = !!(d.reference && d.reference.path);
    el.textContent = set
      ? `声音已设定：${d.voice_id}（${d.model.name || '本地模型'}）`
      : '还没设定声音——现在用的是临时声，等桌面端定好会同步过来';
  } catch { el.textContent = '声音规格读不到'; }
})();