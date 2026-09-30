/* Notitieboekje service worker.
 * Bij het deployen wordt __VERSION__ vervangen door het korte commitnummer:
 * elke versie krijgt zo een eigen cache, en de oude wordt opgeruimd.
 * Strategie: de app-schil staat in de cache (werkt volledig offline) en wordt
 * eerst uit de cache geserveerd. Een nieuwe versie installeert zich op de
 * achtergrond; de verversknop in de app gebruikt ze meteen.
 * Notities zelf gaan nooit langs hier: die staan in localStorage.
 */
const VERSION = '__VERSION__';
const CACHE = 'notitieboekje-' + VERSION;
const SHELL = [
  '/',
  '/style.css',
  '/i18n.js',
  '/import.js',
  '/app.js',
  '/manifest.webmanifest',
  '/favicon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/fonts/noto-sans-tifinagh-tifinagh-400-normal.woff2',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const namen = await caches.keys();
    await Promise.all(namen.filter((n) => n.startsWith('notitieboekje-') && n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // elke pagina-navigatie is dezelfde app: altijd de schil uit de cache
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const hit = await caches.match('/', { cacheName: CACHE });
      if (hit) return hit;
      try { return await fetch(req); } catch { return (await caches.match('/')) || Response.error(); }
    })());
    return;
  }

  e.respondWith((async () => {
    const hit = await caches.match(req, { cacheName: CACHE, ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') {
        const kopie = res.clone();
        caches.open(CACHE).then((c) => c.put(req, kopie)).catch(() => {});
      }
      return res;
    } catch {
      return (await caches.match(req, { ignoreSearch: true })) || Response.error();
    }
  })());
});
