/**
 * Rain, wind and temperature hour by hour for the next days: three small charts that share the hours,
 * one column per day, the same scale across days so the days compare at a glance. Plain SVG.
 * Move over it, or touch it, to read one hour.
 */
import { memo, useRef, useState, type PointerEvent } from 'react';
import {
  dayKey, fmtMm, localHour, rainLevel, windTone, DRY_MM, MORNING_FROM_H, MORNING_TO_H, STRIP_FROM_H,
  type DaySummary, type PointHour,
} from '../../services/pointForecast';

const W = 360;
const H = 206;
const GUTTER = 40;
const GAP = 8;
/** Room for the last hour's label, centred on its bar. */
const RIGHT = 8;
const RAIN = { top: 30, h: 38 };
const WIND = { top: 88, h: 30 };
const ARROW_Y = 128;
const TEMP = { top: 150, h: 24 };
const GRID_BOTTOM = 188;
const AXIS_Y = 202;
const TICKS = [8, 12, 16, 20];
const ROWS = [
  { name: 'Lluvia', unit: 'mm', top: RAIN.top },
  { name: 'Viento', unit: 'kt', top: WIND.top },
  { name: 'Temp.', unit: '°C', top: TEMP.top },
];

/** The tip drawn to the north; rotated by from + 180 it points where the wind goes. */
const ARROW = 'M0 -5 L3.2 1 L1 1 L1 5 L-1 5 L-1 1 L-3.2 1 Z';

function readout(day: DaySummary, h: PointHour): string {
  const parts = [h.rainMm === null ? 'sin dato de lluvia' : h.rainMm < DRY_MM ? 'seco' : `${fmtMm(h.rainMm)} mm`];
  if (h.kt !== null) parts.push(`${h.dir} ${Math.round(h.kt)} kt`.trim());
  if (h.temp !== null) parts.push(`${Math.round(h.temp)} °C`);
  return `${day.label}, ${h.hour} h: ${parts.join(' · ')}`;
}

function peakIndex(values: (number | null)[]): number {
  return values.reduce<number>((best, v, i) => ((v ?? -Infinity) > (values[best] ?? -Infinity) ? i : best), 0);
}

