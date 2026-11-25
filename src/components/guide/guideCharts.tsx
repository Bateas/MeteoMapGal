/**
 * The guide's charts: plain SVG, no chart library, in the style of the forecast panel (.g-theme).
 *
 * The guide explains the app as it is today: the wind colours are the map's scale (VERDICT_FILL), which is also the
 * panel's, and every band carries its name next to it.
 *
 * Solid line = measured, dashed = forecast: that is the only use of a dashed line here.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { VERDICT_FILL, VERDICT_LINE } from '../../config/verdictStyles';
import { WIND_TONE_STEPS_KT } from '../../services/windUtils';
import { LIGHTNING_DANGER_KM, LIGHTNING_WARN_KM } from '../../services/lightningProximityService';
import type { SpotVerdict } from '../../services/spotScoringEngine';
import '../charts/forecastG.css';
import '../../styles/archivoFonts.css';
import './guide.css';

/** The scale of `windVerdict`. A test keeps both in step. */
export const WIND_SCALE: { verdict: SpotVerdict; name: string; fromKt: number; toKt: number; range: string; text: string }[] = [
  { verdict: 'calm', name: 'Calma', fromKt: 0, toKt: 6, range: 'hasta 5 kt', text: 'Sin viento útil.' },
  { verdict: 'light', name: 'Flojo', fromKt: 6, toKt: 8, range: '6-7 kt', text: 'Viento ligero: SUP, paseo.' },
  { verdict: 'sailing', name: 'Navegable', fromKt: 8, toKt: 12, range: '8-11 kt', text: 'Viento justo.' },
  { verdict: 'good', name: 'Bueno', fromKt: 12, toKt: 18, range: '12-17 kt', text: 'Viento estable.' },
  { verdict: 'strong', name: 'Fuerte', fromKt: 18, toKt: 25, range: '18 kt o más', text: 'Requiere experiencia.' },
];

const comma = (n: number) => String(n).replace('.', ',');

/** Draws at the real width, so the labels keep their size on a phone instead of shrinking with the chart. */
function useChartWidth(initial: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initial);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => { if (el.clientWidth > 0) setWidth(Math.max(260, el.clientWidth)); };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/**
 * Past «Fuerte», the colour of the wind (Beaufort 6, 8, 10 and 11). The word stays «Fuerte»: the colour says how much.
 * Names anyone understands (18-nov): the Beaufort ones («fresco», «duro», «muy duro») read as temperature or slang.
 */
const [DURO_KT, TEMPORAL_KT, TDURO_KT, TMDURO_KT] = WIND_TONE_STEPS_KT.slice(4);
const MAP_TONES: { key: 'duro' | 'temporal' | 'tduro' | 'tmduro'; name: string; fromKt: number; range: string; text: string }[] = [
  { key: 'duro', name: 'Muy fuerte', fromKt: DURO_KT, range: `${DURO_KT} kt o más`, text: 'El spot sigue diciendo Fuerte: el color dice cuánto más.' },
  { key: 'temporal', name: 'Temporal', fromKt: TEMPORAL_KT, range: `${TEMPORAL_KT} kt o más`, text: 'Mejor no salir al mar.' },
  { key: 'tduro', name: 'Gran temporal', fromKt: TDURO_KT, range: `${TDURO_KT} kt o más`, text: 'Arranca ramas y tejas.' },
  { key: 'tmduro', name: 'Huracanado', fromKt: TMDURO_KT, range: `${TMDURO_KT} kt o más`, text: 'Casi huracán. Rachas así se han medido en los cabos.' },
];

/**
 * The scale of the app: the five words, and a thin strip under «Fuerte» with how its colour goes on past 22 kt. The
 * strong end is squeezed (22 to 62 kt in the last 35 %), or the sailing steps would be a few pixels on a phone. The last
 * figure sits at the right edge, clear of the one before.
 */
