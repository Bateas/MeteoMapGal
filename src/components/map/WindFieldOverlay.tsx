import { Marker } from 'react-map-gl/maplibre';
import type { NormalizedStation, NormalizedReading } from '../../types/station';

interface WindFieldOverlayProps {
  stations: NormalizedStation[];
  readings: Map<string, NormalizedReading>;
}

/** Offset distance in degrees (~2km at lat 42°) */
const OFFSET_LAT = 0.018;
const OFFSET_LON = 0.024;

/** Positions around each station (hex pattern) */
const OFFSETS = [
  [0, 1],            // N
  [0.866, 0.5],      // NE
  [0.866, -0.5],     // SE
  [0, -1],           // S
  [-0.866, -0.5],    // SW
  [-0.866, 0.5],     // NW
] as const;

/** Second ring (farther, more transparent) */
const OFFSETS_OUTER = [
  [0.5, 0.866],      // NNE
  [1, 0],            // E
  [0.5, -0.866],     // SSE
  [-0.5, -0.866],    // SSW
  [-1, 0],           // W
  [-0.5, 0.866],     // NNW
] as const;

interface ArrowData {
  key: string;
  lon: number;
  lat: number;
  rotation: number;
  speed: number;
  opacity: number;
}

/** Wind field arrows use brighter colors than station markers */
function fieldArrowColor(speed: number): string {
  if (speed < 0.5) return '#60a5fa';   // blue-400 (light breeze visible)
  if (speed < 2) return '#38bdf8';     // sky-400
  if (speed < 5) return '#34d399';     // emerald-400
  if (speed < 8) return '#fbbf24';     // amber-400
  if (speed < 12) return '#f97316';    // orange-500
  return '#ef4444';                    // red-500
}

function MiniWindArrow({ rotation, speed }: { rotation: number; speed: number }) {
  const color = fieldArrowColor(speed);

  return (
    <svg width="22" height="22" viewBox="-11 -11 22 22" style={{ pointerEvents: 'none' }}>
      {/* Dark background circle for contrast */}
      <circle r="10" fill="#0f172a" opacity={0.5} />
      <g transform={`rotate(${rotation})`}>
        <line
          x1="0" y1="4"
          x2="0" y2="-6"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <polygon
          points="-3.5,-4.5 3.5,-4.5 0,-9"
          fill={color}
        />
      </g>
    </svg>
  );
}

export function WindFieldOverlay({ stations, readings }: WindFieldOverlayProps) {
  const arrows: ArrowData[] = [];

  for (const station of stations) {
    const reading = readings.get(station.id);
    if (!reading || reading.windDirection === null || reading.windSpeed === null || reading.windSpeed < 0.1) {
      continue;
    }

    // Arrow points where wind goes TO
    const rotation = (reading.windDirection + 180) % 360;

    // Inner ring
    for (let i = 0; i < OFFSETS.length; i++) {
      const [dx, dy] = OFFSETS[i];
      arrows.push({
        key: `${station.id}-i${i}`,
        lon: station.lon + dx * OFFSET_LON,
        lat: station.lat + dy * OFFSET_LAT,
        rotation,
        speed: reading.windSpeed,
        opacity: 0.7,
      });
    }

    // Outer ring
    for (let i = 0; i < OFFSETS_OUTER.length; i++) {
      const [dx, dy] = OFFSETS_OUTER[i];
      arrows.push({
        key: `${station.id}-o${i}`,
        lon: station.lon + dx * OFFSET_LON * 1.8,
        lat: station.lat + dy * OFFSET_LAT * 1.8,
        rotation,
        speed: reading.windSpeed,
        opacity: 0.45,
      });
    }
  }

  return (
    <>
      {arrows.map((a) => (
        <Marker
          key={a.key}
          longitude={a.lon}
          latitude={a.lat}
          anchor="center"
          style={{ opacity: a.opacity }}
        >
          <MiniWindArrow rotation={a.rotation} speed={a.speed} />
        </Marker>
      ))}
    </>
  );
}
