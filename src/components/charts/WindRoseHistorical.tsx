/**
 * WindRoseHistorical — Polar wind frequency chart from TimescaleDB data.
 *
 * Bins wind data into 16 compass directions × 5 speed ranges,
 * then renders a classic wind rose using SVG.
 */

import { memo, useMemo } from 'react';

// ── Types & Constants ─────────────────────────────────────

interface WindReading {
  wind_speed: number | null;
  wind_dir: number | null;
}

interface Props {
  readings: WindReading[];
  /** Size of the SVG in pixels */
  size?: number;
}

const DIRECTIONS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
] as const;

/** Speed bins in knots */
const SPEED_BINS = [
  { label: '0–5', max: 5, color: '#60a5fa' },    // blue-400
  { label: '5–10', max: 10, color: '#34d399' },   // emerald-400
  { label: '10–15', max: 15, color: '#fbbf24' },  // amber-400
  { label: '15–20', max: 20, color: '#f97316' },  // orange-500
  { label: '20+', max: Infinity, color: '#ef4444' }, // red-500
];

/** Convert m/s to knots */
function toKnots(ms: number): number {
  return ms * 1.94384;
}

/** Get direction bin index (0-15) for a degree value */
function dirBin(deg: number): number {
  return Math.round(((deg % 360 + 360) % 360) / 22.5) % 16;
}

// ── Component ─────────────────────────────────────────────

export const WindRoseHistorical = memo(function WindRoseHistorical({
  readings,
  size = 260,
}: Props) {
  const bins = useMemo(() => {
    // 16 dirs × 5 speed bins
    const data: number[][] = Array.from({ length: 16 }, () => Array(SPEED_BINS.length).fill(0));
    let validCount = 0;

    for (const r of readings) {
      if (r.wind_speed == null || r.wind_dir == null) continue;
      if (r.wind_dir < 0 || r.wind_speed < 0) continue;

      const kt = toKnots(r.wind_speed);
      const di = dirBin(r.wind_dir);
      const si = SPEED_BINS.findIndex((b) => kt < b.max);
      const speedIdx = si >= 0 ? si : SPEED_BINS.length - 1;

      data[di][speedIdx]++;
      validCount++;
    }

    // Convert to percentages
    if (validCount > 0) {
      for (let d = 0; d < 16; d++) {
        for (let s = 0; s < SPEED_BINS.length; s++) {
          data[d][s] = (data[d][s] / validCount) * 100;
        }
      }
    }

    return { data, validCount };
  }, [readings]);

  if (bins.validCount < 10) {
    return (
      <div className="flex items-center justify-center h-[200px] text-slate-500 text-[11px]">
        Datos de viento insuficientes para la rosa
      </div>
    );
  }

  // Find max percentage for scaling
  const maxPct = Math.max(
    ...bins.data.map((dir) => dir.reduce((sum, v) => sum + v, 0))
  );

  const cx = size / 2;
  const cy = size / 2;
  const maxR = size / 2 - 30; // leave margin for labels
  const sectorAngle = (2 * Math.PI) / 16;
  const halfSector = sectorAngle / 2;

  // Build stacked petal paths
  const petals: { path: string; color: string; dir: number; speedIdx: number }[] = [];

  for (let d = 0; d < 16; d++) {
    const angle = (d * sectorAngle) - Math.PI / 2; // start from North (top)
    let innerR = 0;

    for (let s = 0; s < SPEED_BINS.length; s++) {
      const pct = bins.data[d][s];
      if (pct <= 0) {
        continue;
      }

      const outerR = innerR + (pct / maxPct) * maxR;

      // Arc path for this petal segment
      const a1 = angle - halfSector + 0.02; // tiny gap
      const a2 = angle + halfSector - 0.02;

      const x1Inner = cx + innerR * Math.cos(a1);
      const y1Inner = cy + innerR * Math.sin(a1);
      const x2Inner = cx + innerR * Math.cos(a2);
      const y2Inner = cy + innerR * Math.sin(a2);
      const x1Outer = cx + outerR * Math.cos(a1);
      const y1Outer = cy + outerR * Math.sin(a1);
      const x2Outer = cx + outerR * Math.cos(a2);
      const y2Outer = cy + outerR * Math.sin(a2);

      const largeArc = 0; // always < 180°

      const path = [
        `M ${x1Inner} ${y1Inner}`,
        `L ${x1Outer} ${y1Outer}`,
        `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2Outer} ${y2Outer}`,
        `L ${x2Inner} ${y2Inner}`,
        innerR > 0
          ? `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x1Inner} ${y1Inner}`
          : `Z`,
      ].join(' ');

      petals.push({ path, color: SPEED_BINS[s].color, dir: d, speedIdx: s });
      innerR = outerR;
    }
  }

  // Concentric reference circles (every 25% of max)
  const circles = [0.25, 0.5, 0.75, 1.0].map((frac) => ({
    r: frac * maxR,
    label: `${Math.round(frac * maxPct)}%`,
  }));

  // Direction labels
  const labelDirs = [0, 2, 4, 6, 8, 10, 12, 14]; // N, NE, E, SE, S, SW, W, NW
  const labelR = maxR + 16;

  return (
    <div className="space-y-2">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="mx-auto"
      >
        {/* Background circle */}
        <circle cx={cx} cy={cy} r={maxR} fill="#0f172a" stroke="#334155" strokeWidth={0.5} />

        {/* Reference circles */}
        {circles.map((c) => (
          <g key={c.r}>
            <circle cx={cx} cy={cy} r={c.r} fill="none" stroke="#334155" strokeWidth={0.5} strokeDasharray="2 3" />
            {c.r > 10 && (
              <text
                x={cx + 3}
                y={cy - c.r + 10}
                fontSize={7}
                fill="#64748b"
              >
                {c.label}
              </text>
            )}
          </g>
        ))}

        {/* Cross lines (N-S, E-W) */}
        <line x1={cx} y1={cy - maxR} x2={cx} y2={cy + maxR} stroke="#334155" strokeWidth={0.3} />
        <line x1={cx - maxR} y1={cy} x2={cx + maxR} y2={cy} stroke="#334155" strokeWidth={0.3} />

        {/* Petals */}
        {petals.map((p, i) => (
          <path
            key={i}
            d={p.path}
            fill={p.color}
            fillOpacity={0.75}
            stroke={p.color}
            strokeWidth={0.5}
          />
        ))}

        {/* Direction labels */}
        {labelDirs.map((d) => {
          const angle = (d * sectorAngle) - Math.PI / 2;
          const x = cx + labelR * Math.cos(angle);
          const y = cy + labelR * Math.sin(angle);
          return (
            <text
              key={d}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={9}
              fontWeight={d % 4 === 0 ? 700 : 400}
              fill={d % 4 === 0 ? '#e2e8f0' : '#94a3b8'}
            >
              {DIRECTIONS[d]}
            </text>
          );
        })}

        {/* Center dot */}
        <circle cx={cx} cy={cy} r={2} fill="#94a3b8" />
      </svg>

      {/* Legend */}
      <div className="flex items-center justify-center gap-2 flex-wrap">
        {SPEED_BINS.map((b) => (
          <div key={b.label} className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: b.color, opacity: 0.75 }} />
            <span className="text-[11px] text-slate-400">{b.label} kt</span>
          </div>
        ))}
      </div>

      <div className="text-center text-[11px] text-slate-600">
        {bins.validCount.toLocaleString()} lecturas con viento válido
      </div>
    </div>
  );
});
