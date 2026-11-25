/**
 * The drawing of a spot on the map, V3 style G: the state says itself in colour, and its figure goes inside, so colour
 * is never the only thing that says it. Hexagon for wind, pentagon for waves. Filled = measured; an outline = a model
 * (nobody measures waves on a beach); dashed = nothing to say yet. The notch marks where the wind comes from.
 * The same visual size for both shapes: a beach with small waves must not read as the most important thing on the map.
 * Colours are tokens, so the marker, the card, the list and the forecast read the same scale in both themes.
 */
import { useRef, type CSSProperties } from 'react';
import type { SpotVerdict } from '../../services/spotScoringEngine';
import { VERDICT_LINE, fillOf, fillTextOf, lineOf } from '../../config/verdictStyles';
import type { WindToneName } from '../../services/windUtils';
import '../../styles/archivoFonts.css';
import '../../styles/spotShape.css';

/** Corners of a regular polygon with one of them at the top, as an SVG `points` value. */
export function polygonPoints(sides: number, r: number, cx: number, cy: number): string {
  const pts: string[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (2 * Math.PI * i) / sides - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

/** The triangle on the side the wind comes from, pointing into the shape. */
export function notchPoints(fromDeg: number, r: number, cx: number, cy: number): string {
  const ux = Math.sin((fromDeg * Math.PI) / 180);
  const uy = -Math.cos((fromDeg * Math.PI) / 180);
  const at = (d: number, side: number) => `${(cx + ux * d - uy * side).toFixed(1)},${(cy + uy * d + ux * side).toFixed(1)}`;
  return `${at(r + 1, 0)} ${at(r + 9, 5)} ${at(r + 9, -5)}`;
}

/** An arc of the ring between two angles, clockwise from the top. */
function arcPath(radius: number, c: number, fromDeg: number, toDeg: number): string {
  const at = (deg: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return `${(c + radius * Math.cos(a)).toFixed(1)} ${(c + radius * Math.sin(a)).toFixed(1)}`;
  };
  return `M ${at(fromDeg)} A ${radius} ${radius} 0 ${toDeg - fromDeg > 180 ? 1 : 0} 1 ${at(toDeg)}`;
}

/** A whole gauge is 270°: the ring fills with the figure from the top. Read at a glance, without reading a number. */
const GAUGE_SWEEP = 270;
/** How much of the ring says the doubt, and how far past a full gauge it may go. */
const DOUBT_SWEEP = 44;
const DOUBT_END = 310;

/** The other level a spot is within a knot of: the one above its colour, or the one below. */
export interface SpotDoubt {
  other: SpotVerdict;
  above: boolean;
}

/**
 * Where the solid arc ends and where the dashed stretch of the doubt goes, in degrees from the top.
 * Above: the dashes go on from the tip, in the colour of the level it may reach. Below: the tip itself is
 * dashed in the colour of the level it may fall back to.
 */
export function gaugeArcs(fraction: number, doubt: SpotDoubt | null): { solidEnd: number; dashed: [number, number] | null } {
  const angle = Math.min(1, Math.max(0, fraction)) * GAUGE_SWEEP;
  if (!doubt || angle <= 0) return { solidEnd: angle, dashed: null };
  if (doubt.above) return { solidEnd: angle, dashed: [angle, Math.min(DOUBT_END, angle + DOUBT_SWEEP)] };
  const start = Math.max(0, angle - DOUBT_SWEEP);
  return { solidEnd: start, dashed: [start, angle] };
}

/** Past this, the figure inside the shape has to be a smaller size to fit («~1,2»). */
const SHORT_FIGURE = 3;

interface SpotShapeProps {
  /** Pentagon: a surf spot. The shape says what kind of spot it is, whatever the figure inside. */
  pentagon?: boolean;
  /** The figure is a model (the wave at a beach, nobody measures it): no fill and no colour of state. */
  hollow?: boolean;
  verdict: SpotVerdict;
  /** Past 22 kt a «Fuerte» spot takes the colour of its wind (windToneOver). */
  tone?: WindToneName | null;
  /** What goes inside: «14», «~0,6», «3,0». Nothing yet: dashed, with a dash. */
  value: string | null;
  /** Where the wind comes from. Null when the sources disagree or there is no wind figure. */
  fromDeg?: number | null;
  /** How full its ring is, 0 to 1: the wind or the wave. Null: no ring. */
  gauge?: number | null;
  /** The wind is within a knot of a line: the tip of the ring is dashed in the colour of the other level. */
  doubt?: SpotDoubt | null;
  /** The one selected. */
  big?: boolean;
}

export function SpotShape({ pentagon = false, hollow = false, verdict, tone = null, value, fromDeg = null, gauge = null, doubt = null, big = false }: SpotShapeProps) {
  const size = big ? 80 : 72;
  const c = size / 2;
  const r = pentagon ? (big ? 25 : 22) : big ? 23 : 19;
  const cy = pentagon ? c + 1 : c;
  const points = polygonPoints(pentagon ? 5 : 6, r, c, cy);
  const long = (value?.length ?? 0) > SHORT_FIGURE;
  const pending = value == null;
  const ringRadius = r + (pentagon ? 6 : 7);
  const ringWidth = big ? 3.5 : 3;

  const arcs = gauge != null ? gaugeArcs(gauge, doubt) : null;

  // The ring moves to its new place in half a second instead of jumping, so a change is seen without
  // reading the figure. The arc keeps its own path (its end is where the figure says); what moves is how
  // much of it is drawn. Growing: the new arc draws itself from where the old one ended. Shrinking: the
  // stretch that is no longer true draws back. `move` only changes when the end does, so a render for
  // any other reason does not restart it. The first drawing does not move.
  const solidEnd = pending || !arcs ? null : arcs.solidEnd;
  const move = useRef<{ from: number | null; to: number | null }>({ from: solidEnd, to: solidEnd });
  if (move.current.to !== solidEnd) move.current = { from: move.current.to, to: solidEnd };
  const { from: movedFrom } = move.current;
  const grows = solidEnd != null && movedFrom != null && movedFrom < solidEnd;
  const shrinks = solidEnd != null && movedFrom != null && movedFrom > solidEnd;
  const moveKey = `${movedFrom}-${solidEnd}`;

  const fontSize = long ? 14 : big ? 23 : 19;
  const baseline = c + fontSize * 0.35;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ display: 'block' }}>
      {!pending && gauge != null && (
        <>
          <circle cx={c} cy={c} r={ringRadius} fill="none" stroke={lineOf(verdict, tone)} strokeWidth={ringWidth} opacity={0.22} />
          {arcs && arcs.solidEnd > 0 && (
            <path
              key={grows ? moveKey : 'solid'}
              className={grows ? 'gs-grow' : undefined}
              style={grows ? ({ '--gs-from': ((movedFrom as number) / arcs.solidEnd) * 100 } as CSSProperties) : undefined}
              pathLength={100}
              d={arcPath(ringRadius, c, 0, arcs.solidEnd)}
              fill="none"
              stroke={lineOf(verdict, tone)}
              strokeWidth={ringWidth}
              strokeLinecap="round"
            />
          )}
          {arcs && shrinks && (
            <path
              key={moveKey}
              className="gs-shrink"
              pathLength={100}
              d={arcPath(ringRadius, c, arcs.solidEnd, movedFrom as number)}
              fill="none"
              stroke={lineOf(verdict, tone)}
              strokeWidth={ringWidth}
              strokeLinecap="round"
            />
          )}
          {arcs?.dashed && doubt && (
            <path
              key={grows || shrinks ? `d${moveKey}` : 'doubt'}
              className={grows || shrinks ? 'gs-late' : undefined}
              data-doubt={doubt.other}
              d={arcPath(ringRadius, c, arcs.dashed[0], arcs.dashed[1])}
              fill="none"
              stroke={VERDICT_LINE[doubt.other]}
              strokeWidth={ringWidth}
              strokeLinecap="round"
              strokeDasharray="1.5 5.5"
            />
          )}
        </>
      )}
      {!pending && !hollow && <polygon points={points} fill="var(--g-m-ring)" stroke="var(--g-m-ring)" strokeWidth={6} strokeLinejoin="round" />}
      {pending ? (
        <polygon points={points} fill="var(--g-bg)" stroke="var(--g-rule)" strokeWidth={2} strokeDasharray="4 3" strokeLinejoin="round" />
      ) : hollow ? (
        <polygon points={points} fill="var(--g-bg)" stroke={lineOf(verdict, tone)} strokeWidth={2.5} strokeLinejoin="round" />
      ) : (
        <polygon points={points} fill={fillOf(verdict, tone)} stroke="var(--g-m-ringin)" strokeWidth={2.5} strokeLinejoin="round" />
      )}
      {!pending && !hollow && fromDeg != null && <polygon points={notchPoints(fromDeg, ringRadius + 1, c, c)} fill="var(--g-m-notch)" />}
      <text
        x={c}
        y={baseline}
        textAnchor="middle"
        fontFamily="var(--g-narrow)"
        fontWeight={700}
        fontSize={fontSize}
        fill={pending || hollow ? 'var(--g-ink)' : fillTextOf(verdict, tone)}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {value ?? '–'}
      </text>
    </svg>
  );
}
