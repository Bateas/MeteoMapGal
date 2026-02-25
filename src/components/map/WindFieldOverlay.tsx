import { Marker } from 'react-map-gl/maplibre';
import type { NormalizedStation, NormalizedReading } from '../../types/station';
import { windSpeedColor } from '../../services/windUtils';

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

function MiniWindArrow({ rotation, speed, opacity }: { rotation: number; speed: number; opacity: number }) {
  const color = windSpeedColor(speed);

  return (
    <svg width="20" height="20" viewBox="-10 -10 20 20" style={{ opacity }}>
      <g transform={`rotate(${rotation})`}>
        <line
          x1="0" y1="4"
          x2="0" y2="-7"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
        />
        <polygon
          points="-3,-5 3,-5 0,-9"
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
    if (!reading || reading.windDirection === null || reading.windSpeed === null || reading.windSpeed < 0.3) {
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
        opacity: 0.55,
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
        opacity: 0.3,
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
        >
          <MiniWindArrow rotation={a.rotation} speed={a.speed} opacity={a.opacity} />
        </Marker>
      ))}
    </>
  );
}
