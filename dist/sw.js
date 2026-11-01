const CACHE = 'huginn-muninn-shell-1.1.1';
const ROOT = new URL('./', self.location.href);
const FILES = ['','index.html','app.css','app.mjs','core.mjs','storage.mjs','player.mjs','manifest.webmanifest','icons/icon.svg','icons/icon-192.png','icons/icon-512.png','icons/maskable-512.png','vendor/hls.min.js'];
const SHELL = new Set(FILES.map(path => new URL(path, ROOT).href));
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([...SHELL]))));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('huginn-muninn-shell-') && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('message', event => { if (event.data === 'ACTIVATE_UPDATE') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('authorization')) return;
  const url = new URL(request.url);
  // Only an explicit shell allowlist is cached. Camera frames, API, recordings,
  // queries and all remote origins are never intercepted or stored.
  if (url.origin !== ROOT.origin || url.search || !SHELL.has(url.href)) return;
  event.respondWith((async () => {
    // Serve one complete installed release until the next worker activates.
    // A network-first shell can mix old modules with a newly deployed release.
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    return fetch(request, {cache:'no-cache'});
  })());
});
