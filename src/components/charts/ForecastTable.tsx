/**
 * Windguru-style horizontal forecast table.
 * Hours as columns, weather variables as rows, color-coded cells.
 */

import { useMemo } from 'react';
import type { HourlyForecast } from '../../types/forecast';
import {
  msToKnots,
  degreesToCardinal,
  windSpeedColor,
  temperatureColor,
  precipitationColor,
} from '../../services/windUtils';

interface ForecastTableProps {
  data: HourlyForecast[];
}

function formatHour(d: Date): string {
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDay(d: Date): string {
  return d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' });
}

/** Small inline SVG arrow for wind direction */
function DirArrow({ dir }: { dir: number | null }) {
  if (dir === null) return <span className="text-slate-600">-</span>;
  const rotation = (dir + 180) % 360;
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 16 16"
      className="inline-block"
      style={{ transform: `rotate(${rotation}deg)` }}
    >
      <path d="M8 2 L12 10 L8 8 L4 10 Z" fill="currentColor" />
    </svg>
  );
}

function cloudIcon(cover: number | null): string {
  if (cover === null) return '';
  if (cover < 15) return '\u2600\uFE0F';
  if (cover < 40) return '\uD83C\uDF24\uFE0F';
  if (cover < 70) return '\u26C5';
  if (cover < 90) return '\uD83C\uDF25\uFE0F';
  return '\u2601\uFE0F';
}

export function ForecastTable({ data }: ForecastTableProps) {
  // Detect day boundaries for header grouping
  const dayGroups = useMemo(() => {
    const groups: { label: string; count: number }[] = [];
    let lastDay = '';
    for (const p of data) {
      const day = formatDay(p.time);
      if (day !== lastDay) {
        groups.push({ label: day, count: 1 });
        lastDay = day;
      } else {
        groups[groups.length - 1].count++;
      }
    }
    return groups;
  }, [data]);

  if (data.length === 0) {
    return <div className="text-xs text-slate-500 text-center py-4">Sin datos de previsión</div>;
  }

  const rows: {
    label: string;
    render: (p: HourlyForecast) => React.ReactNode;
  }[] = [
    {
      label: 'Hora',
      render: (p) => (
        <span className="text-slate-300 font-mono">{formatHour(p.time)}</span>
      ),
    },
    {
      label: 'Temp',
      render: (p) => (
        <span style={{ color: temperatureColor(p.temperature) }} className="font-bold">
          {p.temperature !== null ? `${p.temperature.toFixed(0)}°` : '-'}
        </span>
      ),
    },
    {
      label: 'Viento',
      render: (p) => {
        const kt = p.windSpeed !== null ? msToKnots(p.windSpeed) : null;
        return (
          <span style={{ color: windSpeedColor(p.windSpeed) }} className="font-bold">
            {kt !== null ? `${kt.toFixed(0)}` : '-'}
          </span>
        );
      },
    },
    {
      label: 'Dir',
      render: (p) => (
        <span className="text-slate-300 flex items-center justify-center gap-0.5">
          <DirArrow dir={p.windDirection} />
          <span className="text-[8px]">
            {p.windDirection !== null ? degreesToCardinal(p.windDirection) : ''}
          </span>
        </span>
      ),
    },
    {
      label: 'Precip',
      render: (p) => {
        const val = p.precipitation ?? 0;
        return (
          <span style={{ color: val > 0 ? precipitationColor(val) : '#64748b' }}>
            {val > 0 ? val.toFixed(1) : '-'}
          </span>
        );
      },
    },
    {
      label: 'Prob%',
      render: (p) => {
        const prob = p.precipProbability ?? 0;
        return (
          <span
            className="font-semibold"
            style={{ color: prob > 60 ? '#3b82f6' : prob > 30 ? '#64748b' : '#475569' }}
          >
            {prob > 0 ? `${prob}` : '-'}
          </span>
        );
      },
    },
    {
      label: 'Nubes',
      render: (p) => (
        <span className="text-[10px]">{cloudIcon(p.cloudCover)}</span>
      ),
    },
    {
      label: 'hPa',
      render: (p) => (
        <span className="text-slate-500">
          {p.pressure !== null ? `${p.pressure.toFixed(0)}` : '-'}
        </span>
      ),
    },
  ];

  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="text-[10px] border-collapse min-w-max">
        {/* Day header */}
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-slate-900 px-2 py-1 text-left text-slate-600 font-normal" />
            {dayGroups.map((g, i) => (
              <th
                key={i}
                colSpan={g.count}
                className="px-0 py-1 text-center text-[9px] font-semibold text-slate-400 border-b border-slate-700"
              >
                {g.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="hover:bg-slate-800/50">
              <td className="sticky left-0 z-10 bg-slate-900 px-2 py-1 text-slate-500 font-semibold whitespace-nowrap border-r border-slate-800">
                {row.label}
              </td>
              {data.map((p, i) => (
                <td
                  key={i}
                  className="px-1.5 py-1 text-center whitespace-nowrap"
                  style={{
                    borderLeft: p.time.getHours() === 0 ? '1px solid #334155' : undefined,
                  }}
                >
                  {row.render(p)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
