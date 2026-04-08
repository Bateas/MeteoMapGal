/**
 * ForecastTable — Windguru-style horizontal forecast table.
 *
 * Features:
 * - Color-coded cell backgrounds (wind, temp, humidity) for instant readability
 * - Sailing quality rating row (stars) highlighting best hours
 * - Night columns dimmed
 * - Expanded mode: bigger cells, more padding
 * - Accessible: role="region", aria-labels
 */

import { useMemo } from 'react';
import { useThermalStore } from '../../store/thermalStore';
import { useSectorStore } from '../../store/sectorStore';
import { scoreForecastThermal, thermalColor, thermalBg } from '../../services/forecastScoringUtils';
import type { HourlyForecast } from '../../types/forecast';
import { WeatherIcon, type IconId } from '../icons/WeatherIcons';
import { useThemeStore } from '../../store/themeStore';
import {
  msToKnots,
  degreesToCardinal,
  windSpeedColor,
  temperatureColor,
  precipitationColor,
} from '../../services/windUtils';

interface ForecastTableProps {
  data: HourlyForecast[];
  expanded?: boolean;
}

function formatHour(d: Date): string {
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function shortHour(d: Date): string {
  return d.getHours().toString().padStart(2, '0');
}

function formatDay(d: Date): string {
  const isToday = d.toDateString() === new Date().toDateString();
  if (isToday) return 'Hoy';
  return d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' });
}

/** Small inline SVG arrow for wind direction */
function DirArrow({ dir, size = 12 }: { dir: number | null; size?: number }) {
  if (dir === null) return <span className="text-slate-600">-</span>;
  const rotation = (dir + 180) % 360;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className="inline-block"
      style={{ transform: `rotate(${rotation}deg)` }}
    >
      <path d="M8 2 L12 10 L8 8 L4 10 Z" fill="currentColor" />
    </svg>
  );
}

/** Map sky_state to icon, fallback to cloudCover */
function skyIcon(skyState: string | null | undefined, cloudCover: number | null): IconId | null {
  if (skyState) {
    switch (skyState) {
      case 'SUNNY': case 'CLEAR': return 'sun';
      case 'CLEAR_NIGHT': return 'moon';
      case 'HIGH_CLOUDS': case 'MID_CLOUDS': case 'PARTLY_CLOUDY': return 'cloud-sun';
      case 'OVERCAST': case 'CLOUDY': case 'NIGHT_CLOUDS': case 'NIGHT_CLOUDY': return 'cloud';
      case 'DRIZZLE': case 'WEAK_RAIN': case 'RAIN': case 'SHOWERS':
      case 'WEAK_SHOWERS': case 'OVERCAST_AND_SHOWERS':
      case 'NIGHT_RAIN': case 'NIGHT_SHOWERS': return 'cloud-rain';
      case 'SNOW': case 'INTERMITENT_SNOW': case 'MELTED_SNOW': return 'snowflake';
      case 'STORMS': case 'STORM_THEN_CLOUDY': case 'NIGHT_STORMS': case 'RAIN_HAIL': return 'zap';
      case 'FOG': case 'FOG_BANK': case 'MIST': return 'fog';
    }
  }
  if (cloudCover === null) return null;
  if (cloudCover < 15) return 'sun';
  if (cloudCover < 40) return 'cloud-sun';
  if (cloudCover < 70) return 'cloud-sun';
  if (cloudCover < 90) return 'cloud';
  return 'cloud';
}

// ── Background color helpers (low-opacity fills for cells) ──────
// Light mode needs ~2x opacity because bg is white not dark

/** Wind speed → background fill (Windguru style) */
function windBg(speedMs: number | null, light: boolean): string {
  if (speedMs === null) return 'transparent';
  const kt = msToKnots(speedMs);
  const m = light ? 1.8 : 1; // multiplier for light mode
  if (kt >= 20) return `rgba(239,68,68,${(0.2 * m).toFixed(2)})`;
  if (kt >= 15) return `rgba(249,115,22,${(0.18 * m).toFixed(2)})`;
  if (kt >= 10) return `rgba(34,197,94,${(0.18 * m).toFixed(2)})`;
  if (kt >= 6)  return `rgba(34,197,94,${(0.12 * m).toFixed(2)})`;
  if (kt >= 3)  return `rgba(59,130,246,${(0.1 * m).toFixed(2)})`;
  return 'transparent';
}

