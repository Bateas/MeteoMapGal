import { Marker } from 'react-map-gl/maplibre';
import { useThermalStore } from '../../store/thermalStore';

export function PropagationArrows() {
  const zones = useThermalStore((s) => s.zones);
  const propagationEvents = useThermalStore((s) => s.propagationEvents);
  const showZoneOverlays = useThermalStore((s) => s.showZoneOverlays);

  if (!showZoneOverlays || propagationEvents.length === 0) return null;

  return (
    <>
      {propagationEvents.map((event, i) => {
        const sourceZone = zones.find((z) => z.id === event.sourceZone);
        const targetZone = zones.find((z) => z.id === event.targetZone);
        if (!sourceZone || !targetZone) return null;

        // Midpoint for the label
        const midLat = (sourceZone.center.lat + targetZone.center.lat) / 2;
        const midLon = (sourceZone.center.lon + targetZone.center.lon) / 2;

        // Arrow angle
        const dLon = targetZone.center.lon - sourceZone.center.lon;
        const dLat = targetZone.center.lat - sourceZone.center.lat;
        const angle = (Math.atan2(dLon, dLat) * 180) / Math.PI;

        return (
          <Marker
            key={i}
            longitude={midLon}
            latitude={midLat}
            anchor="center"
          >
            <div className="flex flex-col items-center">
              {/* Arrow */}
              <svg
                width="40"
                height="20"
                viewBox="0 0 40 20"
                style={{ transform: `rotate(${90 - angle}deg)` }}
              >
                <defs>
                  <marker
                    id={`arrowhead-${i}`}
                    markerWidth="6"
                    markerHeight="4"
                    refX="5"
                    refY="2"
                    orient="auto"
                  >
                    <polygon
                      points="0 0, 6 2, 0 4"
                      fill="#60a5fa"
                    />
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
                  markerEnd={`url(#arrowhead-${i})`}
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
                ~{event.estimatedArrivalMin}min
              </div>
            </div>
          </Marker>
        );
      })}
    </>
  );
}
