import { windArrowLength, windSpeedColor } from '../../services/windUtils';

interface WindArrowProps {
  direction: number | null; // degrees from north (meteorological: where wind comes FROM)
  speed: number | null;     // m/s
}

export function WindArrow({ direction, speed }: WindArrowProps) {
  if (direction === null || speed === null || speed < 0.3) {
    return (
      <circle r="4" fill="#94a3b8" opacity={0.5} />
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