export function WindScale() {
  const { ref, width } = useChartWidth(700);
  const top = 62;
  const x = (kt: number) => {
    const k = Math.min(kt, top);
    return k <= DURO_KT ? (k / DURO_KT) * 0.65 * width : (0.65 + ((k - DURO_KT) / (top - DURO_KT)) * 0.35) * width;
  };
  const bands = WIND_SCALE.map((b, i) => (i === WIND_SCALE.length - 1 ? { ...b, toKt: top } : b));
  const label = 'Escala de viento en nudos: calma hasta 5, flojo de 6 a 7, navegable de 8 a 11, bueno de 12 a 17, fuerte desde 18.'
    + ` El color de fuerte sigue subiendo: rojo desde ${DURO_KT}, magenta desde ${TEMPORAL_KT}, violeta desde ${TDURO_KT} y violeta casi negro desde ${TMDURO_KT}.`;
  return (
    <div ref={ref}>
      <svg className="gg-svg" viewBox={`0 0 ${width} 56`} role="img" aria-label={label}>
        {bands.map((b, i) => (
          <rect key={b.verdict} x={x(b.fromKt) + (i ? 1 : 0)} y={4} width={x(b.toKt) - x(b.fromKt) - (i ? 2 : 0)} height={22} rx={i === 0 || i === bands.length - 1 ? 4 : 1} fill={VERDICT_FILL[b.verdict]} />
        ))}
        {MAP_TONES.map((t, i) => {
          const to = i + 1 < MAP_TONES.length ? MAP_TONES[i + 1].fromKt : top;
          return <rect key={t.key} x={x(t.fromKt) + 1} y={28} width={x(to) - x(t.fromKt) - 2} height={6} rx={2} fill={`var(--g-c-${t.key})`} />;
        })}
        {bands.slice(1).map((b) => (
          <g key={b.verdict}>
            <line x1={x(b.fromKt)} x2={x(b.fromKt)} y1={26} y2={34} stroke="var(--g-muted)" />
            <text x={x(b.fromKt)} y={48} textAnchor="middle" className="gg-strong">{b.fromKt}</text>
          </g>
        ))}
        {MAP_TONES.map((t, i) => (
          <g key={t.key}>
            <line x1={x(t.fromKt)} x2={x(t.fromKt)} y1={34} y2={38} stroke="var(--g-muted)" />
            <text x={i === MAP_TONES.length - 1 ? width : x(t.fromKt)} y={48} textAnchor={i === MAP_TONES.length - 1 ? 'end' : 'middle'}>{i === MAP_TONES.length - 1 ? `${t.fromKt}+` : t.fromKt}</text>
          </g>
        ))}
        <text x={0} y={48}>0 kt</text>
      </svg>
      <div className="gg-rows">
        {WIND_SCALE.map((b) => (
          <div className="gg-row" key={b.verdict}>
            <span className="gg-swatch" style={{ background: VERDICT_FILL[b.verdict] }} />
            <b>{b.name}</b>
            <span className="gg-muted gg-nums">{b.range}</span>
            <span className="gg-muted gg-small">{b.text}</span>
          </div>
        ))}
        {MAP_TONES.map((t) => (
          <div className="gg-row gg-row-map" key={t.key}>
            <span className="gg-swatch gg-swatch-thin" style={{ background: `var(--g-c-${t.key})` }} />
            <b>{t.name}</b>
            <span className="gg-muted gg-nums">{t.range}</span>
            <span className="gg-muted gg-small">{t.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The seven colours of the arrows (the stroke tokens, the same hex as `windSpeedColor`), with where each one starts. */
export function WindTonesStrip() {
  const stops = [...WIND_SCALE.map((b) => ({ kt: b.fromKt, fill: VERDICT_LINE[b.verdict] })), ...MAP_TONES.map((t) => ({ kt: t.fromKt, fill: `var(--g-s-${t.key})` }))];
  return (
    <span className="gg-tonestrip" role="img" aria-label={`Color de la flecha según el viento, en nudos: ${stops.map((s) => s.kt).join(', ')} o más.`}>
      {stops.map((s, i) => (
        <span key={s.kt}><i style={{ background: s.fill }} />{i === stops.length - 1 ? `${s.kt}+` : s.kt}</span>
      ))}
    </span>
  );
}

function useHoverHour(hours: number[], xOf: (h: number) => number, viewWidth: number) {
  const [hour, setHour] = useState<number | null>(null);
  const [left, setLeft] = useState(0);
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * viewWidth;
    const best = hours.reduce((a, h) => (Math.abs(xOf(h) - px) < Math.abs(xOf(a) - px) ? h : a), hours[0]);
    setHour(best);
    setLeft((xOf(best) / viewWidth) * r.width);
  };
  return { hour, left, onMove, onLeave: () => setHour(null) };
}

function Tip({ left, children }: { left: number; children: ReactNode }) {
  return <div className={`gg-tip${left > 170 ? ' gg-tip-left' : ''}`} style={{ left }}>{children}</div>;
}

function NumbersTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="gg-details">
      <summary>Ver los números</summary>
      <div className="gg-table">
        <table>
          <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r) => <tr key={r[0]}>{r.map((c, i) => <td key={i}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}

/** Hour, measured kt (spot consensus before any reinforcement), kt forecast at 06:00 for that point. */
export const CESANTES_DAY: [number, number, number][] = [
  [8, 3.0, 3.5], [9, 3.3, 2.8], [10, 2.4, 3.2], [11, 3.2, 4.5], [12, 4.6, 3.6], [13, 4.8, 5.0], [14, 7.7, 7.5],
  [15, 7.6, 7.8], [16, 7.9, 9.0], [17, 9.7, 9.7], [18, 9.6, 7.5], [19, 6.2, 6.8], [20, 4.5, 2.3], [21, 3.7, 4.0],
];

export function MeasuredVsForecast() {
  const { ref, width } = useChartWidth(700);
  const L = 38, R = width - 10, T = 14, B = 266;
  const x = (h: number) => L + ((h - 8) / 13) * (R - L);
  const y = (k: number) => B - (k / 12) * (B - T);
  const hover = useHoverHour(CESANTES_DAY.map((d) => d[0]), x, width);
  const row = CESANTES_DAY.find((d) => d[0] === hover.hour);
  const line = (i: 1 | 2) => CESANTES_DAY.map((d) => `${x(d[0])},${y(d[i])}`).join(' ');
  const note = (h: number, k: number, dx: number, dy: number, label: string, end = false) => (
    <g>
      <line x1={x(h)} y1={y(k)} x2={x(h) + dx} y2={y(k) + dy} stroke="var(--g-muted)" />
      <circle cx={x(h)} cy={y(k)} r={4} fill="var(--g-ink)" stroke="var(--g-bg)" strokeWidth={2} />
      <text x={x(h) + dx + (end ? -4 : 4)} y={y(k) + dy + 4} textAnchor={end ? 'end' : 'start'} className="gg-strong">{label}</text>
    </g>
  );
  return (
    <figure className="gg-figure">
      <h3>Un día real: lo medido y lo que decía la previsión</h3>
      <ul className="gg-legend">
        <li><svg width="26" height="10" aria-hidden="true"><line x1="0" y1="5" x2="26" y2="5" stroke="var(--g-ink)" strokeWidth="2.5" /></svg>Medido</li>
        <li><svg width="26" height="10" aria-hidden="true"><line x1="0" y1="5" x2="26" y2="5" stroke="var(--g-muted)" strokeWidth="2" strokeDasharray="5 4" /></svg>Previsión de las 06:00</li>
      </ul>
      <div className="gg-plot" ref={ref}>
        <svg className="gg-svg" viewBox={`0 0 ${width} 300`} role="img" onPointerMove={hover.onMove} onPointerDown={hover.onMove} onPointerLeave={hover.onLeave}
          aria-label="Cesantes, 26 de octubre de 2026. El viento medido sube de 5 a 8 nudos a las 14 h, llega a 9,7 a las 17 h y cae a 4,5 a las 20 h. La previsión de las 06:00 dio 9,7 a las 17 h.">
          {WIND_SCALE.slice(0, 3).map((b) => (
            <rect key={b.verdict} x={L - 8} y={y(b.toKt)} width={4} height={y(b.fromKt) - y(b.toKt) - 1} fill={VERDICT_FILL[b.verdict]} />
          ))}
          {[0, 6, 8, 12].map((k) => (
            <g key={k}>
              <line x1={L} x2={R} y1={y(k)} y2={y(k)} stroke={k ? 'var(--g-hair)' : 'var(--g-rule)'} />
              <text x={L - 12} y={y(k) + 4} textAnchor="end">{k}</text>
            </g>
          ))}
          <text x={L + 2} y={y(12) + 14}>nudos (kt)</text>
          {(width < 480 ? [8, 12, 16, 20] : [8, 10, 12, 14, 16, 18, 20]).map((h) => <text key={h} x={x(h)} y={B + 18} textAnchor="middle">{h} h</text>)}
          <polyline points={line(2)} fill="none" stroke="var(--g-muted)" strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" />
          <polyline points={line(1)} fill="none" stroke="var(--g-ink)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          {note(14, 7.7, -16, -30, width < 480 ? '14 h: entra' : '14 h: entra, de 5 a 8 kt', true)}
          {note(17, 9.7, 8, -26, width < 480 ? '17 h: 9,7 kt' : '17 h: máximo, 9,7 kt')}
          {note(20, 4.5, -6, 48, '20 h: cae', true)}
          {hover.hour != null && <line x1={x(hover.hour)} x2={x(hover.hour)} y1={T} y2={B} stroke="var(--g-rule)" />}
        </svg>
        {row && <Tip left={hover.left}><b>{row[0]}:00</b><br />Medido {comma(row[1])} kt<br />Previsión {comma(row[2])} kt</Tip>}
      </div>
      <figcaption><b>Cesantes, lunes 26-oct-2026.</b> Medido: media de cada hora del viento de las estaciones. Previsión: modelo WRF para ese punto. Es un día que se lee bien: otros días la previsión falla más, y por eso conviene mirar las dos cosas.</figcaption>
      <NumbersTable head={['Hora', 'Medido (kt)', 'Previsión (kt)']} rows={CESANTES_DAY.map((d) => [`${d[0]}:00`, comma(d[1]), comma(d[2])])} />
    </figure>
  );
}

interface Afternoon {
  station: string;
  count: string;
  /** hour → [p25, p50, p75, p90] in kt, August 2026. */
  perHour: Record<number, [number, number, number, number]>;
  /** Median hours over the afternoons that reached 8 kt. */
  marks: [number, string][];
}

export const AFTERNOON_RIBADAVIA: Afternoon = {
  station: 'Ribadavia, a 1,7 km de Castrelo',
  count: '15 de 31 tardes llegaron a 8 kt, navegable',
  perHour: { 10: [1, 1.2, 1.6, 2.9], 11: [1.3, 2.1, 3.4, 4.5], 12: [2, 2.6, 3.1, 4.9], 13: [1.9, 2.5, 4.1, 8], 14: [2.5, 2.9, 4.8, 8.2], 15: [2.4, 4.3, 5.6, 6.6], 16: [3, 4.5, 6.5, 8.7], 17: [3.1, 5.1, 6.7, 8], 18: [3.4, 5.6, 7.9, 8.6], 19: [3.1, 5.8, 7.6, 8.6], 20: [4.1, 4.9, 7, 9.3], 21: [2.6, 4.1, 6.8, 7.8], 22: [1.9, 3.5, 4.3, 5.6] },
  marks: [[15, 'entra'], [18, 'máx.'], [20, 'cae']],
};

export const AFTERNOON_REDONDELA: Afternoon = {
  station: 'Redondela, a 2 km de Cesantes',
  count: '8 de 27 tardes llegaron a 8 kt, navegable',
  perHour: { 10: [2.3, 2.9, 4.5, 6.1], 11: [2.5, 3, 4.3, 6.2], 12: [3, 3.7, 4.6, 5.5], 13: [3.7, 4.5, 4.9, 5.3], 14: [3.5, 4.7, 5.7, 6.2], 15: [4.4, 5.4, 6.8, 7.8], 16: [4.9, 5.9, 6.6, 8.3], 17: [4.7, 5.6, 7.6, 8.5], 18: [4.9, 5.4, 7.3, 8.1], 19: [4.1, 5.4, 6.5, 7.2], 20: [3.4, 4.7, 6.1, 7.4], 21: [2.8, 4.3, 5.1, 5.5], 22: [2.5, 4.1, 5, 6.1] },
  marks: [[14.5, 'entra'], [17, 'máx.'], [20.5, 'cae']],
};

export function TypicalAfternoon({ data, title }: { data: Afternoon; title: string }) {
  const { ref, width } = useChartWidth(540);
  const L = 26, R = width - 8, T = 10, B = 196;
  const hours = Object.keys(data.perHour).map(Number);
  const x = (h: number) => L + ((h - 10) / 12) * (R - L);
  const y = (k: number) => B - (k / 10) * (B - T);
  const hover = useHoverHour(hours, x, width);
  const row = hover.hour != null ? data.perHour[hover.hour] : null;
  const pick = (i: number) => hours.map((h) => `${x(h)},${y(data.perHour[h][i])}`).join(' ');
  const band = `${pick(2)} ${[...hours].reverse().map((h) => `${x(h)},${y(data.perHour[h][0])}`).join(' ')}`;
  return (
    <figure className="g-theme gg-page gg-figure">
      <h3>{title}</h3>
      <p className="gg-muted gg-small"><b className="gg-ink">{data.station}.</b> {data.count}.</p>
      <ul className="gg-legend">
        <li><svg width="26" height="12" aria-hidden="true"><rect width="26" height="12" fill="var(--g-hair)" /></svg>La mitad de las tardes</li>
        <li><svg width="26" height="10" aria-hidden="true"><line x1="0" y1="5" x2="26" y2="5" stroke="var(--g-ink)" strokeWidth="2.5" /></svg>Tarde mediana</li>
        <li><svg width="26" height="10" aria-hidden="true"><line x1="0" y1="5" x2="26" y2="5" stroke="var(--g-muted)" strokeWidth="1.25" /></svg>1 de cada 10 tardes pasa de aquí</li>
      </ul>
      <div className="gg-plot" ref={ref}>
        <svg className="gg-svg" viewBox={`0 0 ${width} 250`} role="img" onPointerMove={hover.onMove} onPointerDown={hover.onMove} onPointerLeave={hover.onLeave}
          aria-label={`${data.station}, agosto de 2026: viento hora a hora por la tarde. ${data.count}.`}>
          {[0, 4, 8].map((k) => (
            <g key={k}>
              <line x1={L} x2={R} y1={y(k)} y2={y(k)} stroke={k ? 'var(--g-hair)' : 'var(--g-rule)'} />
              <text x={L - 5} y={y(k) + 4} textAnchor="end">{k}</text>
            </g>
          ))}
          <polygon points={band} fill="var(--g-hair)" />
          <polyline points={pick(3)} fill="none" stroke="var(--g-muted)" strokeWidth={1.25} strokeLinejoin="round" />
          <polyline points={pick(1)} fill="none" stroke="var(--g-ink)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          {[10, 14, 18, 22].map((h) => <text key={h} x={x(h)} y={B + 16} textAnchor="middle">{h} h</text>)}
          {data.marks.map(([h, label]) => (
            <g key={label}>
              <line x1={x(h)} x2={x(h)} y1={B + 22} y2={B + 29} stroke="var(--g-ink)" strokeWidth={1.5} />
              <text x={x(h)} y={B + 42} textAnchor="middle" className="gg-strong">{label}</text>
            </g>
          ))}
          {hover.hour != null && <line x1={x(hover.hour)} x2={x(hover.hour)} y1={T} y2={B} stroke="var(--g-rule)" />}
        </svg>
        {row && <Tip left={hover.left}><b>{hover.hour}:00</b><br />Mediana {comma(row[1])} kt<br />Mitad: {comma(row[0])}-{comma(row[2])} kt<br />1 de cada 10 pasa de {comma(row[3])} kt</Tip>}
      </div>
      <figcaption><b>Agosto de 2026, un solo mes.</b> Son lecturas de esa estación, no del agua, y en el agua puede soplar más. Entra, máximo y cae: horas medianas de las tardes que llegaron a 8 kt.</figcaption>
      <NumbersTable head={['Hora', 'Mediana', 'Mitad de las tardes', '1 de cada 10']} rows={hours.map((h) => { const p = data.perHour[h]; return [`${h}:00`, comma(p[1]), `${comma(p[0])}-${comma(p[2])}`, comma(p[3])]; })} />
    </figure>
  );
}

export function LightningRings({ title = 'Los rayos se miden desde tu spot, no desde la comarca' }: { title?: string }) {
  const C = 150, U = 132 / LIGHTNING_WARN_KM;
  const hexagon = [0, 1, 2, 3, 4, 5].map((i) => { const a = (Math.PI / 3) * i - Math.PI / 6; return `${C + 9 * Math.cos(a)},${C + 9 * Math.sin(a)}`; }).join(' ');
  const bolt = (km: [number, number], fill: string) => {
    const px = C + km[0] * U, py = C + km[1] * U;
    return <path key={km.join()} d={`M${px + 2} ${py - 12}L${px - 7} ${py + 2}H${px}L${px - 2} ${py + 12}L${px + 7} ${py - 2}H${px}Z`} fill={fill} stroke="var(--g-bg)" strokeWidth={0.8} />;
  };
  return (
    <figure className="gg-figure">
      <h3>{title}</h3>
      <div className="gg-rules">
        <svg className="gg-svg" viewBox="0 0 300 300" role="img" aria-label={`Esquema: un spot en el centro, un anillo a ${LIGHTNING_DANGER_KM} kilómetros para el peligro y otro a ${LIGHTNING_WARN_KM} para el aviso, con rayos de ejemplo.`}>
          <circle cx={C} cy={C} r={LIGHTNING_WARN_KM * U} fill="none" stroke="var(--g-muted)" strokeWidth={1.5} />
          <circle cx={C} cy={C} r={LIGHTNING_DANGER_KM * U} fill="none" stroke="var(--g-danger)" strokeWidth={2} />
          <text x={C} y={C - LIGHTNING_WARN_KM * U + 16} textAnchor="middle" className="gg-strong">{LIGHTNING_WARN_KM} km</text>
          <text x={C} y={C - LIGHTNING_DANGER_KM * U + 16} textAnchor="middle" className="gg-strong">{LIGHTNING_DANGER_KM} km</text>
          <polygon points={hexagon} fill="var(--g-ink)" />
          <text x={C} y={C + 24} textAnchor="middle" className="gg-strong">tu spot</text>
          {([[-6, -3], [6.5, 2.5]] as [number, number][]).map((k) => bolt(k, 'var(--g-danger)'))}
          {([[16, -12], [19, 4], [14, 15], [-17, 10]] as [number, number][]).map((k) => bolt(k, 'var(--g-muted)'))}
        </svg>
        <dl>
          <dt className="gg-danger">PELIGRO, a {LIGHTNING_DANGER_KM} km o menos</dt>
          <dd>2 rayos, o 1 si además hay al menos 3 a {LIGHTNING_WARN_KM} km.</dd>
          <dt>AVISO, a {LIGHTNING_WARN_KM} km o menos</dt>
          <dd>3 rayos, o 1 solo si cae a {LIGHTNING_DANGER_KM} km o menos: tormenta al lado, o llegando.</dd>
          <dt>ESPERA</dt>
          <dd>Tras un peligro, el aviso pide esperar hasta 30 min después del último rayo a {LIGHTNING_DANGER_KM} km. No dice que sea seguro.</dd>
        </dl>
      </div>
      <figcaption><b>Esquema, no un día real.</b> Los anillos sí están a escala entre sí.</figcaption>
    </figure>
  );
}
