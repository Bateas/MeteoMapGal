import { memo, useCallback } from 'react';
import { Marker } from 'react-map-gl/maplibre';
import type { NormalizedStation, NormalizedReading } from '../../types/station';
import { WindArrow } from './WindArrow';
import { temperatureColor } from '../../services/windUtils';
import { useWeatherStore } from '../../store/weatherStore';
import { STALE_THRESHOLD_MIN, OFFLINE_THRESHOLD_MIN } from '../../config/constants';

interface StationMarkerProps {
  station: NormalizedStation;
  reading?: NormalizedReading;
  /** Passed from parent to avoid each marker subscribing to selectedStationId */
  isSelected?: boolean;
}

function getFreshnessColor(reading?: NormalizedReading): string {
  if (!reading || !reading.timestamp || isNaN(reading.timestamp.getTime())) return '#6b7280';
  const ageMin = (Date.now() - reading.timestamp.getTime()) / 60000;
  if (ageMin < STALE_THRESHOLD_MIN) return '#22c55e';
  if (ageMin < OFFLINE_THRESHOLD_MIN) return '#eab308';
  return '#6b7280';
}

/** Reduce opacity for stale/offline stations so they don't mislead */
function getFreshnessOpacity(reading?: NormalizedReading): number {
  if (!reading || !reading.timestamp || isNaN(reading.timestamp.getTime())) return 0.4;
  const ageMin = (Date.now() - reading.timestamp.getTime()) / 60000;
  if (ageMin < STALE_THRESHOLD_MIN) return 1;
  if (ageMin < OFFLINE_THRESHOLD_MIN) return 0.6;
  return 0.4;
}

export const StationMarker = memo(function StationMarker({ station, reading, isSelected = false }: StationMarkerProps) {
  // Only subscribe to the action (stable ref), NOT to selectedStationId
  const selectStation = useWeatherStore((s) => s.selectStation);
  const freshnessColor = getFreshnessColor(reading);
  const freshnessOpacity = getFreshnessOpacity(reading);
  const tempColor = temperatureColor(reading?.temperature ?? null);

  const handleClick = useCallback((e: { originalEvent: MouseEvent }) => {
    e.originalEvent.stopPropagation();
    selectStation(isSelected ? null : station.id);
  }, [selectStation, isSelected, station.id]);

  return (
    <Marker
      longitude={station.lon}
      latitude={station.lat}
      anchor="center"
      onClick={handleClick}
    >
      <div className="station-marker cursor-pointer" title={station.name} style={freshnessOpacity < 1 ? { opacity: freshnessOpacity } : undefined}>
        <svg width="90" height="90" viewBox="-45 -45 90 90" role="img" aria-label={`Estación ${station.name}`} style={{ pointerEvents: 'none' }}>
          {/* Wind arrow */}
          <WindArrow
            direction={reading?.windDirection ?? null}
            speed={reading?.windSpeed ?? null}
          />

          {/* Clickable hit area (tighter than full SVG to avoid blocking spot markers) */}
          <circle r="22" fill="transparent" style={{ pointerEvents: 'auto' }} />

          {/* Station dot */}
          <circle
            r="12"
            fill={tempColor}
            stroke={isSelected ? '#ffffff' : freshnessColor}
            strokeWidth={isSelected ? 3.5 : 2.5}
            style={{ pointerEvents: 'none' }}
          />

          {/* Source indicator */}
          <text
            y="3"
            textAnchor="middle"
            fontSize="9"
            fontWeight="bold"
            fill="white"
            className="pointer-events-none"
          >
            {station.source === 'aemet' ? 'A'
              : station.source === 'meteoclimatic' ? 'C'
              : station.source === 'wunderground' ? 'W'
              : station.source === 'netatmo' ? 'N'
              : station.source === 'skyx' ? 'S'
              : 'M'}
          </text>
        </svg>

        {/* Station name label */}
        <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-bold text-slate-900 map-label-halo pointer-events-none">
          {station.name}
        </div>
      </div>
    </Marker>
  );
});
