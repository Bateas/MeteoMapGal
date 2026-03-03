import { memo, useMemo } from 'react';
import { Marker } from 'react-map-gl/maplibre';
import { useThermalStore } from '../../store/thermalStore';

// ── Single arrow marker (memoized) ──────────────────────────

interface ArrowProps {
  lon: number;
  lat: number;
  angle: number;
  estimatedMin: number;
}

const Arrow = memo(function Arrow({ lon, lat, angle, estimatedMin }: ArrowProps) {
  return (
    <Marker longitude={lon} latitude={lat} anchor="center">
      <div className="flex flex-col items-center">
        {/* Arrow — single shared arrowhead def */}
        <svg
          width="40"
          height="20"
          viewBox="0 0 40 20"
          style={{ transform: `rotate(${90 - angle}deg)` }}
        >
          <defs>
            <marker
              id="prop-arrowhead"
              markerWidth="6"
              markerHeight="4"
              refX="5"
              refY="2"
              orient="auto"
            >
              <polygon points="0 0, 6 2, 0 4" fill="#60a5fa" />
            </marker>
          </defs>
          <line
            x1="2"
            y1="10"
            x2="34"
            y2="10"
            stroke="#60a5fa"
            strokeWidth="2"
            strokeDasharray="4 2"
            markerEnd="url(#prop-arrowhead)"
          />
        </svg>
        {/* Label */}
        <div
          className="text-[8px] font-mono px-1.5 py-0.5 rounded mt-0.5"
          style={{
            background: 'rgba(30, 41, 59, 0.85)',
            color: '#60a5fa',
            border: '1px solid rgba(96, 165, 250, 0.3)',
          }}
        >
          ~{estimatedMin}min
        </div>
      </div>
    </Marker>
  );
});

// ── Container ──────────────────────────────────────────────

export function PropagationArrows() {
  const zones = useThermalStore((s) => s.zones);
  const propagationEvents = useThermalStore((s) => s.propagationEvents);
  const showZoneOverlays = useThermalStore((s) => s.showZoneOverlays);

  // Pre-compute arrow data (avoids .find() inside JSX on every render)
  const arrows = useMemo(() => {
    if (!showZoneOverlays || propagationEvents.length === 0) return [];
    const result: ArrowProps[] = [];
    for (const event of propagationEvents) {
      const source = zones.find((z) => z.id === event.sourceZone);
      const target = zones.find((z) => z.id === event.targetZone);
      if (!source || !target) continue;

      const midLat = (source.center.lat + target.center.lat) / 2;
      const midLon = (source.center.lon + target.center.lon) / 2;
      const dLon = target.center.lon - source.center.lon;
      const dLat = target.center.lat - source.center.lat;
      const angle = (Math.atan2(dLon, dLat) * 180) / Math.PI;

      result.push({
        lon: midLon,
        lat: midLat,
        angle,
        estimatedMin: event.estimatedArrivalMin,
      });
    }
    return result;
  }, [zones, propagationEvents, showZoneOverlays]);

  if (arrows.length === 0) return null;

  return (
    <>
      {arrows.map((props, i) => (
        <Arrow key={i} {...props} />
      ))}
    </>
  );
}
