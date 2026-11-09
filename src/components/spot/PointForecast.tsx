/**
 * The next days at one exact point (WRF 1 km) and the official warnings of its own zone. For weather
 * points, where the question is when it rains during the day's work, not whether it blows.
 */
import { memo, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { fetchMeteoSixForecast } from '../../api/meteoSixClient';
import { fetchMeteoPointStatus, type MeteoPointStatus } from '../../api/meteoPointStatusClient';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';
import { fetchMGWarnings, type MGWarning } from '../../api/mgWarningsClient';
import { WeatherIcon } from '../icons/WeatherIcons';
import { PointMeteogram } from './PointMeteogram';
import { summarizeDays, describeBands, describeNextRain, warningsForZones } from '../../services/pointForecast';
import type { HourlyForecast } from '../../types/forecast';

const TTL_MS = 30 * 60_000;
const STATUS_POLL_MS = 5 * 60_000;
/** The «now» mark on the chart moves with the card open. */
const CLOCK_MS = 60_000;

/** `?simpanorama=<state>`: how the line looks before the server has anything to say. */
const SIM_PANORAMA: Record<string, string> = {
  coincide: 'Llueve en Amiudal (1,2 mm en la última hora), como daba el WRF.',
  adelanta: 'Ya llueve en Amiudal (0,8 mm en la última hora) y el WRF no la daba hasta las 13 h: va unas 3 h adelantada.',
  'no-llega': 'El WRF daba lluvia a las 8 h y Amiudal no ha medido nada: aún no ha llegado, no llegará o es tan débil que no marca.',
  'ya-paso': 'Ya pasó por Amiudal: midió 1,4 mm antes de las 8 h, que es cuando la daba el WRF.',
  seco: 'Amiudal no mide lluvia y el WRF no la da hasta las 16 h.',
};

/** Module-level so reopening the card, or a remount, reuses the answer (the model changes a few times a day). */
const cache = new Map<string, { at: number; promise: Promise<HourlyForecast[]> }>();

function loadForecast(lat: number, lon: number): Promise<HourlyForecast[]> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = fetchMeteoSixForecast(lat, lon);
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => cache.delete(key));
  return promise;
}

export function __clearPointForecastCacheForTests(): void {
  cache.clear();
}

/** The alert levels of the map, adjusted per theme in the tokens. */
const LEVEL_TONE: Record<number, string> = { 1: 'var(--g-l-moderado)', 2: 'var(--g-l-alto)', 3: 'var(--g-l-critico)' };

interface Props {
  pointId: string;
  lat: number;
  lon: number;
  /** Official warning zones of this point, by the name the feed gives them. */
  zones: string[];
}

export const PointForecast = memo(function PointForecast({ pointId, lat, lon, zones }: Props) {
  const [hours, setHours] = useState<HourlyForecast[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [warnings, setWarnings] = useState<MGWarning[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    loadForecast(lat, lon)
      .then((h) => { if (!cancelled) setHours(h); })
      .catch(() => { if (!cancelled) setFailed(true); });
    fetchMGWarnings()
      .then((w) => { if (!cancelled) setWarnings(w); })
      .catch(() => { /* the forecast still stands without them; nothing is claimed about warnings */ });
    return () => { cancelled = true; };
  }, [lat, lon]);

  const [status, setStatus] = useState<MeteoPointStatus | null>(null);
  const pollStatus = useCallback(async () => {
    const sim = new URLSearchParams(window.location.search).get('simpanorama');
    if (sim && SIM_PANORAMA[sim]) { setStatus({ state: sim, text: SIM_PANORAMA[sim] }); return; }
    setStatus(await fetchMeteoPointStatus(pointId));
  }, [pointId]);
  useVisibilityPolling(pollStatus, STATUS_POLL_MS);
  const [clock, setClock] = useState(() => new Date());
  useVisibilityPolling(() => setClock(new Date()), CLOCK_MS);

  const days = useMemo(() => (hours ? summarizeDays(hours, new Date()) : []), [hours]);
  const nextRain = useMemo(() => (hours ? describeNextRain(hours, new Date()) : null), [hours]);
  const active = useMemo(() => (warnings ? warningsForZones(warnings, zones, new Date()) : []), [warnings, zones]);

  return (
    <>
      {nextRain && <p className="gf-say" style={{ '--gf-tone': 'var(--gfp-2)' } as CSSProperties}>{nextRain}</p>}

      {status && (
        <p className="gfp-panorama" data-state={status.state}>
          <span>Ahora, frente al WRF</span>
          {status.text}
        </p>
      )}

      <section className="gf-group gfp-first">
        <div className="gf-grouphead"><h3>Por horas</h3><span>WRF 1 km en este punto</span></div>
        {failed && <div className="gf-hint">Sin previsión ahora mismo. Vuelve a abrir la ficha en un rato.</div>}
        {!failed && !hours && <div className="gf-hint">Cargando previsión…</div>}
        {hours && days.length === 0 && <div className="gf-hint">El modelo no llega a los próximos días.</div>}
        {days.length > 0 && <PointMeteogram days={days} now={clock} />}
        {days.length > 0 && (
          <div className="gfp-bandlist">
            {days.map((d) => (
              <div key={d.dayKey} className="gfp-bandline">
                <span className="gfp-label">{d.label}</span>
                <span>{describeBands(d.bands)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {active.length > 0 && (
        <section className="gf-group">
          <div className="gf-grouphead"><h3>Avisos oficiales</h3><span>{zones[0]}</span></div>
          <div className="gf-notes">
            {active.slice(0, 6).map((w) => (
              <div key={w.key} className="gf-note" style={{ '--tone': LEVEL_TONE[w.level] } as CSSProperties}>
                <span aria-hidden="true"><WeatherIcon id="alert-triangle" size={14} /></span>
                <div>
                  <span className="gf-strong">{w.type}</span>
                  <small>{w.active ? `Hasta ${w.endLabel}` : `${w.startLabel} a ${w.endLabel}`}{w.comment ? ` · ${w.comment}` : ''}</small>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {warnings && active.length === 0 && zones.length > 0 && (
        <p className="gf-hint gfp-noalert">Sin avisos oficiales en {zones[0]}.</p>
      )}
    </>
  );
});
