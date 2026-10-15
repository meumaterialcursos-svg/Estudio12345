/* Service worker: funciona offline depois do primeiro acesso.
   Ao publicar uma nova versão, incremente CACHE_VERSION. */
const CACHE_VERSION = 'sp-v2';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'sync-core.js', 'firebase-sync.js', 'firebase-config.js',
               'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isLib = (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('/chart.js@')) ||
                (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/'));
  if (!sameOrigin && !isLib) return;

  // Bibliotecas versionadas (Chart.js, SDK do Firebase): cache primeiro.
  if (isLib) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE_VERSION).then(c => c.put(req, copy)); }
        return res;
      }))
    );
    return;
  }
  // Arquivos do app: rede primeiro (sempre a versão mais nova), cache como reserva offline.
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE_VERSION).then(c => c.put(req.mode === 'navigate' ? 'index.html' : req, copy)); }
      return res;
    }).catch(() => caches.match(req.mode === 'navigate' ? 'index.html' : req))
  );
});