/** Temperature → background fill */
function tempBg(temp: number | null, light: boolean): string {
  if (temp === null) return 'transparent';
  const m = light ? 1.8 : 1;
  if (temp >= 35) return `rgba(239,68,68,${(0.2 * m).toFixed(2)})`;
  if (temp >= 30) return `rgba(249,115,22,${(0.15 * m).toFixed(2)})`;
  if (temp >= 25) return `rgba(250,204,21,${(0.12 * m).toFixed(2)})`;
  if (temp >= 18) return `rgba(34,197,94,${(0.1 * m).toFixed(2)})`;
  if (temp >= 10) return `rgba(59,130,246,${(0.08 * m).toFixed(2)})`;
  if (temp >= 5)  return `rgba(59,130,246,${(0.15 * m).toFixed(2)})`;
  return `rgba(96,165,250,${(0.2 * m).toFixed(2)})`;
}

/** Humidity → background fill */
function humidityBg(hr: number | null, light: boolean): string {
  if (hr === null) return 'transparent';
  const m = light ? 1.8 : 1;
  if (hr <= 45) return `rgba(245,158,11,${(0.18 * m).toFixed(2)})`;
  if (hr <= 55) return `rgba(245,158,11,${(0.1 * m).toFixed(2)})`;
  if (hr >= 85) return `rgba(59,130,246,${(0.18 * m).toFixed(2)})`;
  if (hr >= 75) return `rgba(59,130,246,${(0.1 * m).toFixed(2)})`;
  return 'transparent';
}

// ── Sailing quality rating (0-5 stars) ──────────────────────────

function rateSailingQuality(p: HourlyForecast): number {
  if (!p.isDay) return 0; // night = no rating
  const kt = p.windSpeed !== null ? msToKnots(p.windSpeed) : 0;
  const rain = p.precipitation ?? 0;
  const prob = p.precipProbability ?? 0;

  let stars = 0;

  // Wind quality (0-3)
  if (kt >= 8 && kt <= 18) stars += 3;        // ideal
  else if (kt >= 6 && kt <= 22) stars += 2;   // good
  else if (kt >= 4 && kt <= 25) stars += 1;   // marginal
  // else 0

  // No rain (+1)
  if (rain < 0.3 && prob < 40) stars += 1;

  // Not too gusty (+1)
  const gustKt = p.windGusts !== null ? msToKnots(p.windGusts) : 0;
  const gustRatio = kt > 0 ? gustKt / kt : 0;
  if (gustRatio < 1.8) stars += 1;

  return Math.min(5, stars);
}

function StarRating({ stars }: { stars: number }) {
  if (stars === 0) return <span className="text-slate-700/50">-</span>;
  // Use filled circles for compactness
  const color = stars >= 4 ? '#22c55e' : stars >= 3 ? '#facc15' : stars >= 2 ? '#94a3b8' : '#475569';
  return (
    <span className="flex items-center justify-center gap-px" title={`${stars}/5 calidad`}>
      {Array.from({ length: stars }, (_, i) => (
        <span key={i} className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: color }} />
      ))}
    </span>
  );
}

// ── Main component ──────────────────────────────────────────────

