import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { APP_VERSION } from './config/version'

// One-shot cleanup of legacy localStorage keys.
// `meteomap_station_log` was a frontend CSV log of every station reading,
// kept for 90 days. Could grow to ~190 MB per browser. Now obsolete since
// TimescaleDB holds the same data with proper retention. Drop it on first
// load in v2.73.0+ to free user storage.
try {
  if (localStorage.getItem('meteomap_station_log') !== null) {
    localStorage.removeItem('meteomap_station_log');
  }
} catch {
  // localStorage disabled / private mode — ignore
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Web Vitals performance reporting (dev + prod)
import { initWebVitals } from './services/webVitals';
initWebVitals();

// F12 debug helpers — invocables desde la consola del navegador.
// `__meteomapDebug.<fn>()` para verificar hipótesis live sin tocar código.
// Survive esbuild.drop (no usamos console.*), pueden invocarse en prod.
import { getLightningParseDebug } from './api/lightningClient';
import { useLightningStore } from './hooks/useLightningData';
import { useWebcamStore } from './store/webcamStore';
import { useAlertStore } from './store/alertStore';
(window as unknown as { __meteomapDebug?: object }).__meteomapDebug = {
  /** Parser TZ debug — verifica que MG envía UTC vs Madrid local */
  lightning: getLightningParseDebug,
  /** Recent strike activity counts: count30m / count15m / count5m (within WATCH_KM) */
  activity: () => useLightningStore.getState().recentActivity,
  /** Storm clusters with velocity + ETA — compact summary per cluster */
  clusters: () => useLightningStore.getState().clusters.map((c) => ({
    id: c.id,
    strikeCount: c.strikeCount,
    distanceKm: c.distanceToReservoir,
    velocity: c.velocity,
    etaMinutes: c.etaMinutes,
    approaching: c.approaching,
    newestAgeMin: c.newestAgeMin,
  })),
  /** Current storm alert state — level, nearestKm, recentCount, trend, ETA */
  alert: () => useLightningStore.getState().stormAlert,
  /** Timestamp of last successful lightning fetch */
  lastFetch: () => useLightningStore.getState().lastFetch,
  /** Webcam vision IA results — what moondream sees on each camera.
   *  Useful to diagnose why FogOverlay doesn't paint a zone where the
   *  webcam clearly shows fog. Filter by id prefix (e.g. 'cies', 'patos'). */
  webcamVision: (filterIdSubstring?: string) => {
    const results = useWebcamStore.getState().visionResults;
    const entries = Array.from(results.entries())
      .filter(([id]) => !filterIdSubstring || id.toLowerCase().includes(filterIdSubstring.toLowerCase()))
      .map(([id, r]) => ({
        id,
        beaufort: r.beaufort,
        confidence: r.confidence,
        sky: r.weather.sky,
        visibility: r.weather.visibility,
        fogVisible: r.weather.fogVisible,
        precipitation: r.weather.precipitation,
        description: r.weather.weatherDescription?.slice(0, 80) ?? '',
        ageMin: Math.round((Date.now() - r.analyzedAt.getTime()) / 60_000),
      }));
    return entries;
  },
  /** Fog alerts currently in alertStore — verifies multi-evidence detector
   *  output. If fogVisible is true on a webcam but no alert here, the
   *  threshold `totalEvidence >= 2` is blocking. */
  fogAlerts: () => useAlertStore.getState().alerts
    .filter((a) => a.category === 'fog' || (a.title ?? '').toLowerCase().includes('niebla'))
    .map((a) => ({
      title: a.title,
      severity: a.severity,
      score: a.score,
      detail: a.detail?.slice(0, 120),
      sources: a.fogMeta?.sources?.length ?? 0,
      webcamConfirmed: a.fogMeta?.webcamConfirmed ?? false,
    })),
  /** Single-shot dump of everything storm-related — quick health check */
  dump: () => ({
    parseTZ: getLightningParseDebug(),
    activity: useLightningStore.getState().recentActivity,
    alert: useLightningStore.getState().stormAlert,
    clusterCount: useLightningStore.getState().clusters.length,
    lastFetch: useLightningStore.getState().lastFetch,
    pollInterval: useLightningStore.getState().recentActivity.count5m >= 1 ||
                  useLightningStore.getState().recentActivity.count15m >= 5
      ? '60s (storm-active adaptive)'
      : '120s (quiet)',
  }),
};

// Register service worker in production. The ?v=<APP_VERSION> query lets the
// SW derive its own CACHE_NAME per app version (see public/sw.js header). A
// version bump → new registration URL → re-install → activate purges old
// caches → no stale-chunk bootstrap crashes after rapid deploys.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`/sw.js?v=${APP_VERSION}`).catch(() => {
      // SW registration failed — non-critical
    });
  });
}
