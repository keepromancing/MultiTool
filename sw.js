// Offline support. The app shell is cached on install; everything then runs with no connection.
// GitHub API calls always go to the network and are never cached. Nothing else is fetched from outside the app.

const VERSION = 'mt-1.5.0';
const SHELL_CACHE = 'mt-shell-' + VERSION;
const SHELL = [
  './', './index.html', './app.css', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png',
  './js/main.js', './js/app.js', './js/util.js', './js/db.js', './js/merge.js', './js/state.js', './js/sync.js', './js/ui.js',
  './js/print.js', './js/cardsheet.js', './js/shift.js', './js/msgs.js',
  './js/views/now.js', './js/views/book.js', './js/views/count.js', './js/views/lead.js', './js/views/more.js', './js/views/quick.js', './js/views/maps.js',
  './fonts/atkinson-hyperlegible-400.woff2', './fonts/atkinson-hyperlegible-700.woff2', './fonts/atkinson-hyperlegible-400-italic.woff2',
  './fonts/ibm-plex-mono-400.woff2', './fonts/ibm-plex-mono-500.woff2', './fonts/ibm-plex-mono-600.woff2',
  './fonts/sofia-sans-extra-condensed-700.woff2', './fonts/sofia-sans-extra-condensed-800.woff2'
];

self.addEventListener('install', (ev) => {
  ev.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })));
  })());
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    const keys = await caches.keys();
    // Old app versions, and the Google Fonts copies kept before 1.4.4 (fonts now ship with the app).
    await Promise.all(keys.filter((k) => (k.startsWith('mt-shell-') && k !== SHELL_CACHE) || k.startsWith('mt-fonts-')).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (ev) => { if (ev.data === 'skip-waiting') self.skipWaiting(); });

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'api.github.com') return; // always live
  if (url.origin !== self.location.origin) return;
  ev.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html') || await cache.match('./');
      if (shell) return shell;
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try { return await fetch(req); } catch (e) { return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } }); }
  })());
});
