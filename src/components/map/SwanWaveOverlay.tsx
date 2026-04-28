/**
 * SWAN Wave Overlay — MeteoGalicia nearshore wave model (#56 v4).
 *
 * Shows REAL wave propagation inside the Rías from CESGA THREDDS WMS.
 * SWAN calculates: island shadows, channel narrowing, refraction,
 * depth-induced breaking, wind-wave generation.
 *
 * Features:
 *   - Layer `hs` = significant wave height (Hm0), ~250m grid
 *   - TIME slider: ±48h from now (hourly steps)
 *   - Auto-activates when buoy waveHeight ≥ 0.5m
 *   - Toggle: "Oleaje SWAN" in Capas marinas
 *
 * Rías sector only. No auth needed.
 */
import { memo, useMemo, useState, useCallback, useEffect } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { useSectorStore } from '../../store/sectorStore';
import { useMapStyleStore } from '../../store/mapStyleStore';
import { useUIStore } from '../../store/uiStore';
import { fetchMarineData } from '../../api/marineClient';

// ── Open-Meteo Marine fallback — used when CESGA SWAN is down ──
// 6 strategic sample points covering Rías Baixas. Drawn as colored dots so
// users still get a coarse spatial wave context when the high-resolution
// SWAN model is unavailable. Cache lives inside marineClient (10 min).
const OPEN_METEO_FALLBACK_POINTS: Array<{ id: string; lat: number; lon: number; label: string }> = [
  { id: 'vigo-bocana',     lat: 42.20, lon: -8.90, label: 'Bocana Vigo' },
  { id: 'pontevedra-bocana', lat: 42.39, lon: -8.95, label: 'Bocana Pontevedra' },
  { id: 'pontevedra-int',  lat: 42.39, lon: -8.78, label: 'Interior Pontevedra' },
  { id: 'arousa-bocana',   lat: 42.55, lon: -9.05, label: 'Bocana Arousa' },
  { id: 'arousa-int',      lat: 42.57, lon: -8.85, label: 'Interior Arousa' },
  { id: 'muros-bocana',    lat: 42.78, lon: -9.10, label: 'Bocana Muros' },
];

// ── WMS config ───────────────────────────────────────

const SWAN_WMS_BASE =
  '/swan-api/thredds/wms/SWAN/agg/SWAN_agg_best.ncd'
  + '?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap'
  + '&LAYERS=hs'
  + '&SRS=EPSG:3857'
  + '&BBOX={bbox-epsg-3857}'
  + '&WIDTH=256&HEIGHT=256'
  + '&FORMAT=image/png'
  + '&TRANSPARENT=true'
  + '&COLORSCALERANGE=0,3';

const HOUR_STEPS = 48; // ±48h from now
// Note: SWAN no longer auto-activates (S126+1). It's an opt-in layer the user
// toggles from the marine layers menu. Auto-loading on every page load was
// hammering the academic CESGA server unnecessarily and adding visual weight
// when users may not care about waves at that moment.

/** Build TIME parameter for a given hour offset from now */
function timeForOffset(offsetHours: number): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + offsetHours);
  return d.toISOString().replace(/\.\d+Z$/, '.000Z');
}

/** Format offset as human-readable label */
function formatOffset(h: number): string {
  if (h === 0) return 'Ahora';
  if (h > 0) return `+${h}h`;
  return `${h}h`;
}

// ── Component ────────────────────────────────────────

