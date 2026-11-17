const VERSION = 'spvh-ws-v6';
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
  '/admin/js/views/calendar.js',
  '/admin/js/views/pool.js',
  '/admin/js/push.js',
  '/admin/js/activity.js',
  '/admin/js/rows.js',
  '/admin/vendor/phosphor/regular.css',
  '/admin/vendor/phosphor/fill.css',
  '/admin/vendor/phosphor/bold.css',
  '/admin/vendor/phosphor/duotone.css',
  '/admin/vendor/phosphor/Phosphor.woff2',
  '/admin/vendor/phosphor/Phosphor-Fill.woff2',
  '/admin/vendor/phosphor/Phosphor-Bold.woff2',
  '/admin/vendor/phosphor/Phosphor-Duotone.woff2',
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

// ---------- push notifications ----------

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(Promise.all([
    self.registration.showNotification(data.title || 'SPVH Workspace', {
      body: data.body || '',
      icon: '/admin/icons/icon-192.png',
      tag: data.tag,
      renotify: !!data.tag,
      data: { url: data.url || '/admin/' },
    }),
    // If the app is open, tell it to refresh so the new work appears straight away.
    self.clients.matchAll({ type: 'window' }).then((list) => list.forEach((c) => c.postMessage({ type: 'refresh' }))),
  ]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/admin/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.startsWith(`${self.location.origin}/admin`));
    if (open) return open.focus().then(() => open.navigate(url)).catch(() => self.clients.openWindow(url));
    return self.clients.openWindow(url);
  }));
});
