/**
 * TidePanel: tide predictions for Rías Baixas, in the Condiciones column.
 *
 * Shows today + tomorrow high/low tides from IHM API.
 * Includes a mini visual tide curve and next tide indicator.
 * Only rendered in coastal sectors (FieldDrawer gates it with isCoastalSector).
 */

import { memo, useState, useMemo, useCallback } from 'react';
import { fetchTides48h, RIAS_TIDE_STATIONS, DEFAULT_TIDE_STATION } from '../../api/tideClient';
import type { TidePoint, TideStation } from '../../api/tideClient';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';
import { describeTideStrength, peakAmplitude } from '../../services/tideAlertService';
import { useMeteoTide, useGaugeLevel } from '../../hooks/useMeteoTide';
import { WeatherIcon } from '../icons/WeatherIcons';
import { formatMeteoTide } from '../../services/meteoTideService';

interface TideData {
  /** The IHM was failing and this is the last table it gave for the day. */
  fromCache?: boolean;
  /** The IHM was failing and MeteoGalicia's table for this port stood in. */
  meteoSixPort?: string | null;
  today: TidePoint[];
  tomorrow: TidePoint[];
  yesterday?: TidePoint[];
  all?: TidePoint[];
  station: TideStation;
  fetchedAt: Date;
}

const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const PORT_KEY = 'meteomap-tide-port';

/** The port chosen last time: it used to go back to Vigo on every opening. */
function loadPort(): TideStation {
  try {
    const id = localStorage.getItem(PORT_KEY);
    return RIAS_TIDE_STATIONS.find((s) => s.id === id) ?? DEFAULT_TIDE_STATION;
  } catch {
    return DEFAULT_TIDE_STATION;
  }
}

function savePort(s: TideStation): void {
  try { localStorage.setItem(PORT_KEY, s.id); } catch { /* private mode: it just will not be remembered */ }
}

/** Safely parse "HH:MM" → [hours, minutes]. Returns null if malformed. */
function parseTimeHHMM(time: string): [number, number] | null {
  if (!time || !time.includes(':')) return null;
  const parts = time.split(':').map(Number);
  if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
  return [parts[0], parts[1]];
}