function SwanWaveOverlayInner() {
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const showSwan = useMapStyleStore((s) => s.showUpwelling);
  const isMobile = useUIStore((s) => s.isMobile);

  const [hourOffset, setHourOffset] = useState(0);
  const [serverUp, setServerUp] = useState(false);

  // S126+1: auto-activation removed. SWAN is now strictly opt-in via the
  // marine layers menu. Reasons:
  //   - CESGA academic server is unstable and we were hitting it on every
  //     load; this reduces load on a fragile dependency.
  //   - Visually heavy overlay on a map that already has many active layers.
  //   - User explicitly asked for manual control.
  // The buoys/maxWaveHeight reads are no longer needed; left the import
  // intact in case future features want them, but the values aren't read.

  // Toggle is the ONLY control. User activates from "Capas marinas" menu.
  const wantsActive = sectorId === 'rias' && showSwan;

  // Health check: verify CESGA THREDDS has CURRENT data before loading tiles.
  // v2.56.7: added TIME parameter matching what real tiles will send. Without it,
  // the test passed (server is up) but real tiles returned 400 because the SWAN
  // dataset is often frozen days behind — CESGA academic server stalls frequently.
  // Retries every 10min in case the model catches up.
  useEffect(() => {
    if (!wantsActive) { setServerUp(false); return; }

    const buildTestTile = () => {
      const time = timeForOffset(0); // TIME = current hour (same as initial tiles)
      return '/swan-api/thredds/wms/SWAN/agg/SWAN_agg_best.ncd'
        + '?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=hs&SRS=EPSG:4326'
        + '&BBOX=-9,42,-8,43&WIDTH=16&HEIGHT=16&FORMAT=image/png&TRANSPARENT=true'
        + `&TIME=${time}`;
    };

    const doCheck = () => {
      fetch(buildTestTile(), { signal: AbortSignal.timeout(10_000) })
        .then((r) => setServerUp(r.ok))
        .catch(() => setServerUp(false));
    };

    doCheck(); // immediate first check
    const interval = setInterval(doCheck, 600_000); // retry every 10min
    return () => clearInterval(interval);
  }, [wantsActive]);

  const isActive = wantsActive && serverUp;

  // ── Open-Meteo Marine fallback when CESGA is down ──
  // Pull the 6 sample points lazily, cache via marineClient (10 min).
  const fallbackActive = wantsActive && !serverUp;
  const [fallbackData, setFallbackData] = useState<Array<{ lat: number; lon: number; waveHeight: number; label: string }>>([]);
  useEffect(() => {
    if (!fallbackActive) { setFallbackData([]); return; }
    let cancelled = false;
    (async () => {
      const results: Array<{ lat: number; lon: number; waveHeight: number; label: string }> = [];
      for (const pt of OPEN_METEO_FALLBACK_POINTS) {
        const d = await fetchMarineData(pt.lat, pt.lon);
        if (cancelled) return;
        if (d?.waveHeight != null) {
          results.push({ lat: pt.lat, lon: pt.lon, waveHeight: d.waveHeight, label: pt.label });
        }
      }
      if (!cancelled) setFallbackData(results);
    })();
    return () => { cancelled = true; };
  }, [fallbackActive]);

  const fallbackGeoJson = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: fallbackData.map((p) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
      properties: { waveHeight: p.waveHeight, label: p.label },
    })),
  }), [fallbackData]);

  // Build tile URL with TIME parameter
  const tileUrl = useMemo(() => {
    const time = timeForOffset(hourOffset);
    return `${SWAN_WMS_BASE}&TIME=${time}`;
  }, [hourOffset]);

  const handleSlider = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setHourOffset(parseInt(e.target.value, 10));
  }, []);

  if (!isActive && !fallbackActive) return null;

  return (
    <>
      {/* WMS raster tiles — only when CESGA is up */}
      {isActive && (
        <Source
          key={`swan-${hourOffset}`}
          id="swan-wave"
          type="raster"
          tiles={[tileUrl]}
          tileSize={256}
          minzoom={8}
          maxzoom={13}
          attribution="&copy; MeteoGalicia SWAN (CESGA)"
        >
          <Layer
            id="swan-wave-layer"
            type="raster"
            minzoom={8}
            paint={{
              'raster-opacity': 0.6,
              'raster-fade-duration': 200,
            }}
          />
        </Source>
      )}

      {/* Open-Meteo Marine fallback — colored dots at strategic Rías points */}
      {fallbackActive && fallbackData.length > 0 && (
        <Source id="swan-fallback" type="geojson" data={fallbackGeoJson}>
          {/* Halo (white outline) for legibility */}
          <Layer
            id="swan-fallback-halo"
            type="circle"
            paint={{
              'circle-radius': 11,
              'circle-color': '#ffffff',
              'circle-opacity': 0.7,
              'circle-blur': 0.4,
            }}
          />
          {/* Wave-height-colored dot — same scale as the SWAN legend (0-3m) */}
          <Layer
            id="swan-fallback-dot"
            type="circle"
            paint={{
              'circle-radius': 8,
              'circle-color': [
                'interpolate', ['linear'], ['get', 'waveHeight'],
                0,    '#0a0a5c',
                0.5,  '#1e3a8a',
                1.0,  '#0ea5e9',
                1.5,  '#22d3ee',
                2.0,  '#4ade80',
                2.5,  '#facc15',
                3.0,  '#f97316',
                4.0,  '#ef4444',
              ],
              'circle-opacity': 0.9,
              'circle-stroke-color': '#0f172a',
              'circle-stroke-width': 1.5,
            }}
          />
          {/* Wave-height label (e.g. "1.4 m") */}
          <Layer
            id="swan-fallback-label"
            type="symbol"
            layout={{
              'text-field': ['concat', ['number-format', ['get', 'waveHeight'], { 'max-fraction-digits': 1 }], ' m'],
              'text-font': ['Noto Sans Bold'],
              'text-size': 11,
              'text-offset': [0, 1.6],
              'text-allow-overlap': true,
            }}
            paint={{
              'text-color': '#f1f5f9',
              'text-halo-color': '#0f172a',
              'text-halo-width': 1.5,
            }}
          />
        </Source>
      )}

      {/* Desktop: horizontal time slider + legend panel */}
      {!isMobile && showSwan && isActive && (
        <div
          className="absolute z-30 bottom-8 left-1/2 -translate-x-1/2 w-80 bg-slate-900/90 border border-slate-700/50 rounded-lg shadow-lg px-3 py-2"
          style={{ pointerEvents: 'auto' }}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Oleaje SWAN</span>
            <span className="text-[12px] font-semibold text-sky-400">{formatOffset(hourOffset)}</span>
          </div>
          <input type="range" min={0} max={HOUR_STEPS} step={1} value={hourOffset} onChange={handleSlider}
            className="w-full h-1.5 accent-sky-500 cursor-pointer" aria-label="Hora del forecast SWAN" />
          <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
            <span>Ahora</span><span>+24h</span><span>+48h</span>
          </div>
          <div className="mt-2 pt-1.5 border-t border-slate-700/50">
            <div className="text-[10px] text-slate-400 mb-1">Altura ola (m)</div>
            <div className="h-2.5 rounded-sm" style={{ background: 'linear-gradient(to right, #0a0a5c, #1e3a8a, #0ea5e9, #22d3ee, #4ade80, #facc15, #f97316, #ef4444)' }} />
            <div className="flex justify-between text-[9px] text-slate-500 mt-0.5">
              <span>0</span><span>0.5</span><span>1.0</span><span>1.5</span><span>2.0</span><span>3+</span>
            </div>
          </div>
        </div>
      )}

      {/* CESGA SWAN offline notice — overlay still toggled ON but server down.
          Open-Meteo Marine fallback dots are visible at 6 strategic points. */}
      {!isMobile && showSwan && !serverUp && (
        <div
          className="absolute z-30 bottom-8 left-1/2 -translate-x-1/2 w-80 bg-slate-900/85 border border-amber-500/40 rounded-lg shadow-lg px-3 py-2"
          style={{ pointerEvents: 'auto' }}
        >
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider">SWAN no disponible — modo respaldo</span>
          </div>
          <p className="text-[10.5px] text-slate-400 leading-snug">
            Modelo CESGA caído. Mostrando alturas de ola en bocanas/interior vía Open-Meteo Marine
            ({fallbackData.length} puntos). Resolución reducida.
          </p>
        </div>
      )}

      {/* Mobile: vertical panel on left edge — slider + legend, no overlap with bottom controls */}
      {isMobile && showSwan && isActive && (
        <div
          className="absolute z-30 left-1 bg-slate-900/85 border border-slate-700/40 rounded-lg shadow-lg px-1.5 py-2.5"
          style={{ top: '38%', transform: 'translateY(-50%)', pointerEvents: 'auto' }}
        >
          <div className="flex flex-col items-center gap-1">
            {/* Time slider section */}
            <span className="text-[10px] font-bold text-sky-400 leading-tight">{formatOffset(hourOffset)}</span>
            <input type="range" min={0} max={HOUR_STEPS} step={1} value={hourOffset} onChange={handleSlider}
              className="accent-sky-500 cursor-pointer" aria-label="Hora del forecast SWAN"
              style={{ writingMode: 'vertical-lr', direction: 'rtl', width: 24, height: 80 }} />
            {/* Separator */}
            <div className="w-4 border-t border-slate-600/50 my-0.5" />
            {/* Wave height scale */}
            <span className="text-[9px] text-slate-300 font-bold leading-tight">3m</span>
            <div className="w-3 rounded-sm" style={{ height: 60, background: 'linear-gradient(to top, #0a0a5c, #1e3a8a, #0ea5e9, #22d3ee, #4ade80, #facc15, #f97316, #ef4444)' }} />
            <span className="text-[9px] text-slate-300 font-bold leading-tight">0</span>
          </div>
        </div>
      )}
    </>
  );
}

export const SwanWaveOverlay = memo(SwanWaveOverlayInner);
