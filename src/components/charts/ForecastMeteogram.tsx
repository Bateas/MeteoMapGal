/**
 * ForecastMeteogram — compact SVG sparkline for the expanded ForecastPanel.
 *
 * Shows wind speed (filled area), temperature (line), and precipitation (bars)
 * in a single compact chart. Pure SVG — no Recharts dependency (avoids 412KB).
 *
 * Inspired by Ventusky's meteogram but focused on sailing-relevant metrics.
 */
import { useMemo, memo } from 'react';
import type { HourlyForecast } from '../../types/forecast';
import { msToKnots, windSpeedColor } from '../../services/windUtils';

interface Props {
  data: HourlyForecast[];
  height?: number;
}

const CHART_H = 90;
const MARGIN = { top: 4, bottom: 16, left: 0, right: 0 };

function ForecastMeteogramInner({ data, height = CHART_H }: Props) {
  const chartData = useMemo(() => {
    if (data.length < 3) return null;

    const winds = data.map(p => p.windSpeed !== null ? msToKnots(p.windSpeed) : 0);
    const temps = data.map(p => p.temperature ?? 0);
    const precips = data.map(p => p.precipitation ?? 0);

    const maxWind = Math.max(...winds, 15); // min scale 15kt
    const minTemp = Math.min(...temps) - 2;
    const maxTemp = Math.max(...temps) + 2;
    const maxPrecip = Math.max(...precips, 1);

    const w = data.length;
    const h = height - MARGIN.top - MARGIN.bottom;

    // Wind area path
    const windPoints = winds.map((kt, i) => {
      const x = (i / (w - 1)) * 100;
      const y = MARGIN.top + h - (kt / maxWind) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const windPath = `M0,${MARGIN.top + h} L${windPoints.join(' L')} L100,${MARGIN.top + h} Z`;

    // Wind line (top of area)
    const windLine = `M${windPoints.join(' L')}`;

    // Temp line
    const tempPoints = temps.map((t, i) => {
      const x = (i / (w - 1)) * 100;
      const y = MARGIN.top + h - ((t - minTemp) / (maxTemp - minTemp)) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const tempLine = `M${tempPoints.join(' L')}`;

    // Precip bars (only where > 0.1mm)
    const precipBars = precips.map((mm, i) => {
      if (mm < 0.1) return null;
      const x = (i / (w - 1)) * 100;
      const barH = (mm / maxPrecip) * (h * 0.4); // max 40% of chart height
      return { x, h: barH, y: MARGIN.top + h - barH };
    }).filter(Boolean) as { x: number; h: number; y: number }[];

    // Now marker (vertical line at current time)
    const now = Date.now();
    let nowX = -1;
    for (let i = 0; i < data.length - 1; i++) {
      if (data[i].time.getTime() <= now && data[i + 1].time.getTime() > now) {
        const frac = (now - data[i].time.getTime()) / (data[i + 1].time.getTime() - data[i].time.getTime());
        nowX = ((i + frac) / (w - 1)) * 100;
        break;
      }
    }

    // Day boundaries with labels
    const dayLines: { x: number; label: string }[] = [];
    const today = new Date();
    const todayStr = today.toDateString();
    const tomorrowStr = new Date(today.getTime() + 86400000).toDateString();
    for (let i = 1; i < data.length; i++) {
      if (data[i].time.getHours() === 0) {
        const dayStr = data[i].time.toDateString();
        const label = dayStr === todayStr ? 'Hoy'
          : dayStr === tomorrowStr ? 'Manana'
          : data[i].time.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' });
        dayLines.push({ x: (i / (w - 1)) * 100, label });
      }
    }

    // Best wind hour annotation
    let bestIdx = -1, bestKt = 0;
    for (let i = 0; i < winds.length; i++) {
      if (winds[i] > bestKt && data[i].time.getTime() > now && data[i].isDay) {
        bestKt = winds[i];
        bestIdx = i;
      }
    }
    const bestX = bestIdx >= 0 ? (bestIdx / (w - 1)) * 100 : -1;
    const bestColor = bestKt > 0 ? windSpeedColor(bestKt / 1.94384) : '#22c55e'; // convert back to m/s

    // Night shading regions
    const nightRegions: { x1: number; x2: number }[] = [];
    let nightStart = -1;
    for (let i = 0; i < data.length; i++) {
      const isNight = !data[i].isDay;
      if (isNight && nightStart < 0) nightStart = i;
      if (!isNight && nightStart >= 0) {
        nightRegions.push({
          x1: (nightStart / (w - 1)) * 100,
          x2: (i / (w - 1)) * 100,
        });
        nightStart = -1;
      }
    }
    if (nightStart >= 0) {
      nightRegions.push({
        x1: (nightStart / (w - 1)) * 100,
        x2: 100,
      });
    }

    return { windPath, windLine, tempLine, precipBars, nowX, dayLines, bestX, bestKt, bestColor, nightRegions, maxWind };
  }, [data, height]);

  if (!chartData) return null;

  return (
    <div className="mb-2 rounded border border-slate-700/50 bg-slate-800/30 overflow-hidden">
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height: `${height}px` }}
        role="img"
        aria-label="Meteograma: viento, temperatura y precipitacion"
      >
        {/* Night shading — darker for clear day/night distinction */}
        {chartData.nightRegions.map((r, i) => (
          <rect
            key={`night-${i}`}
            x={`${r.x1}%`}
            y={0}
            width={`${r.x2 - r.x1}%`}
            height={height}
            fill="rgba(15,23,42,0.45)"
          />
        ))}

        {/* Day boundary lines — solid, visible */}
        {chartData.dayLines.map((d, i) => (
          <g key={`day-${i}`}>
            <line
              x1={`${d.x}%`} y1={0}
              x2={`${d.x}%`} y2={height}
              stroke="#475569"
              strokeWidth="0.5"
            />
            <text
              x={`${d.x + 1}%`}
              y={MARGIN.top + 6}
              fontSize="4"
              fill="#94a3b8"
              fontWeight="bold"
            >
              {d.label}
            </text>
          </g>
        ))}

        {/* Precip bars */}
        {chartData.precipBars.map((bar, i) => (
          <rect
            key={`rain-${i}`}
            x={`${bar.x - 0.3}%`}
            y={bar.y}
            width="0.8%"
            height={bar.h}
            fill="rgba(56,189,248,0.5)"
            rx="0.2"
          />
        ))}

        {/* Wind filled area */}
        <path
          d={chartData.windPath}
          fill="rgba(59,130,246,0.15)"
          vectorEffect="non-scaling-stroke"
        />

        {/* Wind line */}
        <path
          d={chartData.windLine}
          fill="none"
          stroke="#3b82f6"
          strokeWidth="0.5"
          vectorEffect="non-scaling-stroke"
        />

        {/* Temp line */}
        <path
          d={chartData.tempLine}
          fill="none"
          stroke="#f59e0b"
          strokeWidth="0.4"
          strokeDasharray="1.5,0.8"
          vectorEffect="non-scaling-stroke"
          opacity="0.7"
        />

        {/* Now marker — bright red, clearly visible */}
        {chartData.nowX >= 0 && (
          <g>
            <line
              x1={`${chartData.nowX}%`} y1={0}
              x2={`${chartData.nowX}%`} y2={height}
              stroke="#ef4444"
              strokeWidth="0.8"
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={`${chartData.nowX + 0.5}%`}
              y={height - MARGIN.bottom + 4}
              fontSize="3.5"
              fill="#ef4444"
              fontWeight="bold"
            >
              Ahora
            </text>
          </g>
        )}

        {/* Best hour marker */}
        {chartData.bestX >= 0 && (
          <circle
            cx={`${chartData.bestX}%`}
            cy={MARGIN.top + (height - MARGIN.top - MARGIN.bottom) - (chartData.bestKt / chartData.maxWind) * (height - MARGIN.top - MARGIN.bottom)}
            r="1.2"
            fill={chartData.bestColor}
            stroke="white"
            strokeWidth="0.3"
          />
        )}
      </svg>

      {/* Labels */}
      <div className="flex items-center justify-between px-2 py-0.5 text-[9px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 bg-blue-500 inline-block rounded" /> Viento (kt)
          <span className="w-3 h-0.5 bg-amber-500 inline-block rounded opacity-70" style={{ borderTop: '1px dashed' }} /> Temp
          <span className="w-2 h-2 bg-sky-400/50 inline-block rounded-sm" /> Lluvia
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-0.5 bg-red-500 inline-block" /> Ahora
        </span>
      </div>
    </div>
  );
}

export const ForecastMeteogram = memo(ForecastMeteogramInner);
