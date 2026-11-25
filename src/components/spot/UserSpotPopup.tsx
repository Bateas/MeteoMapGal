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
import { memo, useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Ficha, Note, SupportLink } from '../map/Ficha';
import { Cell } from './Cell';
import { useUserSpotStore } from '../../store/userSpotStore';
import { useUIStore } from '../../store/uiStore';
import { useForecastStore } from '../../hooks/useForecastTimeline';
import { WeatherIcon } from '../icons/WeatherIcons';
import { type UserSpot, MAX_NAME_CHARS, buildSpotSuggestion } from '../../config/userSpots';
import { isCoastalSector } from '../../config/sectors';
import { displayVerdict, displayWindDir, displayWindKt, verdictLabel, fillOf, windToneOver } from '../../config/verdictStyles';
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
  calm: 'Calma', light: 'Flojo', sailing: 'Navegable', good: 'Bueno', strong: 'Fuerte', unknown: 'Sin datos',
};

interface Props {
  spot: UserSpot;
  score?: SpotScore | undefined;
}

export const UserSpotPopup = memo(function UserSpotPopup({ spot, score: propScore }: Props) {
  const storeScore = useUserSpotStore((s) => s.scores.get(spot.id));
  const score = propScore !== undefined ? propScore : storeScore;
  const selectUserSpot = useUserSpotStore((s) => s.selectUserSpot);
  const removeUserSpot = useUserSpotStore((s) => s.removeUserSpot);
  const renameUserSpot = useUserSpotStore((s) => s.renameUserSpot);

  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(spot.name);
  const [nextTide, setNextTide] = useState<NextTide | null>(null);

  // WRF-MG sector forecast (next few hours) — shown in the popup AND bundled
  // into the suggestion report. Subscribes reactively so it fills in once the
  // deferred forecast hook has fetched.
  const forecastHourly = useForecastStore((s) => s.hourly);
  const wrf = useMemo(() => summarizeWrfNextHours(forecastHourly, new Date()), [forecastHourly]);

  // Fetch the nearest tide station's next high/low (Rías only — the inland
  // reservoir has no tide). Used to enrich the suggestion report.
  useEffect(() => {
    if (!isCoastalSector(spot.sectorId)) { setNextTide(null); return; }
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
        const nowMs = now.getTime();
        const nowMins = now.getHours() * 60 + now.getMinutes();
        const next = pts.find((t) => {
          if (t.epochMs && t.epochMs > 0) return t.epochMs > nowMs;
          const p = t.time.split(':').map(Number);
          return p.length >= 2 && p[0] * 60 + p[1] > nowMins;
        }) ?? pts[0];
        setNextTide({ type: next.type, time: next.time, heightM: next.height });
      })
      .catch(() => { if (!cancelled) setNextTide(null); });
    return () => { cancelled = true; };
  }, [spot.id, spot.sectorId, spot.center]);

  // Ficha closes it on Escape, except in the rename field: there the key only cancels the edit.
  const close = useCallback(() => selectUserSpot(null), [selectUserSpot]);
  const titleId = useId();

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
    const text = buildSpotSuggestion({
      name: spot.name,
      lat,
      lon,
      windKt: score?.effectiveWindKt ?? score?.wind?.avgSpeedKt ?? null,
      windDir: displayWindDir(score)?.label ?? null,
      windSources: score?.wind?.stationCount,
      waveHeightM: score?.waves?.waveHeight ?? null,
      waterTempC: score?.waterTemp ?? null,
      tide: nextTide,
      wrf,
    });
    useUIStore.getState().setFeedbackPrefill({ type: 'sugerencia', text: `${text}\n` });
    useUIStore.getState().setFeedbackOpen(true);
    close();
  }, [spot, score, nextTide, wrf, close]);

  const handleDelete = useCallback(() => {
    removeUserSpot(spot.id);
  }, [removeUserSpot, spot.id]);

  // The same rule as the marker: while the data settles, neither a verdict nor a figure
  const verdict: SpotVerdict = displayVerdict(score);
  const windKt = displayWindKt(score);
  const dir = displayWindDir(score)?.label ?? null;
  const windDeg = displayWindDir(score)?.deg ?? null;
  const contributions = score?.wind?.contributions ?? [];
  const waveHeight = score?.waves?.waveHeight ?? null;
  const waterTemp = score?.waterTemp ?? null;

  return (
    <Ficha longitude={spot.center[0]} latitude={spot.center[1]} onClose={close} titleId={titleId}>
      <div className="gf-head">
        <div className="gf-titles">
          {editing ? (
            <input
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value.slice(0, MAX_NAME_CHARS))}
              onBlur={commitName}
              onKeyDown={(e) => {
                // Not while a composition keyboard (Chinese, Japanese, Korean) is still choosing the word: its Enter
                // confirms the word, not the name.
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) commitName();
                if (e.key === 'Escape') setEditing(false);
              }}
              maxLength={MAX_NAME_CHARS}
              className="gf-input gf-namefield"
              id={titleId}
              aria-label="Nombre del spot"
            />
          ) : (
            <h2 id={titleId} className="gf-name">
              <button type="button" onClick={startEdit} className="gf-namebtn" title="Cambiar nombre">
                <span>{spot.name}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
              </button>
            </h2>
          )}
          <div className="gf-sub gf-mono">
            {spot.center[1].toFixed(4).replace('.', ',')}° N, {Math.abs(spot.center[0]).toFixed(4).replace('.', ',')}° O
          </div>
        </div>
      </div>

      <div className="gf-big">
        {/* The marker's own shape: a dashed ring, filled with the state */}
        <svg className="gf-chip" width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
          <circle cx="15" cy="15" r="12" fill={fillOf(verdict, windToneOver(verdict, windKt))} stroke="var(--g-rule)" strokeWidth="2" strokeDasharray="4 3" />
        </svg>
        <span key={`${verdict}-${windKt?.toFixed(0)}`} className="gf-figure">
          {score?.provisional ? verdictLabel(score) : VERDICT_FULL[verdict]}
          {windKt !== null && verdict !== 'unknown' && <> · {windKt.toFixed(0)}</>}
        </span>
        {windKt !== null && verdict !== 'unknown' && (
          <span className="gf-side">
            <b>{windDeg != null ? `nudos del ${dir}` : 'nudos, dirección variable'}</b>
          </span>
        )}
      </div>

      {/* Unmissable: this figure has not been checked against anything */}
      <div className="gf-note gf-note--block gc-t-riesgo" style={{ display: 'block' }}>
        <span className="gf-strong">Spot sin calibrar.</span> Estimación con las estaciones del entorno. Puede fallar en zonas con microclima propio.
      </div>

      {/* The raw basis: the stations behind the estimate */}
      {contributions.length > 0 ? (
        <div className="gf-sec">
          <h3 className="gf-sectitle">
            Basado en {contributions.length} {contributions.length === 1 ? 'fuente' : 'fuentes'} cercanas
          </h3>
          <table className="gf-table">
            <thead>
              <tr>
                <th scope="col">Estación</th>
                <th scope="col" className="gf-n">kt</th>
                <th scope="col" style={{ paddingLeft: 8 }}>Del</th>
                <th scope="col" className="gf-n">Dist.</th>
              </tr>
            </thead>
            <tbody>
              {contributions.slice(0, 3).map((c, i) => (
                <tr key={i}>
                  <td style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</td>
                  <td className="gf-n"><b>{c.speedKt.toFixed(0)}</b></td>
                  <td style={{ paddingLeft: 8 }}>{c.dir || '–'}</td>
                  <td className="gf-n">{c.distKm.toFixed(1).replace('.', ',')} km</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="gf-notes">
          <Note icon="info">Sin estaciones cercanas con viento. Acerca el pin a la costa o a una zona con sensores.</Note>
        </div>
      )}

      {(waveHeight !== null || waterTemp !== null || nextTide || wrf) && (
        <dl className="gf-data">
          {waveHeight !== null && <Cell label="Olas" value={`${waveHeight.toFixed(1).replace('.', ',')} m`} />}
          {waterTemp !== null && <Cell label="Agua" value={`${waterTemp.toFixed(0)} °C`} />}
          {nextTide && <Cell label={nextTide.type === 'high' ? 'Próxima pleamar' : 'Próxima bajamar'} value={nextTide.time} />}
          {wrf && <Cell label="Previsión WRF, próximas horas" value={`${Math.round(wrf.kt)} kt${wrf.dir ? ` ${wrf.dir}` : ''}`} />}
        </dl>
      )}

      <div className="gf-actions" style={{ borderTop: '1px solid var(--g-hair)' }}>
        <button type="button" onClick={handleSuggest} className="gc-btn gc-btn--primary gc-btn--grow">
          <WeatherIcon id="message-square" size={15} />
          Sugerir que lo validemos
        </button>
        <button type="button" onClick={handleDelete} className="gc-btn" aria-label="Eliminar spot">
          Eliminar
        </button>
      </div>

      {/* Discreet support link: only when the estimate has real data, never on the «sin datos» moment. */}
      {contributions.length > 0 && (
        <div className="gf-foot" style={{ borderTop: 0 }}>
          <SupportLink />
        </div>
      )}
    </Ficha>
  );
});