export const PointMeteogram = memo(function PointMeteogram({ days, now }: { days: DaySummary[]; now?: Date }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [at, setAt] = useState<{ d: number; i: number } | null>(null);
  if (days.length === 0) return null;

  const cells = days[0].hours.length;
  const colW = (W - GUTTER - RIGHT - GAP * (days.length - 1)) / days.length;
  const cellW = colW / cells;
  const colX = (d: number) => GUTTER + d * (colW + GAP);
  const cellX = (d: number, i: number) => colX(d) + i * cellW;
  const clampLabel = (x: number, d: number) => Math.min(colX(d) + colW - 9, Math.max(colX(d) + 9, x));

  // The clock, in today's column. A bar is centred on its hour, as the axis labels are.
  const todayCol = now ? days.findIndex((d) => d.dayKey === dayKey(now)) : -1;
  const clockH = now ? localHour(now) + now.getUTCMinutes() / 60 : 0;
  const nowX = todayCol >= 0 && clockH >= STRIP_FROM_H - 0.5 && clockH <= STRIP_FROM_H + cells - 0.5
    ? cellX(todayCol, 0) + cellW / 2 + (clockH - STRIP_FROM_H) * cellW
    : null;

  const all = days.flatMap((d) => d.hours);
  const maxRain = Math.max(4, ...all.map((h) => h.rainMm ?? 0));
  const maxKt = Math.max(20, ...all.map((h) => h.kt ?? 0));
  const temps = all.flatMap((h) => (h.temp === null ? [] : [h.temp]));
  const tLo = temps.length ? Math.floor(Math.min(...temps)) : 0;
  const tHi = temps.length ? Math.max(Math.ceil(Math.max(...temps)), tLo + 4) : 4;
  const tempY = (t: number) => TEMP.top + TEMP.h - ((t - tLo) / (tHi - tLo)) * TEMP.h;

  const tempPath = (day: DaySummary, d: number) => {
    let path = '';
    let pen = false;
    day.hours.forEach((h, i) => {
      if (h.temp === null) { pen = false; return; }
      path += `${pen ? 'L' : 'M'}${(cellX(d, i) + cellW / 2).toFixed(1)} ${tempY(h.temp).toFixed(1)}`;
      pen = true;
    });
    return path;
  };

  const onPointer = (e: PointerEvent<SVGSVGElement>) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const x = ((e.clientX - box.left) / box.width) * W - GUTTER;
    if (x < 0) { setAt(null); return; }
    const d = Math.min(days.length - 1, Math.floor(x / (colW + GAP)));
    const i = Math.min(cells - 1, Math.max(0, Math.floor((x - d * (colW + GAP)) / cellW)));
    setAt({ d, i });
  };

  return (
    <div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="gfp-chart"
        role="img"
        aria-label={`Lluvia, viento y temperatura por horas, de 7 a 20 h, en ${days.length} días${nowX === null ? '' : '. La línea vertical marca la hora actual'}`}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') setAt(null); }}
      >
        {ROWS.map((r) => (
          <g key={r.name}>
            <text className="gfp-rowname" x={0} y={r.top + 10}>{r.name}</text>
            <text className="gfp-unit" x={0} y={r.top + 23}>{r.unit}</text>
          </g>
        ))}

        {days.map((day, d) => {
          const rainPeak = peakIndex(day.hours.map((h) => h.rainMm));
          const windPeak = peakIndex(day.hours.map((h) => h.kt));
          const peakMm = day.hours[rainPeak].rainMm ?? 0;
          const peakKt = day.hours[windPeak].kt;
          const warmest = peakIndex(day.hours.map((h) => h.temp));
          const coldest = peakIndex(day.hours.map((h) => (h.temp === null ? null : -h.temp)));
          const tMax = day.hours[warmest].temp;
          const tMin = day.hours[coldest].temp;
          const showTemps = tMax !== null && tMin !== null && Math.round(tMax) !== Math.round(tMin);
          return (
            <g key={day.dayKey}>
              <text className="gfp-day" x={colX(d)} y={11}>{day.label}</text>
              <rect
                className="gfp-am"
                x={cellX(d, MORNING_FROM_H - STRIP_FROM_H)}
                y={RAIN.top}
                width={cellW * (MORNING_TO_H - MORNING_FROM_H + 1)}
                height={GRID_BOTTOM - RAIN.top}
              />
              {TICKS.map((t) => {
                const x = cellX(d, t - STRIP_FROM_H) + cellW / 2;
                return <line key={t} className="gfp-grid" x1={x} x2={x} y1={RAIN.top - 2} y2={GRID_BOTTOM} />;
              })}
              <line className="gfp-base" x1={colX(d)} x2={colX(d) + colW} y1={RAIN.top + RAIN.h} y2={RAIN.top + RAIN.h} />
              <line className="gfp-base" x1={colX(d)} x2={colX(d) + colW} y1={WIND.top + WIND.h} y2={WIND.top + WIND.h} />

              {day.hours.map((h, i) => {
                const rain = h.rainMm ?? 0;
                const rainH = rain < DRY_MM ? 0 : Math.max(2, (rain / maxRain) * RAIN.h);
                const windH = h.kt === null ? 0 : Math.max(1, (h.kt / maxKt) * WIND.h);
                return (
                  <g key={h.hour}>
                    {rainH > 0 && (
                      <rect className="gfp-r" data-r={rainLevel(h.rainMm)} x={cellX(d, i) + 0.5} width={cellW - 1} y={RAIN.top + RAIN.h - rainH} height={rainH} rx={1} />
                    )}
                    {windH > 0 && (
                      <rect className="gfp-w" data-w={windTone(h.kt)} x={cellX(d, i) + 0.5} width={cellW - 1} y={WIND.top + WIND.h - windH} height={windH} rx={1} />
                    )}
                  </g>
                );
              })}

              {peakMm >= 2 && (
                <text className="gfp-peak" textAnchor="middle" x={clampLabel(cellX(d, rainPeak) + cellW / 2, d)} y={RAIN.top + RAIN.h - Math.max(2, (peakMm / maxRain) * RAIN.h) - 2}>
                  {fmtMm(peakMm)}
                </text>
              )}
              {peakKt !== null && (
                <text className="gfp-peak" textAnchor="middle" x={clampLabel(cellX(d, windPeak) + cellW / 2, d)} y={WIND.top + WIND.h - Math.max(1, (peakKt / maxKt) * WIND.h) - 2}>
                  {Math.round(peakKt)}
                </text>
              )}

              {TICKS.map((t) => {
                const i = t - STRIP_FROM_H;
                const h = day.hours[i];
                const x = cellX(d, i) + cellW / 2;
                return (
                  <g key={t}>
                    {h?.dirDeg != null && (
                      <path className="gfp-arrow" d={ARROW} transform={`translate(${x.toFixed(1)} ${ARROW_Y}) rotate(${(h.dirDeg + 180) % 360})`} />
                    )}
                    <text className="gfp-tick" textAnchor="middle" x={x} y={AXIS_Y}>{t}</text>
                  </g>
                );
              })}

              <path className="gfp-temp" d={tempPath(day, d)} />
              {showTemps && (
                <>
                  <text className="gfp-peak" textAnchor="middle" x={clampLabel(cellX(d, warmest) + cellW / 2, d)} y={tempY(tMax) - 4}>{Math.round(tMax)}°</text>
                  <text className="gfp-peak" textAnchor="middle" x={clampLabel(cellX(d, coldest) + cellW / 2, d)} y={tempY(tMin) + 13}>{Math.round(tMin)}°</text>
                </>
              )}
            </g>
          );
        })}

        {nowX !== null && (
          <g>
            {/* Beside the day's name, the one row no peak label ever reaches. */}
            <text className="gfp-nowtext" textAnchor="middle" x={Math.min(colX(todayCol) + colW - 16, Math.max(colX(todayCol) + 64, nowX))} y={11}>ahora</text>
            <path className="gfp-nowmark" d={`M${(nowX - 4).toFixed(1)} ${RAIN.top - 8} L${(nowX + 4).toFixed(1)} ${RAIN.top - 8} L${nowX.toFixed(1)} ${RAIN.top - 2} Z`} />
            <line className="gfp-nowline" x1={nowX} x2={nowX} y1={RAIN.top - 2} y2={GRID_BOTTOM} />
          </g>
        )}

        {at && (
          <line
            className="gfp-cursor"
            x1={cellX(at.d, at.i) + cellW / 2}
            x2={cellX(at.d, at.i) + cellW / 2}
            y1={RAIN.top - 4}
            y2={TEMP.top + TEMP.h}
          />
        )}
      </svg>
      <div className="gfp-readout">
        {at ? readout(days[at.d], days[at.d].hours[at.i]) : 'Pasa el dedo por la gráfica para ver cada hora'}
      </div>
    </div>
  );
});
