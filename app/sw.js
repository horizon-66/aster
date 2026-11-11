/* 只缓存静态资源；API 与对话一律走网络，不在离线时造假数据 */
const CACHE = 'aster-v5';
const ASSETS = ['./', './index.html', './store.js', './core.js', './persona.md',
  './manifest.webmanifest', './icon-192.png', './icon-512.png',
  './bgm-letter.m4a', './intro.m4a', './version.json',
  './sfx/tap.m4a', './sfx/done.m4a', './sfx/open.m4a'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {})));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);

  // 跨域（API）不碰，交给页面自己处理，离线时页面会提示「先存本机」
  if (url.origin !== location.origin) return;
  if (req.method !== 'GET') return;
  // 版本自检必须拿新的，不走缓存
  if (url.pathname.endsWith('/version.json')) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    const net = fetch(req).then(res => {
      if (res && res.status === 200) cache.put(req, res.clone()).catch(() => {});
      return res;
    }).catch(() => null);
    // 静态资源：先给缓存，网络回来了顺手更新
    if (hit) { net; return hit; }
    const res = await net;
    if (res) return res;
    if (req.mode === 'navigate') return cache.match('./index.html');
    return new Response('', { status: 504 });
  })());
});
