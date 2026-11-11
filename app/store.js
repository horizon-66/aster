/* 手机端的记忆库：IndexedDB，一条一条存，跟桌面的 mem.db 一个意思 */
/* 有些环境（file:// 打开）IndexedDB 会被拦，退回 localStorage，接口不变 */
let LS_FALLBACK = !('indexedDB' in window) || /[?&]ls=1/.test(location.search);
const LS_KEY = 'aster-fallback-v1';
const LS = {
  read() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{"items":[],"kv":{},"work":[],"bill":[],"archive":[],"queue":[]}'); }
           catch (e) { return {items: [], kv: {}}; } },
  write(d) { localStorage.setItem(LS_KEY, JSON.stringify(d)); },
};

const DB_NAME = 'aster';
const DB_VER = 5;

function dayKeyOf(ts) {
  const d = new Date(ts || Date.now());
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('这个浏览器不支持本地存储')); return; }
    const timer = setTimeout(() => reject(new Error('本地存储打不开（file:// 下面常被拦，用 https 或装到主屏）')), 1500);
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('memory')) {
        const s = db.createObjectStore('memory', {keyPath: 'id', autoIncrement: true});
        s.createIndex('created', 'created');
      }
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', {keyPath: 'k'});
      if (!db.objectStoreNames.contains('bill')) {
        const b = db.createObjectStore('bill', {keyPath: 'id', autoIncrement: true});
        b.createIndex('created', 'created');
      }
      if (!db.objectStoreNames.contains('queue')) {
        const q = db.createObjectStore('queue', {keyPath: 'id'});
        q.createIndex('at', 'at');
      }
      if (!db.objectStoreNames.contains('archive')) {
        const a = db.createObjectStore('archive', {keyPath: 'id', autoIncrement: true});
        a.createIndex('created', 'created');
      }
      if (!db.objectStoreNames.contains('work')) {
        const w = db.createObjectStore('work', {keyPath: 'id', autoIncrement: true});
        w.createIndex('created', 'created');
      }
    };
    req.onsuccess = () => { clearTimeout(timer); resolve(req.result); };
    req.onerror = () => { clearTimeout(timer); reject(req.error); };
  });
}

async function tx(store, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const os = t.objectStore(store);
    let out;
    try { out = fn(os); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
  });
}

async function initStore() {
  if (LS_FALLBACK) return 'ls';
  try {
    await Promise.race([
      openDB(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1200)),
    ]);
    return 'idb';
  } catch (e) {
    LS_FALLBACK = true;      // 被拦就退回 localStorage，功能一样
    return 'ls';
  }
}

async function guard(idbFn, lsFn) {
  if (LS_FALLBACK) return lsFn();
  try { return await idbFn(); }
  catch (e) { LS_FALLBACK = true; return lsFn(); }
}

