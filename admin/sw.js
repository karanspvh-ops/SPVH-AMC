const VERSION = 'spvh-ws-v1';
const SHELL = [
  '/admin/',
  '/admin/app.css',
  '/admin/js/main.js',
  '/admin/js/api.js',
  '/admin/js/store.js',
  '/admin/js/util.js',
  '/admin/js/ui.js',
  '/admin/js/dnd.js',
  '/admin/js/drawer.js',
  '/admin/js/views/auth.js',
  '/admin/js/views/overview.js',
  '/admin/js/views/mywork.js',
  '/admin/js/views/requests.js',
  '/admin/js/views/board.js',
  '/admin/js/views/team.js',
  '/admin/vendor/phosphor/regular.css',
  '/admin/vendor/phosphor/fill.css',
  '/admin/vendor/phosphor/Phosphor.woff2',
  '/admin/vendor/phosphor/Phosphor-Fill.woff2',
  '/admin/icons/icon-192.png',
  '/admin/img/boardroom.webp',
  '/Fonts/Montserrat-VariableFont_wght.ttf',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('/admin/', copy));
          return res;
        })
        .catch(() => caches.match('/admin/'))
    );
    return;
  }

  event.respondWith(
    caches.open(VERSION).then((cache) =>
      fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cache.match(req))
    )
  );
});
