/**
 * SWAN Wave Overlay — MeteoGalicia nearshore wave model (#56 v4).
 *
 * Shows REAL wave propagation inside the Rías from CESGA THREDDS WMS.
 * SWAN calculates: island shadows, channel narrowing, refraction,
 * depth-induced breaking, wind-wave generation.
 *
 * Features:
 *   - Layer `hs` = significant wave height (Hm0), ~250m grid
 *   - TIME slider: from now to +48h (hourly steps)
 *   - Toggle: «Oleaje (modelo)» in the layers menu. It is a model and the screen says so.
 *
 * Three states of its server. Checking: nothing on screen and no request to anyone, or the first ten
 * seconds announced a fallen model that was only being asked. Up: tiles and panel. Down: Open-Meteo at 6
 * points, and a notice that says so, on a phone as well.
 *
 * Coastal sectors only. No auth needed.
 */
import { memo, useMemo, useState, useCallback, useEffect } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { useSectorStore } from '../../store/sectorStore';
import { isCoastalSector } from '../../config/sectors';
import { useMapStyleStore } from '../../store/mapStyleStore';
import { useUIStore } from '../../store/uiStore';
import { fetchMarineData } from '../../api/marineClient';
import { useTileBreaker } from '../../hooks/useTileBreaker';
import { useMapInk } from '../../hooks/useMapInk';

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
  // Oversample: render each 256-tile at 512px → 2x sampling density of the SWAN
  // grid → smaller, smoother boxfill cells (user report: olas "pixeladas").
  // Same tile count + bbox; only the PNG is bigger (nginx caches 30min).
  + '&WIDTH=512&HEIGHT=512'
  + '&FORMAT=image/png'
  + '&TRANSPARENT=true'
  + '&COLORSCALERANGE=0,3';

const HOUR_STEPS = 48; // to +48h from now

/** What the WMS draws with COLORSCALERANGE=0,3, for the legend */
const WAVE_SCALE = 'linear-gradient(to right, #0a0a5c, #1e3a8a, #0ea5e9, #22d3ee, #4ade80, #facc15, #f97316, #ef4444)';
const WAVE_SCALE_UP = WAVE_SCALE.replace('to right', 'to top');

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
  if (h > 0) return `+${h} h`;
  return `${h} h`;
}

// ── Component ────────────────────────────────────────

