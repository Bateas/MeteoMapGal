import { memo, useCallback, useMemo } from 'react';
import { Marker } from 'react-map-gl/maplibre';
import type { NormalizedStation, NormalizedReading } from '../../types/station';
import { WindArrow } from './WindArrow';
import { temperatureColor, msToKnots, degreesToCardinal } from '../../services/windUtils';
import { useWeatherSelectionStore } from '../../store/weatherSelectionStore';
import { STALE_THRESHOLD_MIN, OFFLINE_THRESHOLD_MIN } from '../../config/constants';
import { SOURCE_CONFIG } from '../../config/sourceConfig';

interface StationMarkerProps {
  station: NormalizedStation;
  reading?: NormalizedReading;
  /** Passed from parent to avoid each marker subscribing to selectedStationId */
  isSelected?: boolean;
  /** Hide text label at low zoom to reduce clutter */
  showLabel?: boolean;
  /** Current map zoom level for progressive scaling */
  zoomLevel?: number;
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

/**
 * Zoom-dependent scale for station markers.
 * Spots stay full size; stations shrink at low zoom to avoid overwhelming.
 * zoom <9.5 → 0.45 (tiny dot), 9.5-11 → 0.55-0.75, 11-12 → 0.75-0.9, ≥12 → 1.0
 */
function getZoomScale(zoom: number): number {
  if (zoom >= 12) return 1;
  if (zoom >= 11) return 0.75 + (zoom - 11) * 0.25; // 0.75→1.0
  if (zoom >= 9.5) return 0.55 + (zoom - 9.5) * (0.2 / 1.5); // 0.55→0.75
  return 0.45;
}

export const StationMarker = memo(function StationMarker({
  station, reading, isSelected = false, showLabel = true, zoomLevel = 12,
}: StationMarkerProps) {
  const selectStation = useWeatherSelectionStore((s) => s.selectStation);
  const freshnessColor = getFreshnessColor(reading);
  const freshnessOpacity = getFreshnessOpacity(reading);
  const tempColor = temperatureColor(reading?.temperature ?? null);
  const scale = getZoomScale(zoomLevel);
  const isCompact = zoomLevel < 11;

  const handleClick = useCallback((e: { originalEvent: MouseEvent }) => {
    e.originalEvent.stopPropagation();
    selectStation(isSelected ? null : station.id);
  }, [selectStation, isSelected, station.id]);

  // Rich tooltip with wind + temp (no extra renders — pure string)
  const tooltip = useMemo(() => {
    const src = SOURCE_CONFIG[station.source]?.fullName ?? station.source;
    const parts = [`${station.name} (${src})`];
    if (reading) {
      if (reading.windSpeed != null) {
        const kt = msToKnots(reading.windSpeed).toFixed(0);
        const dir = reading.windDirection != null ? degreesToCardinal(reading.windDirection) : '';
        parts.push(`Viento: ${dir} ${kt} kt`);
      }
      if (reading.windGust != null && reading.windGust > 0) {
        parts.push(`Racha: ${msToKnots(reading.windGust).toFixed(0)} kt`);
      }
      if (reading.temperature != null) {
        parts.push(`Temp: ${reading.temperature.toFixed(1)}°C`);
      }
      if (reading.humidity != null) {
        parts.push(`Hum: ${reading.humidity.toFixed(0)}%`);
      }
    } else {
      parts.push('Sin datos');
    }
    return parts.join('\n');
  }, [station.name, station.source, reading]);

  return (
    <Marker
      longitude={station.lon}
      latitude={station.lat}
      anchor="center"
      onClick={handleClick}
    >
      <div
        className="station-marker cursor-pointer"
        title={tooltip}
        style={{
          opacity: freshnessOpacity,
          transform: scale < 1 ? `scale(${scale})` : undefined,
          transition: 'transform 0.3s ease-out, opacity 0.3s ease-out',
        }}
      >
        <svg width="90" height="90" viewBox="-45 -45 90 90" role="img" aria-label={`Estación ${station.name}`} style={{ pointerEvents: 'none' }}>
          {/* Wind arrow — hidden at very low zoom for cleaner look */}
          {!isCompact && (
            <WindArrow
              direction={reading?.windDirection ?? null}
              speed={reading?.windSpeed ?? null}
            />
          )}

          {/* Clickable hit area */}
          <circle r="22" fill="transparent" style={{ pointerEvents: 'auto' }} />

          {/* Station dot */}
          <circle
            r={isCompact ? 10 : 12}
            fill={tempColor}
            stroke={isSelected ? '#ffffff' : freshnessColor}
            strokeWidth={isSelected ? 3.5 : 2.5}
            style={{ pointerEvents: 'none' }}
          />

          {/* Source indicator */}
          <text
            y="3"
            textAnchor="middle"
            fontSize={isCompact ? 8 : 9}
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

        {/* Station name label — hidden at low zoom */}
        {showLabel && (
          <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-bold text-slate-900 map-label-halo pointer-events-none">
            {station.name}
          </div>
        )}
      </div>
    </Marker>
  );
});
