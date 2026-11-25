/**
 * The chart of the Historial tab, in ink like the small ones of the cards (WindLastHours): one line, a thin
 * one for the gust, and the line breaks where there is no data instead of drawing what nobody measured.
 * The second station of a comparison goes dashed and in the muted tone: shape, not only colour.
 * It is a slider too: the arrows walk the readings one by one and the screen reader hears each one
 * (P3 review, 19-nov: it could only be read with a pointer).
 */
import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { formatValue, nearestPoint, type HistoryMetric, type SeriesPoint } from '../../services/historySeries';

const W = 320;
const H = 150;
/** Room for the top and bottom figures, written over the plot */
const PAD_TOP = 8;
const PAD_BOTTOM = 8;

interface Props {
  series: readonly SeriesPoint[];
  compare?: readonly SeriesPoint[];
  metric: HistoryMetric;
  fromMs: number;
  toMs: number;
  /** The sentence over the chart: the name of the image for a screen reader */
  label: string;
  /** Text of a time on the axis and under the pointer */
  formatTime: (t: number, withDay: boolean) => string;
}

const figure = (v: number, digits: number) => v.toFixed(digits).replace('.', ',');

function pathOf(series: readonly SeriesPoint[], value: (p: SeriesPoint) => number | undefined, x: (t: number) => number, y: (v: number) => number, gapMs: number) {
  let d = '';
  let last: number | null = null;
  for (const p of series) {
    const v = value(p);
    if (v == null) { last = null; continue; }
    const broken = last === null || p.t - last > gapMs;
    d += `${broken ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(v).toFixed(1)} `;
    last = p.t;
  }
  return d.trim();
}

/** A line stops being one past three times its usual step, and never under 40 minutes. */
function gapFor(series: readonly SeriesPoint[]): number {
  const steps: number[] = [];
  for (let i = 1; i < series.length; i++) steps.push(series[i].t - series[i - 1].t);
  steps.sort((a, b) => a - b);
  const median = steps.length ? steps[Math.floor(steps.length / 2)] : 0;
  return Math.max(40 * 60_000, median * 3);
}

export function HistoryChart({ series, compare = [], metric, fromMs, toMs, label, formatTime }: Props) {
  const titleId = useId();
  const [cursor, setCursor] = useState<number | null>(null);

  const plot = useMemo(() => {
    const values = [...series, ...compare].flatMap((p) => (p.top != null ? [p.v, p.top] : [p.v]));
    if (values.length === 0) return null;
    let low = Math.min(...values);
    let high = Math.max(...values);
    if (high - low < 1e-6) { low -= 1; high += 1; }
    const span = Math.max(toMs - fromMs, 1);
    const x = (t: number) => ((t - fromMs) / span) * W;
    const y = (v: number) => H - PAD_BOTTOM - ((v - low) / (high - low)) * (H - PAD_TOP - PAD_BOTTOM);
    return {
      low, high, x, y,
      main: pathOf(series, (p) => p.v, x, y, gapFor(series)),
      top: series.some((p) => p.top != null) ? pathOf(series, (p) => p.top, x, y, gapFor(series)) : '',
      other: compare.length ? pathOf(compare, (p) => p.v, x, y, gapFor(compare)) : '',
    };
  }, [series, compare, fromMs, toMs]);

  if (!plot) return null;

  const multiDay = toMs - fromMs > 26 * 3_600_000;
  const here = cursor == null ? null : nearestPoint(series, cursor);
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    setCursor(fromMs + ((e.clientX - box.left) / box.width) * (toMs - fromMs));
  };
  const reading = (p: SeriesPoint) =>
    `${formatTime(p.t, true)}: ${formatValue(p.v, metric)}${p.top != null && metric.companion ? `, ${metric.companion.word} ${figure(p.top, metric.digits)}` : ''}`;
  const at = here ? series.indexOf(here) : -1;
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'Escape') {
      // The first Escape only drops the reading; the next one is for whoever holds the panel
      if (cursor !== null) { e.stopPropagation(); setCursor(null); }
      return;
    }
    const last = series.length - 1;
    const start = at >= 0 ? at : last;
    const step = Math.max(1, Math.round(series.length / 10));
    const next: Record<string, number> = {
      ArrowLeft: Math.max(0, start - 1),
      ArrowRight: Math.min(last, start + 1),
      PageDown: Math.max(0, start - step),
      PageUp: Math.min(last, start + step),
      Home: 0,
      End: last,
    };
    if (!(e.key in next) || last < 0) return;
    e.preventDefault();
    setCursor(series[next[e.key]].t);
  };

  return (
    <div className="gc-chartwrap">
      <div className="gc-chartplot">
        <svg
          className="gc-chart"
          viewBox={`0 0 ${W} ${H}`}
          role="slider"
          tabIndex={0}
          aria-labelledby={titleId}
          aria-valuemin={0}
          aria-valuemax={Math.max(0, series.length - 1)}
          aria-valuenow={at >= 0 ? at : Math.max(0, series.length - 1)}
          aria-valuetext={here ? reading(here) : 'Flechas para leer las medidas'}
          onKeyDown={onKey}
          onBlur={() => setCursor(null)}
          onPointerDown={onMove}
          onPointerMove={onMove}
          onPointerLeave={() => setCursor(null)}
        >
          <title id={titleId}>{label}</title>
          <line x1="0" x2={W} y1={plot.y(plot.low)} y2={plot.y(plot.low)} stroke="var(--g-hair)" />
          <line x1="0" x2={W} y1={plot.y(plot.high)} y2={plot.y(plot.high)} stroke="var(--g-hair)" />
          {plot.other && <path d={plot.other} fill="none" stroke="var(--g-muted)" strokeWidth="1.5" strokeDasharray="5 4" />}
          {plot.top && <path d={plot.top} fill="none" stroke="var(--g-muted)" strokeWidth="1.25" />}
          <path d={plot.main} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {here && (
            <>
              <line x1={plot.x(here.t)} x2={plot.x(here.t)} y1="0" y2={H} stroke="var(--g-rule)" strokeWidth="1" />
              <circle cx={plot.x(here.t)} cy={plot.y(here.v)} r="3.5" fill="currentColor" />
            </>
          )}
        </svg>
        <span className="gc-charty gc-charty--top">{figure(plot.high, metric.digits)} {metric.unit}</span>
        <span className="gc-charty gc-charty--bottom">{figure(plot.low, metric.digits)} {metric.unit}</span>
      </div>
      <div className="gc-chartfoot">
        <span>{formatTime(fromMs, multiDay)}</span>
        <span>{formatTime((fromMs + toMs) / 2, multiDay)}</span>
        <span>{formatTime(toMs, multiDay)}</span>
      </div>
      {/* Its room is kept, so the page does not jump under the pointer */}
      <p className="gc-chartread">
        {here ? reading(here) : plot.top ? 'Línea fina: racha.' : ''}
      </p>
    </div>
  );
}