export const TidePanel = memo(function TidePanel() {
  const [data, setData] = useState<TideData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [station, setStation] = useState<TideStation>(loadPort);
  const [expanded, setExpanded] = useState(false);
  const meteoTide = useMeteoTide(station.id);
  const gaugeLevel = useGaugeLevel(station.id);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await fetchTides48h(station.id);
      setData({
        today: result.today,
        tomorrow: result.tomorrow,
        yesterday: result.yesterday,
        all: result.all,
        fromCache: result.fromCache ?? false,
        meteoSixPort: result.meteoSixPort,
        station,
        fetchedAt: new Date(),
      });
    } catch (err) {
      console.error('[TidePanel] Fetch error:', err);
      setError('ihm-unavailable');
    } finally {
      setLoading(false);
    }
  }, [station]);

  // Visibility-aware polling — pauses when tab is hidden
  useVisibilityPolling(fetchData, REFRESH_INTERVAL_MS);

  // Find next tide event
  const nextTide = useMemo(() => {
    if (!data) return null;
    const now = new Date();
    const nowMs = now.getTime();
    const todayStr = now.toISOString().slice(0, 10);

    for (const point of data.today) {
      if (point.epochMs && point.epochMs > 0) {
        if (point.epochMs > nowMs) {
          return { ...point, date: new Date(point.epochMs) };
        }
        continue;
      }
      const parsed = parseTimeHHMM(point.time);
      if (!parsed) continue;
      const tideTime = new Date(todayStr);
      tideTime.setHours(parsed[0], parsed[1], 0, 0);
      if (tideTime > now) {
        return { ...point, date: tideTime };
      }
    }

    // If all today's tides are past, return first tomorrow
    if (data.tomorrow.length > 0) {
      const tmrw = new Date(now);
      tmrw.setDate(tmrw.getDate() + 1);
      const tmrwStr = tmrw.toISOString().slice(0, 10);
      for (const first of data.tomorrow) {
        if (first.epochMs && first.epochMs > 0) {
          return { ...first, date: new Date(first.epochMs) };
        }
        const parsed = parseTimeHHMM(first.time);
        if (parsed) {
          const tideTime = new Date(tmrwStr);
          tideTime.setHours(parsed[0], parsed[1], 0, 0);
          return { ...first, date: tideTime };
        }
      }
    }

    return null;
  }, [data]);

  // Current tide state (rising or falling)
  const tideState = useMemo(() => {
    if (!data) return null;
    const now = new Date();
    const nowMs = now.getTime();
    const all = [...data.today, ...data.tomorrow];
    if (all.length < 2) return null;

    let prev: { time: Date; type: 'high' | 'low' } | null = null;
    let next: { time: Date; type: 'high' | 'low' } | null = null;

    for (const point of all) {
      let tideTime: Date;
      if (point.epochMs && point.epochMs > 0) {
        tideTime = new Date(point.epochMs);
      } else {
        const parsed = parseTimeHHMM(point.time);
        if (!parsed) continue;
        const isTomorrow = data.tomorrow.includes(point);
        const dayDate = new Date(now);
        if (isTomorrow) dayDate.setDate(dayDate.getDate() + 1);
        tideTime = new Date(dayDate.toISOString().slice(0, 10));
        tideTime.setHours(parsed[0], parsed[1], 0, 0);
      }

      if (tideTime.getTime() <= nowMs) {
        prev = { time: tideTime, type: point.type };
      } else if (!next) {
        next = { time: tideTime, type: point.type };
      }
    }

    if (!prev || !next) return null;

    const diff = next.time.getTime() - prev.time.getTime();
    if (diff <= 0) return null;

    return {
      rising: next.type === 'high',
      progress: Math.min(1, Math.max(0, (nowMs - prev.time.getTime()) / diff)),
    };
  }, [data]);

  // Casual "how big is the tide today" — translates the coeficiente/"+ -" jargon
  // (which a casual visitor doesn't read) into plain words + a strength bar.
  const tideStrength = useMemo(
    () => (data ? describeTideStrength(peakAmplitude(data.today)) : null),
    [data],
  );

  // Full semi-diurnal cycle for the visual curve (at least 4 points to show the complete wave):
  // When a day only has 3 events (because one shifted past midnight to tomorrow),
  // or to keep the curve continuous through night hours, we include adjacent tide points.
  const curveCyclePoints = useMemo(() => {
    if (!data) return [];
    const today = data.today;
    const tomorrow = data.tomorrow;
    const yesterday = data.yesterday ?? [];

    if (today.length === 0) return [];

    const nowMs = Date.now();
    let pts = [...today];

    // Prepend previous tide from yesterday if now is before today's first tide, or if pts < 4
    if (yesterday.length > 0 && pts.length > 0) {
      const firstTodayMs = pts[0].epochMs;
      if (!firstTodayMs || nowMs < firstTodayMs || pts.length < 4) {
        const lastYest = yesterday[yesterday.length - 1];
        if (lastYest && (!firstTodayMs || !lastYest.epochMs || lastYest.epochMs < firstTodayMs)) {
          if (!pts.some((p) => (p.epochMs && lastYest.epochMs ? p.epochMs === lastYest.epochMs : p.time === lastYest.time && p.date === lastYest.date))) {
            pts = [lastYest, ...pts];
          }
        }
      }
    }

    // Append next tide from tomorrow if now is after today's last tide, or if pts < 4
    if (tomorrow.length > 0 && pts.length > 0) {
      const lastPtMs = pts[pts.length - 1].epochMs;
      const lastTodayMs = today[today.length - 1]?.epochMs;
      if (pts.length < 4 || (lastTodayMs && nowMs > lastTodayMs) || !lastPtMs) {
        const firstTmrw = tomorrow[0];
        if (firstTmrw && (!lastPtMs || !firstTmrw.epochMs || firstTmrw.epochMs > lastPtMs)) {
          if (!pts.some((p) => (p.epochMs && firstTmrw.epochMs ? p.epochMs === firstTmrw.epochMs : p.time === firstTmrw.time && p.date === firstTmrw.date))) {
            pts.push(firstTmrw);
          }
        }
      }
    }

    // If still < 4 points and tomorrow has another point, append it to complete the cycle
    if (pts.length < 4 && tomorrow.length > 1) {
      const secondTmrw = tomorrow[1];
      const lastPtMs = pts[pts.length - 1].epochMs;
      if (secondTmrw && (!lastPtMs || !secondTmrw.epochMs || secondTmrw.epochMs > lastPtMs)) {
        if (!pts.some((p) => (p.epochMs && secondTmrw.epochMs ? p.epochMs === secondTmrw.epochMs : p.time === secondTmrw.time && p.date === secondTmrw.date))) {
          pts.push(secondTmrw);
        }
      }
    }

    return pts.length >= 2 ? pts : today;
  }, [data]);

  if (loading && !data) {
    return (
      <div className="gc-condfold">
        <WeatherIcon id="anchor" size={18} />
        <span className="gc-condfold-text">
          <b>Mareas</b>
          <span>Cargando...</span>
        </span>
      </div>
    );
  }

  if (error || !data) {
    // Reached only when the IHM, the stored copy and MeteoGalicia all failed
    // for TODAY (a missing tomorrow only leaves the "Mañana" row empty).
    // Not our failure and says nothing about the sea: say so plainly, and
    // still show what the gauge measured, which needs no table. The surge
    // does, so it is not guessed. The client does not ask again until the
    // page is reloaded, so the text must not promise a retry.
    const ageMin = gaugeLevel ? Math.max(0, Math.round((Date.now() - gaugeLevel.at.getTime()) / 60_000)) : 0;
    return (
      <>
        <div className="gc-condfold">
          <WeatherIcon id="anchor" size={18} />
          <span className="gc-condfold-text">
            <b>Mareas</b>
            <span>Tabla de mareas no disponible</span>
          </span>
        </div>
        <div className="gc-condfold-body">
          <p className="gc-tide-note" style={{ marginTop: 0 }}>
            Ni el Instituto Hidrográfico ni MeteoGalicia responden ahora mismo. Se vuelve a consultar al recargar la página.
          </p>
          {gaugeLevel && (
            <>
              <span className="gc-tide-sub">Nivel medido ahora ({gaugeLevel.gaugeName})</span>
              <div className="gc-tide-row">
                <b>{gaugeLevel.observedM.toFixed(2).replace('.', ',')} m</b>
                <span>{ageMin < 60 ? `hace ${ageMin} min` : `hace ${Math.round(ageMin / 60)} h`}</span>
              </div>
              <p className="gc-tide-note">Sin la tabla no se puede calcular la resaca.</p>
            </>
          )}
        </div>
      </>
    );
  }

  const hasTags = data.fromCache || data.meteoSixPort !== undefined
    || (tideStrength && (tideStrength.category === 'vivas' || tideStrength.category === 'extremas'))
    || (meteoTide && meteoTide.level !== 'none');

  return (
    <>
      {/* Header: station + next tide */}
      <button type="button" className="gc-condfold" aria-expanded={expanded} onClick={() => setExpanded((p) => !p)}>
        <WeatherIcon id="anchor" size={18} />
        <span className="gc-condfold-text">
          <b>Mareas</b>
          <span>{data.station.name}</span>
          {nextTide && (
            <span>
              Próxima: {nextTide.type === 'high' ? 'Pleamar' : 'Bajamar'} {nextTide.time}, {nextTide.height.toFixed(1).replace('.', ',')} m
              {tideState && (tideState.rising ? ', subiendo' : ', bajando')}
            </span>
          )}
          {hasTags && (
            <span className="gc-tide-tags">
              {data.fromCache && (
                <span
                  className="gc-tide-tag"
                  title="El IHM no responde ahora: es la última tabla descargada para hoy, y una tabla de mareas no cambia."
                >
                  tabla guardada
                </span>
              )}
              {data.meteoSixPort !== undefined && (
                <span
                  className="gc-tide-tag"
                  title={`El IHM no responde ahora: horas y alturas de la tabla de MeteoGalicia${data.meteoSixPort ? ` (puerto de ${data.meteoSixPort})` : ''}.`}
                >
                  tabla MeteoGalicia{data.meteoSixPort ? ` · ${data.meteoSixPort}` : ''}
                </span>
              )}
              {tideStrength && (tideStrength.category === 'vivas' || tideStrength.category === 'extremas') && (
                <span className="gc-tide-tag">{tideStrength.label}</span>
              )}
              {meteoTide && meteoTide.level !== 'none' && (
                <span
                  className="gc-tide-tag"
                  title={`Marea meteorológica medida en mareógrafo: ${meteoTide.residualM > 0 ? '+' : ''}${Math.round(meteoTide.residualM * 100)} cm sobre la tabla astronómica`}
                >
                  {formatMeteoTide(meteoTide)}
                </span>
              )}
            </span>
          )}
        </span>
        <svg className="gc-condline-more" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* Expanded: full tide table + tomorrow + station picker */}
      {expanded && (
        <div className="gc-condfold-body">
          {/* Casual tide-strength summary: the coefficient in plain words. It is our own calculation. */}
          {tideStrength && (
            <div>
              <span className="gc-tide-sub" style={{ marginTop: 0 }}>{tideStrength.label}</span>
              {tideStrength.isSeasonalPeak && <p className="gc-tide-note">De las más fuertes del año.</p>}
              <p className="gc-tide-note">{tideStrength.casual}. Coeficiente {tideStrength.coef}, calculado por nosotros.</p>
              <div className="gc-tide-bar"><i style={{ width: `${Math.round(tideStrength.strength * 100)}%` }} /></div>
            </div>
          )}

          {/* Tide progress bar */}
          {tideState && (
            <div>
              <span className="gc-tide-sub">{tideState.rising ? 'Subiendo, hacia la pleamar' : 'Bajando, hacia la bajamar'}: {Math.round(tideState.progress * 100)} %</span>
              <div className="gc-tide-bar"><i style={{ width: `${Math.min(100, Math.max(0, tideState.progress * 100))}%` }} /></div>
            </div>
          )}

          {/* Live tide gauge (REDMAR) vs Astronomical Table */}
          {meteoTide && (
            <div>
              <span className="gc-tide-sub">Nivel real mareógrafo{meteoTide.gaugeName ? ` (${meteoTide.gaugeName})` : ''}</span>
              <div className="gc-tide-gauge">
                <div>Medido <b>{meteoTide.observedM.toFixed(2).replace('.', ',')} m</b></div>
                <div>Tabla <b>{meteoTide.astronomicalM.toFixed(2).replace('.', ',')} m</b></div>
                <div>Diferencia <b>{meteoTide.residualM > 0 ? '+' : ''}{Math.round(meteoTide.residualM * 100)} cm</b></div>
              </div>
              {meteoTide.level !== 'none' && (
                <p className="gc-tide-note">
                  {meteoTide.residualM > 0
                    ? `El nivel del agua se sitúa ${Math.round(meteoTide.residualM * 100)} cm por encima de la tabla astronómica por efecto de viento y presión.`
                    : `El nivel del agua se sitúa ${Math.round(Math.abs(meteoTide.residualM) * 100)} cm por debajo de la tabla astronómica.`}
                </p>
              )}
            </div>
          )}

          {/* Mini tide curve SVG: full semi-diurnal cycle */}
          <span className="gc-tide-sub">Curva</span>
          <TideCurve points={curveCyclePoints} label="Hoy" />

          {/* Today's tide table */}
          <TideTable points={data.today} label="Hoy" />

          {/* Tomorrow's tide table */}
          {data.tomorrow.length > 0 && (
            <TideTable points={data.tomorrow} label="Mañana" />
          )}

          {/* Station selector */}
          <span className="gc-tide-sub">Puerto de referencia</span>
          <div className="gc-tide-ports">
            {RIAS_TIDE_STATIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                className="gc-tide-chip"
                aria-pressed={station.id === s.id}
                onClick={() => { setStation(s); savePort(s); }}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
});

// ── Sub-components ────────────────────────────────────────

function TideTable({ points, label }: { points: TidePoint[]; label: string }) {
  return (
    <div>
      <span className="gc-tide-sub">{label}</span>
      <div className="gc-tide-rows">
        {points.map((p, i) => (
          <div key={i} className="gc-tide-row">
            <b>{p.time}</b>
            <span>{p.height.toFixed(2).replace('.', ',')} m</span>
            <span>{p.type === 'high' ? 'Pleamar' : 'Bajamar'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TideCurve({ points, label }: { points: TidePoint[]; label: string }) {
  const W = 200;
  const H = 44;
  const PAD = 4;

  // Reconstruct monotonic timestamps (using epochMs when present, with rollover fallback).
  // Before any return: a hook after one broke when the points went from under 2 to 2 or more.
  const parsed = useMemo(() => {
    let prevMs = 0;
    const now = new Date();
    const result: Array<{ ms: number; time: string; height: number; type: 'high' | 'low' }> = [];

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      let ms = p.epochMs;
      if (!ms || ms <= 0) {
        const t = parseTimeHHMM(p.time);
        if (!t) continue;
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), t[0], t[1], 0, 0);
        ms = d.getTime();
        // If sequential points cross midnight or roll backward, advance 24h
        while (ms <= prevMs) {
          ms += 24 * 60 * 60 * 1000;
        }
      }
      prevMs = ms;
      result.push({
        ms,
        time: p.time,
        height: p.height,
        type: p.type,
      });
    }
    return result;
  }, [points]);

  if (parsed.length < 2) return null;

  const minMs = parsed[0].ms;
  const maxMs = parsed[parsed.length - 1].ms;
  const timeSpan = maxMs - minMs;
  if (timeSpan <= 0) return null;

  const minH = Math.min(...parsed.map((p) => p.height));
  const maxH = Math.max(...parsed.map((p) => p.height));
  const range = maxH - minH || 1;

  // Generate smooth curve points using cosine interpolation between tides
  const curvePoints: string[] = [];
  const steps = 48; // resolution

  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const currMs = minMs + t * timeSpan;

    // Find surrounding tide points
    let prevIdx = 0;
    for (let j = 0; j < parsed.length - 1; j++) {
      if (currMs >= parsed[j].ms) prevIdx = j;
    }
    const nextIdx = Math.min(prevIdx + 1, parsed.length - 1);

    const segLen = parsed[nextIdx].ms - parsed[prevIdx].ms || 1;
    const segT = Math.min(1, Math.max(0, (currMs - parsed[prevIdx].ms) / segLen));
    // Cosine interpolation for smooth tide curve
    const cosT = (1 - Math.cos(segT * Math.PI)) / 2;
    const height = parsed[prevIdx].height + cosT * (parsed[nextIdx].height - parsed[prevIdx].height);

    const x = PAD + t * (W - 2 * PAD);
    const y = H - PAD - ((height - minH) / range) * (H - 2 * PAD);
    curvePoints.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }

  // Current time marker
  const nowMs = Date.now();
  let nowX: number | null = null;
  let nowY: number | null = null;

  if (nowMs >= minMs && nowMs <= maxMs) {
    const t = (nowMs - minMs) / timeSpan;
    nowX = PAD + t * (W - 2 * PAD);

    // Interpolate height at current time
    let prevIdx = 0;
    for (let j = 0; j < parsed.length - 1; j++) {
      if (nowMs >= parsed[j].ms) prevIdx = j;
    }
    const nextIdx = Math.min(prevIdx + 1, parsed.length - 1);
    const segLen = parsed[nextIdx].ms - parsed[prevIdx].ms || 1;
    const segT = Math.min(1, Math.max(0, (nowMs - parsed[prevIdx].ms) / segLen));
    const cosT = (1 - Math.cos(segT * Math.PI)) / 2;
    const height = parsed[prevIdx].height + cosT * (parsed[nextIdx].height - parsed[prevIdx].height);
    nowY = H - PAD - ((height - minH) / range) * (H - 2 * PAD);
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="gc-tide-curve" role="img" aria-label={`Curva de mareas ${label}`}>
      {/* Curve line, in ink: the state colour is only for now */}
      <polyline
        points={curvePoints.join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* High/low markers */}
      {parsed.map((p, i) => {
        const t = (p.ms - minMs) / timeSpan;
        const x = PAD + t * (W - 2 * PAD);
        const y = H - PAD - ((p.height - minH) / range) * (H - 2 * PAD);
        return <circle key={i} cx={x} cy={y} r="2.5" fill="currentColor" />;
      })}

      {/* Current time marker */}
      {nowX !== null && nowY !== null && (
        <>
          <line x1={nowX} y1={0} x2={nowX} y2={H} stroke="var(--g-l-alto)" strokeWidth="0.75" strokeDasharray="2,2" />
          <circle cx={nowX} cy={nowY} r="3" fill="var(--g-l-alto)" />
        </>
      )}
    </svg>
  );
}
