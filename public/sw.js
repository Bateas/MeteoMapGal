// MeteoMap Service Worker — cache-first for static assets, network-first for HTML, network-only for API
const CACHE_NAME = 'meteomap-v3';

const STATIC_EXTENSIONS = /\.(js|css|woff2?|ttf|svg|png|jpg|webp|ico|json)$/;

// API proxy paths — always network, never cache
const API_PATHS = [
  '/aemet-api', '/aemet-data',
  '/meteogalicia-api', '/meteoclimatic-api',
  '/netatmo-api', '/netatmo-auth',
  '/meteo2api', '/ideg-api',
  '/enaire-api', '/ihm-api', '/eumetsat-api', '/portus-api', '/obscosteiro-api', '/hfradar-api', '/skyx-api',
  '/noaa-api', '/api/webhook', '/api/v1',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Network-only for API routes
  if (API_PATHS.some((p) => url.pathname.startsWith(p))) {
    return; // Let the browser handle it normally
  }

  // Cache-first for static assets (hashed filenames from Vite + public assets)
  if (STATIC_EXTENSIONS.test(url.pathname) && (url.pathname.includes('/assets/') || url.pathname.startsWith('/'))) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Network-first for HTML (SPA navigation) — cache successful response for offline
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match('/index.html'))
    );
    return;
  }
});
