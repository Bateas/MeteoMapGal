/**
 * The wind chart of the cards. Every one uses this piece and this scale, so the same height means the same wind on
 * a spot and on a station: a line at the top of a chart can be 10 kt or 40, and the scale says which.
 *
 * Pointer, finger or arrow keys read a value out. It never holds what the chart cannot say without it: the line and
 * the scale are all there, and the reading only names one point.
 */
import { useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { windScale, type AxisPoint } from './windAxis';

const W = 320;
const H = 72;
const TOP = 6;
const BASE = H - 4;

export interface PlotSeries {
  points: AxisPoint[];
  /** main: the figure; thin: what goes with it, such as the gust; dotted: a model */
  kind: 'main' | 'thin' | 'dotted';
  /** Past this between two points the line breaks: joining them would draw a wind nobody measured or forecast */
  gapMs: number;
}

/** A point that can be read: the value first, then what and when. */
export interface PlotStop {
  t: number;
  kt: number;
  value: string;
  note: string;
}

const STROKE: Record<PlotSeries['kind'], { stroke: string; width: number; dash?: string }> = {
  main: { stroke: 'currentColor', width: 2.25 },
  thin: { stroke: 'var(--g-muted)', width: 1.25 },
  dotted: { stroke: 'currentColor', width: 2, dash: '0.1 5' },
};

function pathOf(points: AxisPoint[], gapMs: number, x: (t: number) => number, y: (kt: number) => number): string {
  let d = '';
  let last: number | null = null;
  for (const p of points) {
    d += `${last === null || p.t - last > gapMs ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.kt).toFixed(1)} `;
    last = p.t;
  }
  return d.trim();
}

export function WindPlot({ from, to, series, stops, mark, label, foot }: {
  from: number;
  to: number;
  series: PlotSeries[];
  stops: PlotStop[];
  /** The line of «ahora», when it is not the right edge */
  mark?: number;
  /** What the chart says, for whoever does not see it */
  label: string;
  /** Under the chart, lined up with it */
  foot: ReactNode;
}) {
  const [active, setActive] = useState<number | null>(null);

  const { top, ticks } = windScale(Math.max(0, ...series.flatMap((s) => s.points.map((p) => p.kt))));
  const x = (t: number) => ((t - from) / (to - from)) * W;
  const y = (kt: number) => BASE - (Math.min(kt, top) / top) * (BASE - TOP);

  // Pointing at a date, not at a 2 px line: the nearest point answers
  const nearest = (t: number) => stops.reduce((best, s, i) => (Math.abs(s.t - t) < Math.abs(stops[best].t - t) ? i : best), 0);

  const onPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width === 0 || stops.length === 0) return;
    setActive(nearest(from + ((e.clientX - r.left) / r.width) * (to - from)));
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (stops.length === 0) return;
    const start = active ?? nearest(mark ?? to);
    const next: Record<string, number> = {
      ArrowLeft: Math.max(0, start - 1),
      ArrowRight: Math.min(stops.length - 1, start + 1),
      Home: 0,
      End: stops.length - 1,
    };
    if (e.key === 'Escape') {
      if (active !== null) { e.stopPropagation(); setActive(null); }
      return;
    }
    if (e.key in next) {
      e.preventDefault();
      setActive(next[e.key]);
    }
  };

  const stop = active !== null ? stops[active] : null;
  const pct = stop ? (x(stop.t) / W) * 100 : 0;
  const shift = pct < 20 ? '0' : pct > 80 ? '-100%' : '-50%';

  return (
    <div className="gf-plot">
      <div className="gf-plot-y" aria-hidden="true">
        {ticks.map((kt) => (
          <span key={kt} style={{ top: `${(y(kt) / H) * 100}%` }}>{kt === top ? `${kt} kt` : kt}</span>
        ))}
      </div>
      <div
        className="gf-plot-area"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, stops.length - 1)}
        aria-valuenow={active ?? Math.max(0, stops.length - 1)}
        aria-valuetext={stop ? `${stop.value}, ${stop.note}` : label}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') setActive(null); }}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
      >
        <svg className="gf-chart" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          {ticks.map((kt) => <line key={kt} x1="0" x2={W} y1={y(kt)} y2={y(kt)} stroke="var(--g-hair)" />)}
          {mark != null && <line x1={x(mark)} x2={x(mark)} y1={TOP} y2={BASE} stroke="var(--g-rule)" />}
          {series.map((s, i) => {
            const look = STROKE[s.kind];
            return (
              <path
                key={i}
                d={pathOf(s.points, s.gapMs, x, y)}
                fill="none"
                stroke={look.stroke}
                strokeWidth={look.width}
                strokeDasharray={look.dash}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}
          {stop && (
            <>
              <line x1={x(stop.t)} x2={x(stop.t)} y1={TOP} y2={BASE} stroke="var(--g-muted)" />
              <circle cx={x(stop.t)} cy={y(stop.kt)} r="3.5" fill="currentColor" stroke="var(--g-paper)" strokeWidth="2" />
            </>
          )}
        </svg>
        {stop && (
          <div className="gf-plot-tip" style={{ left: `${pct}%`, transform: `translateX(${shift})` }}>
            <b>{stop.value}</b> {stop.note}
          </div>
        )}
      </div>
      <div className="gf-hint gf-chartfoot gf-plot-foot">{foot}</div>
    </div>
  );
}
