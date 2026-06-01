/**
 * Popup for a user-created "chincheta" spot.
 *
 * Deliberately simpler than the official SpotPopup: it shows the BASIC engine
 * estimate, the RAW nearby stations it is based on (so the user sees the basis,
 * not a black-box verdict — lección Liméns: radius consensus can fail in a
 * microclimate), an unmissable "SIN CALIBRAR" banner, and two actions:
 *   • "Sugerir este spot" — opens the anonymous feedback form pre-filled with
 *     the coords (reuses the existing rate-limited / sanitized / honeypot path).
 *   • "Eliminar" — removes the local pin.
 */
import { memo, useCallback, useEffect, useState } from 'react';
import { Popup } from 'react-map-gl/maplibre';
import { useUserSpotStore } from '../../store/userSpotStore';
import { useUIStore } from '../../store/uiStore';
import { useForecastStore } from '../../hooks/useForecastTimeline';
import { WeatherIcon } from '../icons/WeatherIcons';
import { type UserSpot, MAX_NAME_CHARS, buildSpotSuggestion } from '../../config/userSpots';
import { RIAS_TIDE_STATIONS, fetchTidePredictions } from '../../api/tideClient';
import { fastDistanceKm } from '../../services/idwInterpolation';
import { msToKnots, degToCardinal8 } from '../../services/windUtils';
import type { HourlyForecast } from '../../types/forecast';
import type { SpotScore, SpotVerdict } from '../../services/spotScoringEngine';

/** Average wind over the next few forecast hours (WRF-MG), as kt + cardinal. */
function summarizeWrfNextHours(hourly: HourlyForecast[], now: Date): { kt: number; dir: string } | null {
  const future = hourly
    .filter((h) => h.time.getTime() > now.getTime() && h.windSpeed != null)
    .slice(0, 6);
  if (future.length === 0) return null;
  const avgMs = future.reduce((s, h) => s + h.windSpeed!, 0) / future.length;
  let sin = 0, cos = 0, n = 0;
  for (const h of future) {
    if (h.windDirection != null) {
      const r = (h.windDirection * Math.PI) / 180;
      sin += Math.sin(r); cos += Math.cos(r); n++;
    }
  }
  const dirDeg = ((Math.atan2(sin, cos) * 180) / Math.PI + 360) % 360;
  return { kt: msToKnots(avgMs), dir: n > 0 ? degToCardinal8(dirDeg) : '' };
}

interface NextTide { type: 'high' | 'low'; time: string; heightM: number }

const VERDICT_FULL: Record<SpotVerdict, string> = {
  calm: 'Calma', light: 'Flojo', sailing: 'Navegable', good: 'Buen viento', strong: 'Viento fuerte', unknown: 'Sin datos',
};
const VERDICT_COLOR: Record<SpotVerdict, string> = {
  calm: '#94a3b8', light: '#7dd3fc', sailing: '#4ade80', good: '#fde047', strong: '#fdba74', unknown: '#94a3b8',
};

interface Props {
  spot: UserSpot;
  score: SpotScore | undefined;
}