export function ForecastTable({ data, expanded = false }: ForecastTableProps) {
  const rules = useThermalStore((s) => s.rules);
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const isEmbalse = sectorId === 'embalse';
  const isLight = useThemeStore((s) => s.theme) === 'light';

  // Detect day boundaries for header grouping
  const dayGroups = useMemo(() => {
    const groups: { label: string; count: number; isToday: boolean }[] = [];
    let lastDay = '';
    for (const p of data) {
      const day = p.time.toDateString();
      if (day !== lastDay) {
        groups.push({ label: formatDay(p.time), count: 1, isToday: day === new Date().toDateString() });
        lastDay = day;
      } else {
        groups[groups.length - 1].count++;
      }
    }
    return groups;
  }, [data]);

  // Compute thermal scores
  const thermalScores = useMemo(() => {
    if (rules.length === 0) return data.map(() => ({ score: 0, mainRule: null, isNavigable: false, isPrecursor: false }));
    const temps = data.map((p) => p.temperature).filter((t): t is number => t !== null);
    const deltaT = temps.length >= 2 ? Math.max(...temps) - Math.min(...temps) : null;
    return data.map((p) => scoreForecastThermal(p, rules, deltaT));
  }, [data, rules]);

  // Sailing quality ratings
  const ratings = useMemo(() => data.map(rateSailingQuality), [data]);

  // Best hour index (highest rating)
  const bestIdx = useMemo(() => {
    let best = -1, bestVal = 0;
    for (let i = 0; i < ratings.length; i++) {
      if (ratings[i] > bestVal && data[i].time.getTime() > Date.now()) {
        bestVal = ratings[i];
        best = i;
      }
    }
    return best;
  }, [ratings, data]);

  // Good hours (rating >= 3, future, daytime) — for green stripe
  const goodHours = useMemo(() => {
    const set = new Set<number>();
    for (let i = 0; i < ratings.length; i++) {
      if (ratings[i] >= 3 && data[i].time.getTime() > Date.now()) set.add(i);
    }
    return set;
  }, [ratings, data]);

  // "Now" column index
  const nowIdx = useMemo(() => {
    const now = Date.now();
    let closest = -1, minD = Infinity;
    for (let i = 0; i < data.length; i++) {
      const d = Math.abs(data[i].time.getTime() - now);
      if (d < minD) { minD = d; closest = i; }
    }
    return closest;
  }, [data]);

  if (data.length === 0) {
    return <div className="text-xs text-slate-400 text-center py-4">Sin datos de prevision</div>;
  }

  const hasThermal = isEmbalse && thermalScores.some(ts => ts.score >= 35);
  const sz = expanded ? 'text-xs' : 'text-[11px]';
  const pad = expanded ? 'px-2 py-1.5' : 'px-1.5 py-1';
  const labelPad = expanded ? 'px-3 py-1.5' : 'px-2 py-1';
  const arrowSize = expanded ? 14 : 12;

  // Row definitions with backgrounds
  type RowDef = {
    label: string;
    icon?: IconId;
    bg?: (p: HourlyForecast, i: number) => string;
    render: (p: HourlyForecast, i: number) => React.ReactNode;
  };

  const rows: RowDef[] = [
    // Quality rating (top row — most important)
    {
      label: 'Calidad',
      icon: 'sailboat',
      render: (p, i) => <StarRating stars={ratings[i]} />,
    },
    // Sky/weather
    {
      label: 'Cielo',
      icon: 'cloud-sun',
      render: (p) => {
        const icon = skyIcon(p.skyState, p.cloudCover);
        return icon ? (
          <span title={p.skyState || `${p.cloudCover ?? '?'}%`}>
            <WeatherIcon id={icon} size={expanded ? 14 : 12} />
          </span>
        ) : <span className="text-slate-700">-</span>;
      },
    },
    // Wind speed (with background)
    {
      label: 'Viento',
      icon: 'wind',
      bg: (p) => windBg(p.windSpeed, isLight),
      render: (p) => {
        const kt = p.windSpeed !== null ? msToKnots(p.windSpeed) : null;
        return (
          <span style={{ color: windSpeedColor(p.windSpeed) }} className="font-bold">
            {kt !== null ? `${kt.toFixed(0)}` : '-'}
          </span>
        );
      },
    },
    // Gusts
    {
      label: 'Rachas',
      bg: (p) => windBg(p.windGusts, isLight),
      render: (p) => {
        const gustKt = p.windGusts !== null ? msToKnots(p.windGusts) : null;
        return (
          <span
            style={{ color: p.windGusts !== null ? windSpeedColor(p.windGusts) : '#475569' }}
            className="font-bold"
          >
            {gustKt !== null ? `${gustKt.toFixed(0)}` : '-'}
          </span>
        );
      },
    },
    // Direction
    {
      label: 'Dir',
      render: (p) => (
        <span className="text-slate-300 flex items-center justify-center gap-0.5">
          <DirArrow dir={p.windDirection} size={arrowSize} />
          <span className={expanded ? 'text-[11px]' : 'text-[10px]'}>
            {p.windDirection !== null ? degreesToCardinal(p.windDirection) : ''}
          </span>
        </span>
      ),
    },
    // Temperature (with background)
    {
      label: 'Temp',
      icon: 'thermometer',
      bg: (p) => tempBg(p.temperature, isLight),
      render: (p) => (
        <span style={{ color: temperatureColor(p.temperature) }} className="font-bold">
          {p.temperature !== null ? `${p.temperature.toFixed(0)}°` : '-'}
        </span>
      ),
    },
    // Precipitation
    {
      label: 'Precip',
      icon: 'droplets',
      render: (p) => {
        const val = p.precipitation ?? 0;
        return (
          <span style={{ color: val > 0 ? precipitationColor(val) : '#64748b' }}>
            {val > 0 ? val.toFixed(1) : '-'}
          </span>
        );
      },
    },
    // Humidity (with background)
    {
      label: 'HR%',
      bg: (p) => humidityBg(p.humidity, isLight),
      render: (p) => (
        <span className={p.humidity !== null && p.humidity <= 55 ? 'text-amber-400 font-semibold' : p.humidity !== null && p.humidity > 75 ? 'text-sky-400' : 'text-slate-400'}>
          {p.humidity !== null ? `${p.humidity.toFixed(0)}` : '-'}
        </span>
      ),
    },
    // Pressure
    {
      label: 'hPa',
      render: (p) => (
        <span className="text-slate-500">
          {p.pressure !== null ? `${p.pressure.toFixed(0)}` : '-'}
        </span>
      ),
    },
  ];

  // Conditionally add thermal row (Embalse only, when there are thermal scores)
  if (hasThermal) {
    rows.splice(1, 0, {
      label: 'Termico',
      icon: 'flame',
      bg: (_, i) => thermalBg(thermalScores[i].score),
      render: (_, i) => {
        const ts = thermalScores[i];
        if (ts.score < 35) return <span className="text-slate-700/50">-</span>;
        return (
          <span
            className="font-bold"
            style={{ color: thermalColor(ts.score) }}
            title={ts.mainRule ? `${ts.mainRule}: ${ts.score}%` : `Score: ${ts.score}%`}
          >
            {ts.score}
          </span>
        );
      },
    });
  }

  return (
    <div className="overflow-x-auto scrollbar-thin" role="region" aria-label="Tabla de prevision meteorologica">
      <table className={`${sz} border-collapse min-w-max`}>
        {/* Day header row */}
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-slate-900 px-2 py-1 text-left text-slate-600 font-normal" />
            {dayGroups.map((g, i) => (
              <th
                key={i}
                colSpan={g.count}
                className={`px-0 py-1.5 text-center font-bold border-b-2 ${
                  g.isToday ? 'text-sky-400 border-sky-500/40' : 'text-slate-400 border-slate-700'
                } ${expanded ? 'text-sm' : 'text-[11px]'}`}
              >
                {g.label}
              </th>
            ))}
          </tr>
          {/* Hour row (compact) */}
          <tr>
            <th className={`sticky left-0 z-10 bg-slate-900 ${labelPad} text-left text-slate-500 font-semibold whitespace-nowrap border-r border-slate-800`}>
              <span className="flex items-center gap-1">
                <WeatherIcon id="clock" size={expanded ? 12 : 10} />
                Hora
              </span>
            </th>
            {data.map((p, i) => {
              const isNow = i === nowIdx;
              const isNight = !p.isDay;
              return (
                <th
                  key={i}
                  className={`${pad} text-center font-mono whitespace-nowrap relative ${
                    isNow ? 'bg-blue-500/20 text-blue-300 font-bold' : isNight ? 'text-slate-600' : 'text-slate-300'
                  } ${i === bestIdx ? 'ring-1 ring-green-500/50 ring-inset rounded' : ''}`}
                  style={{
                    borderLeft: p.time.getHours() === 0 ? '2px solid #334155' : undefined,
                  }}
                >
                  {/* Green top stripe for good sailing hours */}
                  {goodHours.has(i) && (
                    <span
                      className="absolute top-0 left-0 right-0 h-0.5"
                      style={{ background: i === bestIdx ? '#22c55e' : '#22c55e60' }}
                    />
                  )}
                  {expanded ? formatHour(p.time) : shortHour(p.time)}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="hover:bg-slate-800/30 transition-colors">
              <td className={`sticky left-0 z-10 bg-slate-900 ${labelPad} text-slate-500 font-semibold whitespace-nowrap border-r border-slate-800`}>
                <span className="flex items-center gap-1">
                  {row.icon && <WeatherIcon id={row.icon} size={expanded ? 12 : 10} />}
                  {row.label}
                </span>
              </td>
              {data.map((p, i) => {
                const isNow = i === nowIdx;
                const isNight = !p.isDay;
                const isBest = i === bestIdx;
                const bg = row.bg?.(p, i) ?? 'transparent';
                return (
                  <td
                    key={i}
                    className={`${pad} text-center whitespace-nowrap transition-colors ${
                      isNow ? 'border-x border-blue-500/30' : ''
                    } ${isNight ? 'opacity-50' : ''} ${
                      isBest && row.label === 'Calidad' ? 'bg-green-500/10' : ''
                    }`}
                    style={{
                      borderLeft: !isNow && p.time.getHours() === 0 ? '2px solid #334155' : undefined,
                      background: isNow ? `linear-gradient(${bg}, rgba(59,130,246,0.06))` : bg,
                    }}
                  >
                    {row.render(p, i)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
