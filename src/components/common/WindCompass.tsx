import { windSpeedColor, degreesToCardinal } from '../../services/windUtils';

interface WindCompassProps {
  direction: number | null;  // degrees (meteorological: where wind comes FROM)
  speed: number | null;      // m/s
  size?: number;             // px, default 48
  /** Paper and ink, for the V3 cards: the arrow in ink instead of the wind colour */
  ink?: boolean;
  /** The card already says the direction in words */
  hideLabel?: boolean;
}

/**
 * Mini compass with a wind direction arrow.
 * Shows cardinal marks (N/E/S/W), a ring, and an arrow pointing
 * where the wind is going TO (direction + 180°).
 */
export function WindCompass({ direction, speed, size = 48, ink = false, hideLabel = false }: WindCompassProps) {
  const half = size / 2;
  const ringR = half - 4;
  const color = ink ? 'var(--g-ink)' : windSpeedColor(speed);
  const ringColor = ink ? 'var(--g-rule)' : '#334155';
  const tickColor = ink ? 'var(--g-muted)' : '#64748b';
  const northColor = ink ? 'var(--g-ink)' : '#94a3b8';
  const hasDirection = direction !== null && speed !== null && speed >= 0.3;
  const hasSpeedOnly = !hasDirection && speed !== null && speed >= 0.3;

  // Arrow points where wind goes TO
  const arrowRotation = hasDirection ? (direction! + 180) % 360 : 0;
  const arrowLen = ringR - 4;

  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Outer ring */}
        <circle
          cx={half} cy={half} r={ringR}
          fill="none"
          stroke={ringColor}
          strokeWidth={1.5}
        />

        {/* Cardinal tick marks */}
        {[0, 90, 180, 270].map((deg) => {
          const rad = (deg - 90) * (Math.PI / 180);
          const x1 = half + (ringR - 3) * Math.cos(rad);
          const y1 = half + (ringR - 3) * Math.sin(rad);
          const x2 = half + ringR * Math.cos(rad);
          const y2 = half + ringR * Math.sin(rad);
          return (
            <line
              key={deg}
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={tickColor}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          );
        })}

        {/* Cardinal labels. Not on the cards: at this size they cannot be read, and the words beside it say it */}
        {!ink && (
          <>
            <text x={half} y={6} textAnchor="middle" fontSize={7} fontWeight={700} fill={northColor}>N</text>
            <text x={size - 3} y={half + 2.5} textAnchor="middle" fontSize={6} fill={tickColor}>E</text>
            <text x={half} y={size - 1} textAnchor="middle" fontSize={6} fill={tickColor}>S</text>
            <text x={3} y={half + 2.5} textAnchor="middle" fontSize={6} fill={tickColor}>W</text>
          </>
        )}

        {hasDirection ? (
          /* Wind arrow */
          <g transform={`rotate(${arrowRotation}, ${half}, ${half})`}>
            {/* Shaft */}
            <line
              x1={half} y1={half + arrowLen * 0.3}
              x2={half} y2={half - arrowLen}
              stroke={color}
              strokeWidth={2.5}
              strokeLinecap="round"
            />
            {/* Arrowhead */}
            <polygon
              points={`${half - 4},${half - arrowLen + 4} ${half + 4},${half - arrowLen + 4} ${half},${half - arrowLen - 3}`}
              fill={color}
            />
            {/* Tail circle */}
            <circle cx={half} cy={half} r={2.5} fill={color} />
          </g>
        ) : hasSpeedOnly ? (
          /* Speed but no direction: dot with wind color */
          <>
            <circle cx={half} cy={half} r={5} fill={color} opacity={0.6} />
            <circle cx={half} cy={half} r={3} fill={color} />
          </>
        ) : (
          /* No wind: calm indicator */
          <circle cx={half} cy={half} r={3} fill={ink ? 'var(--g-muted)' : '#475569'} />
        )}
      </svg>

      {/* Text label below */}
      {hideLabel ? null : hasDirection ? (
        <div className="text-xs font-semibold text-center leading-tight" style={{ color }}>
          {degreesToCardinal(direction!)} {Math.round(direction!)}°
        </div>
      ) : hasSpeedOnly ? (
        <div className="text-xs font-semibold text-center leading-tight" style={{ color }}>
          Sin veleta
        </div>
      ) : (
        <div className="text-xs text-slate-500 text-center">Calma</div>
      )}
    </div>
  );
}