function SwanWaveOverlayInner() {
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const showSwan = useMapStyleStore((s) => s.showSwan);
  const isMobile = useUIStore((s) => s.isMobile);
  const ink = useMapInk();

  const [hourOffset, setHourOffset] = useState(0);
  // What the tiles actually ask for. Every hour is a different url, so each
  // step of the slider used to unmount the layer and ask for a whole new set
  // of tiles: dragging across ten hours was ~500 requests in a few seconds,
  // most of them refused. Now the slider moves at once and the tiles follow
  // only when it stops.
  const [appliedHour, setAppliedHour] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setAppliedHour(hourOffset), 400);
    return () => clearTimeout(t);
  }, [hourOffset]);
  const [server, setServer] = useState<'checking' | 'up' | 'down'>('checking');
  // Tiles that keep failing take the layer down for a while (see the hook).
  const tilesBlocked = useTileBreaker('swan-wave');

  // Strictly opt-in: the CESGA server is fragile and the layer is heavy. The toggle is the only control.
  const wantsActive = isCoastalSector(sectorId) && showSwan;

  // Health check: verify CESGA THREDDS has CURRENT data before loading tiles.
  // v2.56.7: added TIME parameter matching what real tiles will send. Without it,
  // the test passed (server is up) but real tiles returned 400 because the SWAN
  // dataset is often frozen days behind — CESGA academic server stalls frequently.
  // Retries every 10min in case the model catches up.
  useEffect(() => {
    if (!wantsActive) { setServer('checking'); return; }
    let alive = true;

    const buildTestTile = () => {
      const time = timeForOffset(0); // TIME = current hour (same as initial tiles)
      return '/swan-api/thredds/wms/SWAN/agg/SWAN_agg_best.ncd'
        + '?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=hs&SRS=EPSG:4326'
        + '&BBOX=-9,42,-8,43&WIDTH=16&HEIGHT=16&FORMAT=image/png&TRANSPARENT=true'
        + `&TIME=${time}`;
    };

    const doCheck = () => {
      fetch(buildTestTile(), { signal: AbortSignal.timeout(10_000) })
        .then((r) => { if (alive) setServer(r.ok ? 'up' : 'down'); })
        .catch(() => { if (alive) setServer('down'); });
    };

    doCheck(); // immediate first check
    const interval = setInterval(doCheck, 600_000); // retry every 10min
    return () => { alive = false; clearInterval(interval); };
  }, [wantsActive]);

  const isActive = wantsActive && server === 'up' && !tilesBlocked;

  // ── Open-Meteo Marine fallback when CESGA is down ──
  // Pull the 6 sample points lazily, cache via marineClient (10 min).
  const fallbackActive = wantsActive && (server === 'down' || tilesBlocked);
  // Null while it is being asked, so the notice does not say «0 puntos» before there is an answer.
  const [fallbackData, setFallbackData] = useState<Array<{ lat: number; lon: number; waveHeight: number; label: string }> | null>(null);
  useEffect(() => {
    if (!fallbackActive) { setFallbackData(null); return; }
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
    features: (fallbackData ?? []).map((p) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
      properties: { waveHeight: p.waveHeight, label: p.label },
    })),
  }), [fallbackData]);

  // Build tile URL with TIME parameter
  const tileUrl = useMemo(() => {
    const time = timeForOffset(appliedHour);
    return `${SWAN_WMS_BASE}&TIME=${time}`;
  }, [appliedHour]);

  const handleSlider = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setHourOffset(parseInt(e.target.value, 10));
  }, []);

  if (!isActive && !fallbackActive) return null;

  return (
    <>
      {/* WMS raster tiles — only when CESGA is up */}
      {isActive && (
        <Source
          key={`swan-${appliedHour}`}
          id="swan-wave"
          type="raster"
          tiles={[tileUrl]}
          tileSize={256}
          minzoom={8}
          maxzoom={13}
          attribution="&copy; MeteoGalicia (CESGA)"
        >
          <Layer
            id="swan-wave-layer"
            type="raster"
            minzoom={8}
            paint={{
              'raster-opacity': 0.6,
              'raster-fade-duration': 200,
              // Bilinear interpolation between cells → smooth gradient instead
              // of hard blocky boxfill edges (default is 'linear' but set it
              // explicitly so the oversampled tiles are always smoothed).
              'raster-resampling': 'linear',
            }}
          />
        </Source>
      )}

      {/* Open-Meteo Marine fallback — colored dots at strategic Rías points */}
      {fallbackActive && fallbackData && fallbackData.length > 0 && (
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
          {/* Wave-height-colored dot — same scale as the wave legend (0-3m) */}
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
          {/* Wave-height label («1,4 m»), in ink like every word on the map */}
          <Layer
            id="swan-fallback-label"
            type="symbol"
            layout={{
              'text-field': ['concat', ['number-format', ['get', 'waveHeight'], { locale: 'es', 'max-fraction-digits': 1 }], ' m'],
              'text-font': ['Noto Sans Bold'],
              'text-size': 12,
              'text-offset': [0, 1.6],
              'text-allow-overlap': true,
            }}
            paint={{
              'text-color': ink.text,
              'text-halo-color': ink.halo,
              'text-halo-width': 1.5,
            }}
          />
        </Source>
      )}

      {/* Desktop: horizontal time slider + legend panel, above the tools and the alert strip */}
      {!isMobile && isActive && (
        <div className="g-theme gc-popover gc-mapbar gc-wavepanel" role="group" aria-label="Oleaje (modelo)">
          <div className="gc-wavepanel-head">
            <b>Oleaje (modelo)</b>
            <span className="gc-num">{formatOffset(hourOffset)}</span>
          </div>
          <input type="range" min={0} max={HOUR_STEPS} step={1} value={hourOffset} onChange={handleSlider}
            aria-label="Hora de la previsión de oleaje" aria-valuetext={formatOffset(hourOffset)} />
          <div className="gc-wavepanel-ticks"><span>Ahora</span><span>+24 h</span><span>+48 h</span></div>
          <div className="gc-wavepanel-rule" />
          <div className="gc-note">Altura de ola (m)</div>
          <i className="gc-wavepanel-bar" style={{ background: WAVE_SCALE }} />
          <div className="gc-wavepanel-ticks"><span>0</span><span>1</span><span>2</span><span>3 o más</span></div>
        </div>
      )}

      {/* Phone: a vertical panel on the left edge, clear of the toolbar */}
      {isMobile && isActive && (
        <div className="g-theme gc-popover gc-wavepanel gc-wavepanel--side" role="group" aria-label="Oleaje (modelo)">
          <b>Oleaje<br />(modelo)</b>
          <span className="gc-num">{formatOffset(hourOffset)}</span>
          <input type="range" min={0} max={HOUR_STEPS} step={1} value={hourOffset} onChange={handleSlider}
            aria-label="Hora de la previsión de oleaje" aria-valuetext={formatOffset(hourOffset)}
            style={{ writingMode: 'vertical-lr', direction: 'rtl' }} />
          <span>3 m</span>
          <i className="gc-wavepanel-bar" style={{ background: WAVE_SCALE_UP }} />
          <span>0</span>
        </div>
      )}

      {/* The model is down, or its tiles keep failing: the dots on the map are another model and say so */}
      {fallbackActive && (
        <div className="g-theme gc-popover gc-mapbar gc-wavepanel gc-wavepanel--note" role="status">
          <b>Oleaje (modelo) sin servicio</b>
          <span className="gc-note">
            {fallbackData === null
              ? 'Probando con Open-Meteo, otro modelo…'
              : fallbackData.length > 0
                ? `De momento, altura de ola de Open-Meteo, otro modelo, en ${fallbackData.length} puntos y con mucho menos detalle.`
                : 'Open-Meteo, el otro modelo, tampoco responde. Se vuelve a probar en unos minutos.'}
          </span>
        </div>
      )}
    </>
  );
}

export const SwanWaveOverlay = memo(SwanWaveOverlayInner);
