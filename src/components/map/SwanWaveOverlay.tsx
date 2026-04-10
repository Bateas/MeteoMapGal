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
import { memo, useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { useSectorStore } from '../../store/sectorStore';
import { useMapStyleStore } from '../../store/mapStyleStore';
import { useBuoyStore } from '../../store/buoyStore';
import { useUIStore } from '../../store/uiStore';

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

const AUTO_WAVE_THRESHOLD = 0.5;
const HOUR_STEPS = 48; // ±48h from now

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
  const buoys = useBuoyStore((s) => s.buoys);
  const isMobile = useUIStore((s) => s.isMobile);

  const [hourOffset, setHourOffset] = useState(0);
  const [serverUp, setServerUp] = useState(false);
  const lastCheckRef = useRef(0);

  const maxWaveHeight = useMemo(() => {
    let max = 0;
    for (const b of buoys) {
      if (b.waveHeight != null && b.waveHeight > max) max = b.waveHeight;
    }
    return max;
  }, [buoys]);

  const wantsActive = sectorId === 'rias' && (showSwan || maxWaveHeight >= AUTO_WAVE_THRESHOLD);

  // Health check: verify CESGA THREDDS is up before loading any tiles
  useEffect(() => {
    if (!wantsActive) { setServerUp(false); return; }
    if (serverUp && Date.now() - lastCheckRef.current < 600_000) return; // 10min cache
    const ctrl = new AbortController();
    const testTile = '/swan-api/thredds/wms/SWAN/agg/SWAN_agg_best.ncd'
      + '?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=hs&SRS=EPSG:4326'
      + '&BBOX=-9,42,-8,43&WIDTH=16&HEIGHT=16&FORMAT=image/png&TRANSPARENT=true';
    fetch(testTile, { signal: ctrl.signal })
      .then((r) => { lastCheckRef.current = Date.now(); setServerUp(r.ok); })
      .catch(() => setServerUp(false));
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsActive]);

  const isActive = wantsActive && serverUp;

  // Build tile URL with TIME parameter
  const tileUrl = useMemo(() => {
    const time = timeForOffset(hourOffset);
    return `${SWAN_WMS_BASE}&TIME=${time}`;
  }, [hourOffset]);

  const handleSlider = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setHourOffset(parseInt(e.target.value, 10));
  }, []);

  if (!isActive) return null;

  return (
    <>
      {/* WMS raster tiles */}
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

      {/* Time slider — floating control */}
      {showSwan && (
        <div
          className={`absolute z-30 bg-slate-900/90 border border-slate-700/50 rounded-lg shadow-lg px-3 py-2
            ${isMobile ? 'bottom-[7rem] left-2 right-2' : 'bottom-8 left-1/2 -translate-x-1/2 w-80'}`}
          style={{ pointerEvents: 'auto' }}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Oleaje SWAN
            </span>
            <span className="text-[12px] font-semibold text-sky-400">
              {formatOffset(hourOffset)}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={HOUR_STEPS}
            step={1}
            value={hourOffset}
            onChange={handleSlider}
            className="w-full h-1.5 accent-sky-500 cursor-pointer"
            aria-label="Hora del forecast SWAN"
          />
          <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
            <span>Ahora</span>
            <span>+24h</span>
            <span>+48h</span>
          </div>
        </div>
      )}
    </>
  );
}

export const SwanWaveOverlay = memo(SwanWaveOverlayInner);
