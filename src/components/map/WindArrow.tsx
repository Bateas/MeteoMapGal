import { windArrowLength, windSpeedColor } from '../../services/windUtils';

interface WindArrowProps {
  direction: number | null; // degrees from north (meteorological: where wind comes FROM)
  speed: number | null;     // m/s
}

export function WindArrow({ direction, speed }: WindArrowProps) {
  if (direction === null || speed === null || speed < 0.3) {
    // Calm wind: show a small dot
    return (
      <circle r="3" fill="#94a3b8" opacity={0.6} />
    );
  }

  const length = windArrowLength(speed);
  const color = windSpeedColor(speed);

  // Arrow points where wind is going TO (direction + 180)
  const rotation = (direction + 180) % 360;

  return (
    <g transform={`rotate(${rotation})`}>
      <line
        x1="0" y1="0"
        x2="0" y2={-length}
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <polygon
        points={`-3.5,${-length + 2} 3.5,${-length + 2} 0,${-length - 5}`}
        fill={color}
      />
    </g>
  );
}
