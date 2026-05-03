import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

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

// Register service worker in production
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // SW registration failed — non-critical
    });
  });
}
