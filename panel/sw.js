// OCS Super Panel — minimal service worker.
// Provides offline shell so you can still see the login screen / cached
// dashboard if you briefly lose connection. Does NOT receive push (the
// panel is the SENDER of push; subscribers live on individual sites).

const CACHE = 'ocs-panel-v1';
const SHELL = ['/', '/css/panel.css', '/js/app.js', '/manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const url = new URL(r.url);
  // Never cache /api/*
  if (url.pathname.startsWith('/api/') || url.origin !== self.location.origin) return;
  // HTML: network-first
  if (r.mode === 'navigate' || r.headers.get('accept')?.includes('text/html')) {
    e.respondWith(fetch(r).catch(() => caches.match('/')));
    return;
  }
  // Static: cache-first
  e.respondWith(caches.match(r).then(hit => hit || fetch(r).then(res => {
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(r, copy)).catch(() => {});
    }
    return res;
  })));
});
