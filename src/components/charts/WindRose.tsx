/**
 * Reusable Wind Rose component using Recharts RadarChart.
 * Shows wind direction frequency distribution.
 * Supports speed-weighted mode when avgSpeed data is available.
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
  /** Show speed-weighted overlay when avgSpeed data is available */
  showSpeedWeight?: boolean;
}

export function WindRose({ data, title, stationName, size = 220, showLabels = true, showSpeedWeight = false }: WindRoseProps) {
  if (data.length === 0) {
    return (
      <div className="text-[10px] text-slate-500 text-center py-4">
        Sin datos de viento
      </div>
    );
  }

  const maxPct = Math.max(...data.map((d) => d.percentage));
  const hasSpeedData = data.some((d) => d.avgSpeed !== undefined && d.avgSpeed > 0);
  const showSpeed = showSpeedWeight && hasSpeedData;

  // For speed-weighted mode, compute a "speed score" = percentage * avgSpeed
  const speedWeightedData = showSpeed
    ? data.map((d) => ({
        ...d,
        speedScore: Math.round(d.percentage * (d.avgSpeed ?? 0) * 10) / 10,
      }))
    : data;

  const maxSpeedScore = showSpeed
    ? Math.max(...speedWeightedData.map((d) => (d as { speedScore: number }).speedScore || 0))
    : 0;

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
          <RadarChart data={speedWeightedData}>
            <PolarGrid stroke="#334155" />
            <PolarAngleAxis
              dataKey="direction"
              tick={{ fill: '#94a3b8', fontSize: 9 }}
            />
            {showLabels && (
              <PolarRadiusAxis
                tick={{ fill: '#64748b', fontSize: 8 }}
                tickCount={4}
                domain={[0, showSpeed ? Math.ceil(maxSpeedScore / 5) * 5 : Math.ceil(maxPct / 5) * 5]}
              />
            )}
            {/* Base frequency radar */}
            <Radar
              name="Frecuencia"
              dataKey="percentage"
              stroke="#f59e0b"
              fill="#f59e0b"
              fillOpacity={showSpeed ? 0.1 : 0.25}
              strokeWidth={showSpeed ? 1 : 2}
              isAnimationActive={false}
            />
            {/* Speed-weighted overlay */}
            {showSpeed && (
              <Radar
                name="Vel\u00B7Frec"
                dataKey="speedScore"
                stroke="#ef4444"
                fill="#ef4444"
                fillOpacity={0.2}
                strokeWidth={2}
                isAnimationActive={false}
              />
            )}
            <Tooltip
              contentStyle={{
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: 6,
                fontSize: 10,
              }}
              formatter={((value: number, name: string) => {
                if (name === 'Vel\u00B7Frec') return [`${value.toFixed(1)}`, 'Vel\u00D7Frec'];
                return [`${value.toFixed(1)}%`, 'Frecuencia'];
              }) as never}
            />
          </RadarChart>
        </ResponsiveContainer>
        {showSpeed && (
          <div className="flex items-center justify-center gap-3 text-[8px] text-slate-500 mt-1">
            <span className="flex items-center gap-1">
              <span className="w-2 h-0.5 bg-amber-500 inline-block rounded" /> Frecuencia
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-0.5 bg-red-500 inline-block rounded" /> Vel\u00B7Frec
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
