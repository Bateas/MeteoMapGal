import { memo } from 'react';
import { Marker } from 'react-map-gl/maplibre';
import type { NormalizedStation, NormalizedReading } from '../../types/station';
import { temperatureColor, formatTemperature, formatHumidity } from '../../services/windUtils';

interface TempOnlyMarkerProps {
  station: NormalizedStation;
  reading?: NormalizedReading;
}

/**
 * Small, non-selectable marker for Netatmo temp-only stations.
 * Shows as a tiny colored dot with temperature label on hover.
 * These stations feed thermal zone scoring but don't clutter the map.
 */
export const TempOnlyMarker = memo(function TempOnlyMarker({
  station,
  reading,
}: TempOnlyMarkerProps) {
  const temp = reading?.temperature ?? null;
  const humidity = reading?.humidity ?? null;
  const color = temperatureColor(temp);

  return (
    <Marker
      longitude={station.lon}
      latitude={station.lat}
      anchor="center"
    >
      <div
        title={`${station.name}\n${formatTemperature(temp)} · ${formatHumidity(humidity)}\n(solo temp/HR — aporta al scoring térmico)`}
        style={{ cursor: 'default' }}
      >
        <svg width="24" height="24" viewBox="-12 -12 24 24">
          {/* Outer ring */}
          <circle
            r="5"
            fill={color}
            fillOpacity={0.6}
            stroke={color}
            strokeWidth={1}
            strokeOpacity={0.8}
          />
          {/* Inner dot */}
          <circle
            r="2"
            fill="white"
            fillOpacity={0.7}
          />
        </svg>

        {/* Tiny temp label */}
        {temp !== null && (
          <div
            style={{
              position: 'absolute',
              bottom: -1,
              left: '50%',
              transform: 'translateX(-50%)',
              whiteSpace: 'nowrap',
              fontSize: '8px',
              fontWeight: 600,
              color,
              textShadow: '0 0 3px rgba(0,0,0,0.8), 0 0 3px rgba(0,0,0,0.8)',
              pointerEvents: 'none',
              opacity: 0.85,
            }}
          >
            {temp.toFixed(0)}°
          </div>
        )}
      </div>
    </Marker>
  );
});
