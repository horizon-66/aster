/* 手机 → 电脑：进了同一个局域网、电脑开着，就把今天的东西并过去 */
(function () {
  const K_BASE = 'aster.sync.base';
  const K_LAST = 'aster.sync.last';
  const base = () => (localStorage.getItem(K_BASE) || '').replace(/\/$/, '');
  try {
    const q = new URLSearchParams(location.search);
    const fromQr = q.get('sync');
    if (fromQr) {
      localStorage.setItem(K_BASE, String(fromQr).replace(/\/$/, ''));
      history.replaceState({}, '', location.pathname);
    }
  } catch (e) {}

  async function probe() {
    const b = base();
    if (!b) return false;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 1500);
      const r = await fetch(b + '/sync/ping', {signal: ctl.signal});
      clearTimeout(t);
      if (!r.ok) return false;
      const d = await r.json();
      return !!d.ok;
    } catch (e) { return false; }
  }

  function today(ts) {
    const d = new Date(ts || Date.now()), n = new Date();
    return d.toDateString() === n.toDateString();
  }

  async function collect() {
    const out = [];
    try {
      const ws = await Store.works(200);
      ws.filter(w => today(w.created)).forEach(w =>
        out.push({kind: 'work', text: (w.text || '') + (w.done ? '（已完成）' : ''), ts: w.created}));
    } catch (e) {}
    try {
      const ms = await Store.all(200);
      ms.filter(m => today(m.created)).slice(0, 20).forEach(m =>
        out.push({kind: 'memory', text: m.text || '', ts: m.created}));
    } catch (e) {}
    try {
      const t = (document.getElementById('mood') || {}).textContent || '';
      if (t && t !== '—') out.push({kind: 'mood', mood: t, ts: Date.now()});
    } catch (e) {}
    try {
      const turns = (await Store.getKV('turns', [])) || [];
      turns.filter(t2 => today(t2.ts || t2.at || Date.now())).slice(-40).forEach(t2 => {
        const u = t2.user || t2.prompt || '';
        const a = t2.assistant || t2.reply || '';
        if (u || a) out.push({kind: 'chat', text: ('我：' + u + ' / 她：' + a).slice(0, 200),
                              ts: t2.ts || Date.now()});
      });
    } catch (e) {}
    return out;
  }

  async function flush(quiet) {
    if (!base()) return {ok: false, reason: '还没填电脑地址'};
    if (!await probe()) return {ok: false, reason: '电脑不在这个网里，或者没开'};
    const items = await collect();
    if (!items.length) return {ok: true, sent: 0};
    try {
      const r = await fetch(base() + '/sync/push', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({items: items.slice(-120)}),
      });
      const d = await r.json();
      if (!d.ok) return {ok: false, reason: '对面没收'};
      localStorage.setItem(K_LAST, String(Date.now()));
      return {ok: true, sent: items.length, got: d.got};
    } catch (e) { return {ok: false, reason: e.message}; }
  }

  window.AsterSync = {probe, flush, base};

  // 打开就试一次，之后每五分钟试一次；回到前台也试
  setTimeout(() => flush(true), 4000);
  setInterval(() => flush(true), 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) flush(true);
  });

  // 抽屉里那颗按钮：填地址 + 立刻同步
  document.addEventListener('DOMContentLoaded', () => {
    const drawer = document.querySelector('.toolPanel');
    if (!drawer) return;
    const btn = document.createElement('button');
    btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3v9M8 8l4 4 4-4"/><path d="M4 15v3a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-3"/></svg><span>同步</span>';
    btn.onclick = async () => {
      if (!base()) {
        // 没有地址：先扫电脑上的二维码
        if (window.AsterScan) { window.AsterScan(); return; }
        const v = prompt('电脑的地址（和手机同一个 Wi-Fi）\n例：http://192.168.1.3:8777');
        if (!v) return;
        localStorage.setItem(K_BASE, v.trim());
      }
      btn.querySelector('span').textContent = '同步中';
      const r = await flush();
      btn.querySelector('span').textContent = '同步';
      if (r.ok) alert(r.sent ? ('同步好了，' + r.sent + ' 条') : '今天没什么要同步的');
      else alert('没同步成：' + r.reason + '\n\n点一下可以重新填地址');
    };
    btn.oncontextmenu = (e) => {
      e.preventDefault();
      localStorage.removeItem(K_BASE);
      alert('地址清掉了。下次点会重新扫');
    };
    drawer.appendChild(btn);
  });
})();