const Store = {
  /* —— 待投递队列 —— */
  async queueAdd(item) {
    const rec = {id: item.id || ('q-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8)),
                 kind: item.kind || 'text', payload: item.payload || {},
                 at: Date.now(), tries: 0, lastError: null};
    return guard(async () => {
      await tx('queue', 'readwrite', os => os.put(rec));
      return rec;
    }, () => { const d = LS.read(); d.queue = d.queue || []; d.queue.push(rec); LS.write(d); return rec; });
  },
  async queueAll(limit = 100) {
    return guard(async () => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const req = db.transaction('queue', 'readonly').objectStore('queue').index('at').getAll();
        req.onsuccess = () => resolve((req.result || []).slice(0, limit));
        req.onerror = () => reject(req.error);
      });
    }, () => (LS.read().queue || []).slice(0, limit));
  },
  async queueCount() {
    return guard(async () => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const req = db.transaction('queue', 'readonly').objectStore('queue').count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }, () => (LS.read().queue || []).length);
  },
  async queueRemove(ids) {
    const set = new Set(ids);
    return guard(async () => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const t = db.transaction('queue', 'readwrite');
        const os = t.objectStore('queue');
        ids.forEach(id => os.delete(id));
        t.oncomplete = () => resolve(ids.length);
        t.onerror = () => reject(t.error);
      });
    }, () => { const d = LS.read(); d.queue = (d.queue || []).filter(x => !set.has(x.id)); LS.write(d); return ids.length; });
  },
  async queueBump(id, err) {
    return guard(async () => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const t = db.transaction('queue', 'readwrite');
        const os = t.objectStore('queue');
        const g = os.get(id);
        g.onsuccess = () => { const v = g.result; if (v) { v.tries = (v.tries || 0) + 1; v.lastError = err || null; os.put(v); } };
        t.oncomplete = () => resolve(true);
        t.onerror = () => reject(t.error);
      });
    }, () => { const d = LS.read(); const it = (d.queue || []).find(x => x.id === id);
              if (it) { it.tries = (it.tries || 0) + 1; it.lastError = err || null; } LS.write(d); return true; });
  },
  /* —— 归档 —— */
  async moveToArchive(rec) {
    if (LS_FALLBACK) {
      const d = LS.read(); d.archive = d.archive || []; d.archive.push(rec);
      d.items = (d.items || []).filter(x => x.id !== rec.id); LS.write(d); return true;
    }
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(['memory', 'archive'], 'readwrite');
      t.objectStore('archive').add({text: rec.text, tag: rec.tag, kind: rec.kind, created: rec.created});
      t.objectStore('memory').delete(rec.id);
      t.oncomplete = () => resolve(true);
      t.onerror = () => reject(t.error);
    });
  },
  async archiveAll() {
    if (LS_FALLBACK) return LS.read().archive || [];
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction('archive', 'readonly').objectStore('archive').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  /* —— 账单 —— */
  async addBill(amount, note = '', cat = '其他') {
    const rec = {amount: Number(amount) || 0, note, cat, created: Date.now()};
    const ls = () => { const d = LS.read(); d.bill = d.bill || []; rec.id = Date.now(); d.bill.push(rec); LS.write(d); return rec; };
    if (LS_FALLBACK) return ls();
    try { await tx('bill', 'readwrite', os => os.add(rec)); return rec; }
    catch (e) { LS_FALLBACK = true; return ls(); }
  },
  async bills(limit = 300) {
    if (LS_FALLBACK) return (LS.read().bill || []).slice(-limit).reverse();
    return guard(async () => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const t = db.transaction('bill', 'readonly');
        const req = t.objectStore('bill').index('created').openCursor(null, 'prev');
        const out = [];
        req.onsuccess = () => {
          const cur = req.result;
          if (!cur || out.length >= limit) { resolve(out); return; }
          out.push(cur.value); cur.continue();
        };
        req.onerror = () => reject(req.error);
      });
    }, () => (LS.read().bill || []).slice(-limit).reverse());
  },
  async delBill(id) {
    if (LS_FALLBACK) { const d = LS.read(); d.bill = (d.bill || []).filter(x => x.id !== id); LS.write(d); return true; }
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction('bill', 'readwrite');
      t.objectStore('bill').delete(id);
      t.oncomplete = () => resolve(true);
      t.onerror = () => reject(t.error);
    });
  },

  /* —— 工作记录 —— */
  async addWork(text, kind = 'note') {
    const rec = {text, kind, done: 0, created: Date.now()};
    const ls = () => { const d = LS.read(); d.work = d.work || []; rec.id = Date.now(); d.work.push(rec); LS.write(d); return rec; };
    if (LS_FALLBACK) return ls();
    try { await tx('work', 'readwrite', os => os.add(rec)); return rec; }
    catch (e) { LS_FALLBACK = true; return ls(); }
  },
  async works(limit = 200) {
    if (LS_FALLBACK) return (LS.read().work || []).slice(-limit).reverse();
    return guard(async () => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
      const t = db.transaction('work', 'readonly');
      const req = t.objectStore('work').index('created').openCursor(null, 'prev');
      const out = [];
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur || out.length >= limit) { resolve(out); return; }
        out.push(cur.value); cur.continue();
      };
      req.onerror = () => reject(req.error);
      });
    }, () => (LS.read().work || []).slice(-limit).reverse());
  },
  async workExists(text, dayKey) {
    const list = await Store.works(500);
    return list.some(w => (w.text || '') === text && dayKeyOf(w.created) === dayKey);
  },
  async toggleWork(id) {
    if (LS_FALLBACK) { const d = LS.read(); const it = (d.work || []).find(x => x.id === id);
      if (it) it.done = it.done ? 0 : 1; LS.write(d); return; }
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction('work', 'readwrite');
      const os = t.objectStore('work');
      const g = os.get(id);
      g.onsuccess = () => { const v = g.result; if (v) { v.done = v.done ? 0 : 1; os.put(v); } };
      t.oncomplete = () => resolve(true);
      t.onerror = () => reject(t.error);
    });
  },
  /* —— localStorage 分支：同一个接口 —— */
  _lsAdd(text, tag, kind) {
    const d = LS.read();
    const rec = {id: (d.items.at(-1)?.id || 0) + 1, text, tag, kind, created: Date.now(), boost: 1};
    d.items.push(rec); LS.write(d); return rec;
  },
  _lsAll(limit) { return LS.read().items.slice(-limit).reverse(); },
  _lsCount() { return LS.read().items.length; },
  async add(text, tag = '', kind = 'normal') {
    return guard(async () => {
      const rec = {text, tag, kind, created: Date.now(), boost: 1};
      await tx('memory', 'readwrite', os => os.add(rec));
      return rec;
    }, () => Store._lsAdd(text, tag, kind));
  },
  async all(limit = 400) {
    return guard(async () => {
      const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction('memory', 'readonly');
      const req = t.objectStore('memory').index('created').openCursor(null, 'prev');
      const out = [];
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur || out.length >= limit) { resolve(out); return; }
        out.push(cur.value);
        cur.continue();
      };
      req.onerror = () => reject(req.error);
      });
    }, () => Store._lsAll(limit));
  },
  async delMemory(id) {
    if (LS_FALLBACK) { const d = LS.read(); d.items = (d.items || []).filter(x => x.id !== id); LS.write(d); return true; }
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction('memory', 'readwrite');
      t.objectStore('memory').delete(id);
      t.oncomplete = () => resolve(true);
      t.onerror = () => reject(t.error);
    });
  },
  async count() {
    return guard(async () => {
      const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction('memory', 'readonly');
      const req = t.objectStore('memory').count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      });
    }, () => Store._lsCount());
  },
  async getKV(k, dflt = null) {
    return guard(async () => {
      const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction('kv', 'readonly').objectStore('kv').get(k);
      req.onsuccess = () => resolve(req.result ? req.result.v : dflt);
      req.onerror = () => reject(req.error);
      });
    }, () => { const d = LS.read(); return (k in d.kv) ? d.kv[k] : dflt; });
  },
  async setKV(k, v) {
    return guard(async () => {
      const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction('kv', 'readwrite');
      t.objectStore('kv').put({k, v});
      t.oncomplete = () => resolve(true);
      t.onerror = () => reject(t.error);
      });
    }, () => { const d = LS.read(); d.kv[k] = v; LS.write(d); return true; });
  },
  async clearAll() {
    if (LS_FALLBACK) { LS.write({items: [], kv: {}}); return; }
    await tx('memory', 'readwrite', os => os.clear());
    await tx('kv', 'readwrite', os => os.clear());
  },
  async exportPack() {
    const items = await Store.all(100000);
    return {
      kind: 'aster-memory-pack', v: 1,
      exported: new Date().toISOString(),
      items,
      archive: await Store.archiveAll(),
      work: await Store.works(500),
      bills: await Store.bills(500),
      briefs: await Store.getKV('briefs', []),
      onboarding: await Store.getKV('onboarding', {}),
    };
  },
  async importPack(pack, merge = true) {
    const items = (pack.items || []).slice();
    if (!merge) await Store.clearAll();
    let n = 0;
    for (const it of items) {
      await Store.add(it.text || '', it.tag || '', it.kind || 'normal');
      n += 1;
    }
    if (pack.briefs) await Store.setKV('briefs', pack.briefs);
    if (pack.onboarding) await Store.setKV('onboarding', pack.onboarding);
    return n;
  },
};

/* 账单去重：金额 + 备注 + 当天 */
async function billExists(amount, note, dayKey) {
  const list = await Store.bills(500);
  return list.some(b => Number(b.amount) === Number(amount) && (b.note || '') === (note || '')
                         && dayKeyOf(b.created) === dayKey);
}
