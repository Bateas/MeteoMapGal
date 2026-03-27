import { windSpeedColor, degreesToCardinal } from '../../services/windUtils';

interface WindCompassProps {
  direction: number | null;  // degrees (meteorological: where wind comes FROM)
  speed: number | null;      // m/s
  size?: number;             // px, default 48
}

/**
 * Mini compass with a wind direction arrow.
 * Shows cardinal marks (N/E/S/W), a ring, and an arrow pointing
 * where the wind is going TO (direction + 180°).
 */
export function WindCompass({ direction, speed, size = 48 }: WindCompassProps) {
  const half = size / 2;
  const ringR = half - 4;
  const color = windSpeedColor(speed);
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
          stroke="#334155"
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
              stroke="#64748b"
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          );
        })}

        {/* Cardinal labels */}
        <text x={half} y={6} textAnchor="middle" fontSize={7} fontWeight={700} fill="#94a3b8">N</text>
        <text x={size - 3} y={half + 2.5} textAnchor="middle" fontSize={6} fill="#64748b">E</text>
        <text x={half} y={size - 1} textAnchor="middle" fontSize={6} fill="#64748b">S</text>
        <text x={3} y={half + 2.5} textAnchor="middle" fontSize={6} fill="#64748b">W</text>

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
          <circle cx={half} cy={half} r={3} fill="#475569" />
        )}
      </svg>

      {/* Text label below */}
      {hasDirection ? (
        <div className="text-[10px] font-semibold text-center leading-tight" style={{ color }}>
          {degreesToCardinal(direction!)} {Math.round(direction!)}°
        </div>
      ) : hasSpeedOnly ? (
        <div className="text-[10px] font-semibold text-center leading-tight" style={{ color }}>
          Sin veleta
        </div>
      ) : (
        <div className="text-[10px] text-slate-500 text-center">Calma</div>
      )}
    </div>
  );
}
