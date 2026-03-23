import { windArrowLength, windSpeedColor, msToKnots } from '../../services/windUtils';

interface WindArrowProps {
  direction: number | null; // degrees from north (meteorological: where wind comes FROM)
  speed: number | null;     // m/s
  gust?: number | null;     // m/s — gust for halo effect
}

export function WindArrow({ direction, speed, gust }: WindArrowProps) {
  if (direction === null || speed === null || speed < 0.3) {
    return (
      <circle r="4" fill="#94a3b8" opacity={0.5} />
    );
  }

  const length = windArrowLength(speed);
  const color = windSpeedColor(speed);
  const gustKt = gust ? msToKnots(gust) : 0;
  const hasStrongGust = gustKt >= 15;

  // Arrow points where wind is going TO (direction + 180)
  const rotation = (direction + 180) % 360;

  return (
    <g transform={`rotate(${rotation})`}>
      {/* Gust halo — pulsing glow for strong gusts (>=15kt) */}
      {hasStrongGust && (
        <circle r={length + 4} fill="none" stroke={color} strokeWidth="1.5" opacity={0.4}>
          <animate attributeName="r" values={`${length + 2};${length + 8};${length + 2}`} dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.4;0.1;0.4" dur="2s" repeatCount="indefinite" />
        </circle>
      )}
      <line
        x1="0" y1="0"
        x2="0" y2={-length}
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
      />
      <polygon
        points={`-4.5,${-length + 3} 4.5,${-length + 3} 0,${-length - 6}`}
        fill={color}
      />
    </g>
  );
}
