// MeteoMap Service Worker — cache-first for static assets, network-first for HTML,
// cache-then-network for map tiles, network-only for API
const CACHE_NAME = 'meteomap-v6';
const TILE_CACHE = 'meteomap-tiles-v1';
const MAX_TILE_CACHE = 500; // LRU eviction above this

const STATIC_EXTENSIONS = /\.(js|css|woff2?|ttf|svg|png|jpg|webp|ico|json)$/;

// API proxy paths — always network, never cache
const API_PATHS = [
  '/aemet-api', '/aemet-data',
  '/meteogalicia-api', '/meteoclimatic-api',
  '/netatmo-api', '/netatmo-auth',
  '/meteo2api', '/ideg-api',
  '/enaire-api', '/ihm-api', '/eumetsat-api', '/portus-api', '/obscosteiro-api', '/hfradar-api', '/skyx-api',
  '/noaa-api', '/opensky-api', '/swan-api', '/api/webhook', '/api/v1',
];

// Tile CDN domains — cache-then-network for fast map loads
const TILE_DOMAINS = [
  'tile.openstreetmap.org',
  'basemaps.cartocdn.com',
  'a.basemaps.cartocdn.com',
  'b.basemaps.cartocdn.com',
  'c.basemaps.cartocdn.com',
  'd.basemaps.cartocdn.com',
  'tms-ign-base.idee.es',
  'www.ign.es',
  's3.amazonaws.com', // terrain DEM tiles
  'tiles.openseamap.org',
  'nrt-services.marine.copernicus.eu',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== TILE_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// LRU tile eviction — delete oldest entries when cache exceeds max
async function evictOldTiles() {
  const cache = await caches.open(TILE_CACHE);
  const keys = await cache.keys();
  if (keys.length > MAX_TILE_CACHE) {
    // Delete oldest 20% to avoid frequent eviction
    const toDelete = Math.floor(keys.length * 0.2);
    await Promise.all(keys.slice(0, toDelete).map((k) => cache.delete(k)));
  }
}

self.addEventListener('fetch', (event) => {
  // Skip non-HTTP(S) requests (chrome-extension://, moz-extension://, etc.)
  if (!event.request.url.startsWith('http')) return;

  const url = new URL(event.request.url);

  // Network-only for API routes
  if (API_PATHS.some((p) => url.pathname.startsWith(p))) {
    return; // Let the browser handle it normally
  }

  // ── Tile caching: cache-first for map tiles (zoom 8-14) ──
  if (TILE_DOMAINS.some((d) => url.hostname.includes(d))) {
    // Extract zoom level from typical tile URL pattern: /z/x/y.png
    const zoomMatch = url.pathname.match(/\/(\d{1,2})\//);
    const zoom = zoomMatch ? parseInt(zoomMatch[1], 10) : 10;

    // Only cache useful zoom levels (8-14) to save storage
    if (zoom >= 8 && zoom <= 14) {
      event.respondWith(
        caches.open(TILE_CACHE).then((cache) =>
          cache.match(event.request).then((cached) => {
            if (cached) return cached;
            return fetch(event.request).then((response) => {
              if (response.ok) {
                cache.put(event.request, response.clone());
                // Async eviction — don't block response
                evictOldTiles();
              }
              return response;
            }).catch(() => {
              // Offline fallback — return cached if available (stale better than nothing)
              return cached || new Response('', { status: 408 });
            });
          })
        )
      );
      return;
    }
    // Tiles outside zoom 8-14: just pass through
    return;
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
