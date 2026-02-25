import { Marker } from 'react-map-gl/maplibre';
import type { NormalizedStation, NormalizedReading } from '../../types/station';
import { WindArrow } from './WindArrow';
import { temperatureColor } from '../../services/windUtils';
import { useWeatherStore } from '../../store/weatherStore';
import { STALE_THRESHOLD_MIN, OFFLINE_THRESHOLD_MIN } from '../../config/constants';

interface StationMarkerProps {
  station: NormalizedStation;
  reading?: NormalizedReading;
}

function getFreshnessColor(reading?: NormalizedReading): string {
  if (!reading || !reading.timestamp || isNaN(reading.timestamp.getTime())) return '#6b7280';
  const ageMin = (Date.now() - reading.timestamp.getTime()) / 60000;
  if (ageMin < STALE_THRESHOLD_MIN) return '#22c55e'; // green
  if (ageMin < OFFLINE_THRESHOLD_MIN) return '#eab308'; // yellow
  return '#6b7280'; // gray (offline)
}

export function StationMarker({ station, reading }: StationMarkerProps) {
  const selectStation = useWeatherStore((s) => s.selectStation);
  const selectedId = useWeatherStore((s) => s.selectedStationId);
  const isSelected = selectedId === station.id;
  const freshnessColor = getFreshnessColor(reading);
  const tempColor = temperatureColor(reading?.temperature ?? null);

  return (
    <Marker
      longitude={station.lon}
      latitude={station.lat}
      anchor="center"
      onClick={(e) => {
        e.originalEvent.stopPropagation();
        selectStation(isSelected ? null : station.id);
      }}
    >
      <div
        className="station-marker"
        title={station.name}
        style={{ cursor: 'pointer' }}
      >
        <svg width="70" height="70" viewBox="-35 -35 70 70">
          {/* Wind arrow */}
          <WindArrow
            direction={reading?.windDirection ?? null}
            speed={reading?.windSpeed ?? null}
          />

          {/* Station dot */}
          <circle
            r="8"
            fill={tempColor}
            stroke={isSelected ? '#ffffff' : freshnessColor}
            strokeWidth={isSelected ? 3 : 2}
          />

          {/* Source indicator */}
          <text
            y="2"
            textAnchor="middle"
            fontSize="7"
            fontWeight="bold"
            fill="white"
            style={{ pointerEvents: 'none' }}
          >
            {station.source === 'aemet' ? 'A' : 'M'}
          </text>
        </svg>

        {/* Station name label */}
        <div
          style={{
            position: 'absolute',
            bottom: -4,
            left: '50%',
            transform: 'translateX(-50%)',
            whiteSpace: 'nowrap',
            fontSize: '10px',
            fontWeight: 600,
            color: '#1e293b',
            textShadow: '0 0 3px white, 0 0 3px white, 0 0 3px white',
            pointerEvents: 'none',
          }}
        >
          {station.name}
        </div>
      </div>
    </Marker>
  );
}
