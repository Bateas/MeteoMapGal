/**
 * Reusable Wind Rose component using Recharts RadarChart.
 * Shows wind direction frequency distribution.
 */

import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip,
} from 'recharts';
import type { WindRosePoint } from '../../types/campo';

interface WindRoseProps {
  data: WindRosePoint[];
  title?: string;
  stationName?: string;
  /** Chart height in pixels */
  size?: number;
  /** Show percentage labels */
  showLabels?: boolean;
}

export function WindRose({ data, title, stationName, size = 220, showLabels = true }: WindRoseProps) {
  if (data.length === 0) {
    return (
      <div className="text-[10px] text-slate-500 text-center py-4">
        Sin datos de viento
      </div>
    );
  }

  const maxPct = Math.max(...data.map((d) => d.percentage));

  return (
    <div>
      {(title || stationName) && (
        <div className="flex items-center justify-between mb-1">
          {title && (
            <div className="text-[9px] text-slate-500">{title}</div>
          )}
          {stationName && (
            <div className="text-[9px] text-amber-400 font-semibold">{stationName}</div>
          )}
        </div>
      )}
      <div className="bg-slate-800/50 rounded-lg p-1">
        <ResponsiveContainer width="100%" height={size}>
          <RadarChart data={data}>
            <PolarGrid stroke="#334155" />
            <PolarAngleAxis
              dataKey="direction"
              tick={{ fill: '#94a3b8', fontSize: 9 }}
            />
            {showLabels && (
              <PolarRadiusAxis
                tick={{ fill: '#64748b', fontSize: 8 }}
                tickCount={4}
                domain={[0, Math.ceil(maxPct / 5) * 5]}
              />
            )}
            <Radar
              name="Frecuencia"
              dataKey="percentage"
              stroke="#f59e0b"
              fill="#f59e0b"
              fillOpacity={0.25}
              strokeWidth={2}
              isAnimationActive={false}
            />
            <Tooltip
              contentStyle={{
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: 6,
                fontSize: 10,
              }}
              formatter={((value: number) => [
                `${value.toFixed(1)}%`,
                'Frecuencia',
              ]) as never}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
