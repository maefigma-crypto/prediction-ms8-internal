// ScoreOcs8 Service Worker — handles PWA install, offline shell, and web push.
// Bumped versions invalidate the old cache.
const CACHE_VERSION = 'scoreocs8-v1';
const SHELL_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/logo.png',
  '/favicon.svg',
];

// === INSTALL: pre-cache the shell so the PWA loads when offline ===
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(SHELL_ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

// === ACTIVATE: clear old caches ===
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// === FETCH: network-first for HTML, cache-first for everything else ===
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Don't cache API calls, push subscriptions, or external resources.
  if (url.pathname.startsWith('/api/') || url.origin !== self.location.origin) {
    return; // let the browser handle it normally
  }

  // HTML: network-first (so users always get fresh predictions when online)
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then(m => m || caches.match('/')))
    );
    return;
  }

  // Assets: cache-first
  event.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match('/')))
  );
});

// === PUSH: receive server-pushed notifications and display them ===
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'ScoreOcs8', body: event.data ? event.data.text() : '' }; }

  const title = data.title || 'ScoreOcs8';
  const body  = data.body  || 'New pro pick available — tap to view.';
  const url   = data.url   || '/';
  const tag   = data.tag   || 'scoreocs8-default';

  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag,
    renotify: true,
    requireInteraction: false,
    data: { url },
    actions: [
      { action: 'open', title: 'View pick' },
      { action: 'bet',  title: 'Register / Bet' }
    ],
  }));
});

// === NOTIFICATION CLICK ===
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const action = event.action;
  const targetUrl = action === 'bet'
    ? '/register.html'
    : (event.notification.data?.url || '/');

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // If a window is already open at the target, focus it.
      for (const c of clients) {
        if (c.url.includes(self.location.origin) && 'focus' in c) {
          c.navigate(targetUrl);
          return c.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