export const UserSpotPopup = memo(function UserSpotPopup({ spot, score }: Props) {
  const selectUserSpot = useUserSpotStore((s) => s.selectUserSpot);
  const removeUserSpot = useUserSpotStore((s) => s.removeUserSpot);
  const renameUserSpot = useUserSpotStore((s) => s.renameUserSpot);

  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(spot.name);
  const [nextTide, setNextTide] = useState<NextTide | null>(null);

  // Fetch the nearest tide station's next high/low (Rías only — the inland
  // reservoir has no tide). Used to enrich the suggestion report.
  useEffect(() => {
    if (spot.sectorId !== 'rias') { setNextTide(null); return; }
    let cancelled = false;
    const [lon, lat] = spot.center;
    let nearest = RIAS_TIDE_STATIONS[0];
    let best = Infinity;
    for (const st of RIAS_TIDE_STATIONS) {
      const d = fastDistanceKm(lat, lon, st.lat, st.lon);
      if (d < best) { best = d; nearest = st; }
    }
    fetchTidePredictions(nearest.id)
      .then((pts) => {
        if (cancelled || !pts || pts.length === 0) return;
        const now = new Date();
        const nowMins = now.getHours() * 60 + now.getMinutes();
        const next = pts.find((t) => {
          const p = t.time.split(':').map(Number);
          return p.length >= 2 && p[0] * 60 + p[1] > nowMins;
        }) ?? pts[0];
        setNextTide({ type: next.type, time: next.time, heightM: next.height });
      })
      .catch(() => { if (!cancelled) setNextTide(null); });
    return () => { cancelled = true; };
  }, [spot.id, spot.sectorId, spot.center]);

  const close = useCallback(() => selectUserSpot(null), [selectUserSpot]);

  const startEdit = useCallback(() => {
    setNameInput(spot.name);
    setEditing(true);
  }, [spot.name]);

  const commitName = useCallback(() => {
    const clean = nameInput.trim();
    if (clean) renameUserSpot(spot.id, clean); // store re-sanitizes + caps
    setEditing(false);
  }, [nameInput, renameUserSpot, spot.id]);

  const handleSuggest = useCallback(() => {
    const [lon, lat] = spot.center;
    const wrf = summarizeWrfNextHours(useForecastStore.getState().hourly, new Date());
    const text = buildSpotSuggestion({
      name: spot.name,
      lat,
      lon,
      windKt: score?.effectiveWindKt ?? score?.wind?.avgSpeedKt ?? null,
      windDir: score?.wind?.dominantDir ?? null,
      windSources: score?.wind?.stationCount,
      waveHeightM: score?.waves?.waveHeight ?? null,
      waterTempC: score?.waterTemp ?? null,
      tide: nextTide,
      wrf,
    });
    useUIStore.getState().setFeedbackPrefill({ type: 'sugerencia', text: `${text}\n` });
    useUIStore.getState().setFeedbackOpen(true);
    close();
  }, [spot, score, nextTide, close]);

  const handleDelete = useCallback(() => {
    removeUserSpot(spot.id);
  }, [removeUserSpot, spot.id]);

  const verdict: SpotVerdict = score?.verdict ?? 'unknown';
  const windKt = score?.effectiveWindKt ?? score?.wind?.avgSpeedKt ?? null;
  const dir = score?.wind?.dominantDir ?? null;
  const contributions = score?.wind?.contributions ?? [];
  const waveHeight = score?.waves?.waveHeight ?? null;
  const waterTemp = score?.waterTemp ?? null;

  return (
    <Popup
      longitude={spot.center[0]}
      latitude={spot.center[1]}
      anchor="bottom"
      closeOnClick={false}
      onClose={close}
      maxWidth="380px"
      className="map-dark-scope"
    >
      <div className="w-[280px] text-slate-200">
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <div className="flex items-center justify-center w-7 h-7 rounded-full" style={{ border: '2px dashed #a78bfa', background: 'rgba(15,23,42,0.8)', color: '#a78bfa' }}>
            <WeatherIcon id="map-pin" size={15} />
          </div>
          <div className="flex-1 min-w-0">
            {editing ? (
              <input
                autoFocus
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value.slice(0, MAX_NAME_CHARS))}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitName();
                  if (e.key === 'Escape') setEditing(false);
                }}
                maxLength={MAX_NAME_CHARS}
                className="w-full text-sm font-bold bg-slate-800 border border-violet-400/50 rounded px-1.5 py-0.5 text-white focus:outline-none focus:border-violet-400"
                aria-label="Nombre del spot"
              />
            ) : (
              <button
                onClick={startEdit}
                className="group flex items-center gap-1 max-w-full text-sm font-bold hover:text-violet-300 transition-colors"
                title="Cambiar nombre"
              >
                <span className="truncate">{spot.name}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-50 group-hover:opacity-100"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
              </button>
            )}
            <div className="text-[10px] text-slate-500 font-mono">
              {spot.center[1].toFixed(4)}°N, {Math.abs(spot.center[0]).toFixed(4)}°W
            </div>
          </div>
        </div>

        {/* SIN CALIBRAR banner — unmissable */}
        <div className="flex items-start gap-1.5 mb-2 px-2 py-1.5 rounded-md" style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(167,139,250,0.4)' }}>
          <span style={{ color: '#c4b5fd', marginTop: 1, display: 'flex' }}>
            <WeatherIcon id="alert-triangle" size={13} />
          </span>
          <div className="text-[10.5px] leading-snug text-violet-200">
            <span className="font-bold">Spot sin calibrar.</span> Estimación con las estaciones del entorno. Puede fallar en zonas con microclima propio.
          </div>
        </div>

        {/* Verdict */}
        <div className="flex items-baseline gap-2 mb-2">
          <span className="text-lg font-extrabold" style={{ color: VERDICT_COLOR[verdict] }}>
            {VERDICT_FULL[verdict]}
          </span>
          {windKt !== null && verdict !== 'unknown' && (
            <span className="text-sm font-semibold tabular-nums" style={{ color: VERDICT_COLOR[verdict] }}>
              {windKt.toFixed(0)}kt{dir ? ` ${dir}` : ''}
            </span>
          )}
        </div>

        {/* Raw basis — the stations behind the estimate */}
        {contributions.length > 0 ? (
          <div className="mb-2">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
              Basado en {contributions.length} {contributions.length === 1 ? 'fuente' : 'fuentes'} cercanas
            </div>
            <div className="space-y-0.5">
              {contributions.slice(0, 3).map((c, i) => (
                <div key={i} className="flex items-center justify-between text-[11px]">
                  <span className="truncate text-slate-300 flex-1 mr-2">{c.name}</span>
                  <span className="tabular-nums text-slate-400 shrink-0">
                    {c.speedKt.toFixed(0)}kt{c.dir ? ` ${c.dir}` : ''} · {c.distKm.toFixed(1)}km
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mb-2 text-[11px] text-slate-400">
            Sin estaciones cercanas con viento. Acerca el pin a la costa o a una zona con sensores.
          </div>
        )}

        {/* Marine context if available */}
        {(waveHeight !== null || waterTemp !== null || nextTide) && (
          <div className="flex gap-3 flex-wrap mb-2 text-[11px] text-slate-400">
            {waveHeight !== null && <span>Olas {waveHeight.toFixed(1)}m</span>}
            {waterTemp !== null && <span>Agua {waterTemp.toFixed(0)}°C</span>}
            {nextTide && (
              <span style={{ color: nextTide.type === 'high' ? '#22d3ee' : '#60a5fa' }}>
                {nextTide.type === 'high' ? '▲ Pleamar' : '▼ Bajamar'} {nextTide.time}
              </span>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleSuggest}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
          >
            <WeatherIcon id="message-square" size={13} />
            Sugerir validación del spot
          </button>
          <button
            onClick={handleDelete}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 border border-slate-600 hover:bg-slate-800 hover:text-white transition-colors"
            aria-label="Eliminar spot"
          >
            Eliminar
          </button>
        </div>
      </div>
    </Popup>
  );
});
