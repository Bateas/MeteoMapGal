/**
 * TidePanel — Compact tide predictions for Rías Baixas.
 *
 * Shows today + tomorrow high/low tides from IHM API.
 * Includes a mini visual tide curve and next tide indicator.
 * Only rendered when activeSector === 'rias'.
 */

import { memo, useState, useMemo, useCallback } from 'react';
import { fetchTides48h, RIAS_TIDE_STATIONS, DEFAULT_TIDE_STATION } from '../../api/tideClient';
import type { TidePoint, TideStation } from '../../api/tideClient';
import { Anchor, ChevronDown, ChevronUp } from 'lucide-react';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';

interface TideData {
  today: TidePoint[];
  tomorrow: TidePoint[];
  station: TideStation;
  fetchedAt: Date;
}

const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

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
  const [station, setStation] = useState<TideStation>(DEFAULT_TIDE_STATION);
  const [expanded, setExpanded] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await fetchTides48h(station.id);
      setData({
        today: result.today,
        tomorrow: result.tomorrow,
        station,
        fetchedAt: new Date(),
      });
    } catch (err) {
      console.error('[TidePanel] Fetch error:', err);
      setError('Error cargando mareas');
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
    const todayStr = now.toISOString().slice(0, 10);

    for (const point of data.today) {
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
      const first = data.tomorrow[0];
      const parsed = parseTimeHHMM(first.time);
      if (parsed) {
        const tideTime = new Date(tmrwStr);
        tideTime.setHours(parsed[0], parsed[1], 0, 0);
        return { ...first, date: tideTime };
      }
    }

    return null;
  }, [data]);

  // Current tide state (rising or falling)
  const tideState = useMemo(() => {
    if (!data || data.today.length < 2) return null;
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const nowMs = now.getTime();

    let prev: { time: Date; type: 'high' | 'low' } | null = null;
    let next: { time: Date; type: 'high' | 'low' } | null = null;

    for (const point of data.today) {
      const parsed = parseTimeHHMM(point.time);
      if (!parsed) continue;
      const tideTime = new Date(todayStr);
      tideTime.setHours(parsed[0], parsed[1], 0, 0);

      if (tideTime.getTime() <= nowMs) {
        prev = { time: tideTime, type: point.type };
      } else if (!next) {
        next = { time: tideTime, type: point.type };
      }
    }

    if (!prev || !next) return null;

    return {
      rising: next.type === 'high',
      progress: (nowMs - prev.time.getTime()) / (next.time.getTime() - prev.time.getTime()),
    };
  }, [data]);

  if (loading && !data) {
    return (
      <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-2.5">
        <div className="flex items-center gap-2">
          <Anchor className="w-3.5 h-3.5 text-cyan-500" />
          <span className="text-[11px] font-bold text-slate-200">Mareas</span>
          <span className="text-[11px] text-slate-500 ml-auto">Cargando...</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-2.5">
        <div className="flex items-center gap-2">
          <Anchor className="w-3.5 h-3.5 text-cyan-500" />
          <span className="text-[11px] font-bold text-slate-200">Mareas</span>
          <span className="text-[11px] text-red-400 ml-auto">{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 transition-all">
      {/* Header: station + next tide */}
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
      >
        <Anchor className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-cyan-300">Mareas</span>
            <span className="text-[11px] text-slate-500">{data.station.name}</span>
          </div>
          {nextTide && (
            <p className="text-[11px] text-slate-400 truncate mt-0.5">
              Próx: {nextTide.type === 'high' ? '▲ Pleamar' : '▼ Bajamar'} {nextTide.time} — {nextTide.height.toFixed(1)}m
              {tideState && (
                <span className="ml-1.5 text-cyan-500">
                  {tideState.rising ? '↗ Subiendo' : '↘ Bajando'}
                </span>
              )}
            </p>
          )}
        </div>
        {expanded
          ? <ChevronUp className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
          : <ChevronDown className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
        }
      </button>

      {/* Expanded: full tide table + tomorrow + station picker */}
      {expanded && (
        <div className="px-3 pb-2.5 space-y-2 border-t border-slate-700/50">
          {/* Tide progress bar */}
          {tideState && (
            <div className="pt-2">
              <div className="flex items-center gap-1 mb-1">
                <span className="text-[11px] text-slate-500">
                  {tideState.rising ? 'Subiendo (→ pleamar)' : 'Bajando (→ bajamar)'}
                </span>
                <span className="text-[11px] text-cyan-400 ml-auto font-mono">
                  {Math.round(tideState.progress * 100)}%
                </span>
              </div>
              <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, Math.max(0, tideState.progress * 100))}%`,
                    background: tideState.rising
                      ? 'linear-gradient(90deg, #06b6d4, #22d3ee)'
                      : 'linear-gradient(90deg, #22d3ee, #0891b2)',
                  }}
                />
              </div>
            </div>
          )}

          {/* Mini tide curve SVG */}
          <TideCurve points={data.today} label="Hoy" />

          {/* Today's tide table */}
          <TideTable points={data.today} label="Hoy" />

          {/* Tomorrow's tide table */}
          {data.tomorrow.length > 0 && (
            <TideTable points={data.tomorrow} label="Mañana" />
          )}

          {/* Station selector */}
          <div className="pt-1.5 border-t border-slate-700/30">
            <span className="text-[11px] text-slate-500 block mb-1">Puerto de referencia:</span>
            <div className="flex flex-wrap gap-1">
              {RIAS_TIDE_STATIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setStation(s)}
                  className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
                    station.id === s.id
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'bg-slate-800 text-slate-500 hover:text-slate-300 border border-slate-700/50'
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

// ── Sub-components ────────────────────────────────────────

function TideTable({ points, label }: { points: TidePoint[]; label: string }) {
  return (
    <div>
      <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">{label}</span>
      <div className="space-y-0.5 mt-0.5">
        {points.map((p, i) => (
          <div key={i} className="flex items-center gap-2 text-[11px]">
            <span className={`w-4 text-center ${p.type === 'high' ? 'text-cyan-400' : 'text-blue-400'}`}>
              {p.type === 'high' ? '▲' : '▼'}
            </span>
            <span className="text-slate-400 font-mono w-12">{p.time}</span>
            <span className={`font-bold ${p.type === 'high' ? 'text-cyan-300' : 'text-blue-300'}`}>
              {p.height.toFixed(2)}m
            </span>
            <span className="text-slate-600 text-[11px]">
              {p.type === 'high' ? 'Pleamar' : 'Bajamar'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TideCurve({ points, label }: { points: TidePoint[]; label: string }) {
  if (points.length < 2) return null;

  const W = 200;
  const H = 32;
  const PAD = 4;

  // Parse times to fractional hours (skip malformed entries)
  const parsed = points
    .map((p) => {
      const t = parseTimeHHMM(p.time);
      if (!t) return null;
      return { hour: t[0] + t[1] / 60, height: p.height, type: p.type };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  if (parsed.length < 2) return null;

  const minH = Math.min(...parsed.map((p) => p.height));
  const maxH = Math.max(...parsed.map((p) => p.height));
  const range = maxH - minH || 1;

  // Generate smooth curve points using cosine interpolation between tides
  const curvePoints: string[] = [];
  const steps = 48; // resolution

  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const hour = parsed[0].hour + t * (parsed[parsed.length - 1].hour - parsed[0].hour);

    // Find surrounding tide points
    let prevIdx = 0;
    for (let j = 0; j < parsed.length - 1; j++) {
      if (hour >= parsed[j].hour) prevIdx = j;
    }
    const nextIdx = Math.min(prevIdx + 1, parsed.length - 1);

    const segLen = parsed[nextIdx].hour - parsed[prevIdx].hour || 1;
    const segT = (hour - parsed[prevIdx].hour) / segLen;
    // Cosine interpolation for smooth tide curve
    const cosT = (1 - Math.cos(segT * Math.PI)) / 2;
    const height = parsed[prevIdx].height + cosT * (parsed[nextIdx].height - parsed[prevIdx].height);

    const x = PAD + t * (W - 2 * PAD);
    const y = H - PAD - ((height - minH) / range) * (H - 2 * PAD);
    curvePoints.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }

  // Current time marker
  const now = new Date();
  const nowHour = now.getHours() + now.getMinutes() / 60;
  const firstHour = parsed[0].hour;
  const lastHour = parsed[parsed.length - 1].hour;
  const hourSpan = lastHour - firstHour;
  let nowX: number | null = null;
  let nowY: number | null = null;

  if (hourSpan > 0 && nowHour >= firstHour && nowHour <= lastHour) {
    const t = (nowHour - firstHour) / hourSpan;
    nowX = PAD + t * (W - 2 * PAD);

    // Interpolate height at current time
    let prevIdx = 0;
    for (let j = 0; j < parsed.length - 1; j++) {
      if (nowHour >= parsed[j].hour) prevIdx = j;
    }
    const nextIdx = Math.min(prevIdx + 1, parsed.length - 1);
    const segLen = parsed[nextIdx].hour - parsed[prevIdx].hour || 1;
    const segT = (nowHour - parsed[prevIdx].hour) / segLen;
    const cosT = (1 - Math.cos(segT * Math.PI)) / 2;
    const height = parsed[prevIdx].height + cosT * (parsed[nextIdx].height - parsed[prevIdx].height);
    nowY = H - PAD - ((height - minH) / range) * (H - 2 * PAD);
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-8" aria-label={`Curva de mareas ${label}`}>
      {/* Gradient fill under curve */}
      <defs>
        <linearGradient id="tideFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* Fill area */}
      <polygon
        points={`${curvePoints[0].split(',')[0]},${H} ${curvePoints.join(' ')} ${curvePoints[curvePoints.length - 1].split(',')[0]},${H}`}
        fill="url(#tideFill)"
      />

      {/* Curve line */}
      <polyline
        points={curvePoints.join(' ')}
        fill="none"
        stroke="#22d3ee"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* High/low markers */}
      {hourSpan > 0 && parsed.map((p, i) => {
        const t = (p.hour - firstHour) / hourSpan;
        const x = PAD + t * (W - 2 * PAD);
        const y = H - PAD - ((p.height - minH) / range) * (H - 2 * PAD);
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r="2.5"
            fill={p.type === 'high' ? '#22d3ee' : '#3b82f6'}
            stroke="#0f172a"
            strokeWidth="1"
          />
        );
      })}

      {/* Current time marker */}
      {nowX !== null && nowY !== null && (
        <>
          <line x1={nowX} y1={0} x2={nowX} y2={H} stroke="#f59e0b" strokeWidth="0.5" strokeDasharray="2,2" opacity="0.5" />
          <circle cx={nowX} cy={nowY} r="3" fill="#f59e0b" stroke="#0f172a" strokeWidth="1" />
        </>
      )}
    </svg>
  );
}
