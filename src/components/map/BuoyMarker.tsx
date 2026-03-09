/**
 * Map marker for marine buoy stations (Puertos del Estado).
 * Renders as a DOM marker with anchor icon + wave/wind data.
 * Cyan theme to distinguish from weather station markers.
 */
import { memo, useCallback } from 'react';
import { Marker } from 'react-map-gl/maplibre';
import type { BuoyReading } from '../../api/buoyClient';
import { RIAS_BUOY_STATIONS } from '../../api/buoyClient';
import { useBuoyStore } from '../../store/buoyStore';
import { msToKnots } from '../../services/windUtils';

interface BuoyMarkerProps {
  reading: BuoyReading;
  isSelected?: boolean;
}

/** Get lat/lon from the predefined station list */
function getBuoyCoords(stationId: number): { lat: number; lon: number } | null {
  const st = RIAS_BUOY_STATIONS.find((s) => s.id === stationId);
  return st ? { lat: st.lat, lon: st.lon } : null;
}

/** Data freshness color based on timestamp age */
function getBuoyFreshnessColor(timestamp: string): string {
  const age = (Date.now() - new Date(timestamp).getTime()) / 60000;
  if (age < 60) return '#06b6d4';    // cyan — fresh (buoys update hourly)
  if (age < 180) return '#eab308';   // yellow — stale
  return '#6b7280';                  // grey — offline
}

export const BuoyMarker = memo(function BuoyMarker({ reading, isSelected = false }: BuoyMarkerProps) {
  const selectBuoy = useBuoyStore((s) => s.selectBuoy);
  const coords = getBuoyCoords(reading.stationId);
  if (!coords) return null;

  const freshnessColor = getBuoyFreshnessColor(reading.timestamp);
  const hasWaves = reading.waveHeight != null;
  const hasWind = reading.windSpeed != null;

  // Primary display value: wave height (m) or wind (kt) or water temp
  const primaryValue = hasWaves
    ? `${reading.waveHeight!.toFixed(1)}m`
    : hasWind
    ? `${msToKnots(reading.windSpeed!).toFixed(0)}kt`
    : reading.waterTemp != null
    ? `${reading.waterTemp.toFixed(0)}°`
    : '—';

  const handleClick = useCallback((e: { originalEvent: MouseEvent }) => {
    e.originalEvent.stopPropagation();
    selectBuoy(isSelected ? null : reading.stationId);
  }, [selectBuoy, isSelected, reading.stationId]);

  return (
    <Marker
      longitude={coords.lon}
      latitude={coords.lat}
      anchor="center"
      onClick={handleClick}
    >
      <div className="buoy-marker relative cursor-pointer" title={reading.stationName}>
        <svg width="52" height="52" viewBox="-26 -26 52 52" role="img" aria-label={`Boya ${reading.stationName}`}>
          {/* Outer ring — wave-like animation */}
          <circle
            r="20"
            fill="none"
            stroke={freshnessColor}
            strokeWidth="1.5"
            strokeDasharray="4,3"
            opacity="0.4"
          >
            <animateTransform
              attributeName="transform"
              type="rotate"
              values="0;360"
              dur="20s"
              repeatCount="indefinite"
            />
          </circle>

          {/* Main circle — cyan marine theme */}
          <circle
            r="14"
            fill="#0e7490"
            stroke={isSelected ? '#ffffff' : freshnessColor}
            strokeWidth={isSelected ? 3 : 2}
            opacity="0.95"
          />

          {/* Anchor icon (simplified) */}
          <g transform="translate(0, -2)" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <line x1="0" y1="-5" x2="0" y2="5" />
            <circle cx="0" cy="-6" r="1.5" fill="none" />
            <path d="M -5,2 Q -5,6 0,6 Q 5,6 5,2" />
            <line x1="-2" y1="-2" x2="2" y2="-2" />
          </g>

          {/* Wind direction arrow (if available) */}
          {reading.windDir != null && reading.windSpeed != null && reading.windSpeed > 0.5 && (
            <g transform={`rotate(${reading.windDir + 180})`} opacity="0.8">
              <line x1="0" y1="-20" x2="0" y2="-14" stroke="#67e8f9" strokeWidth="1.8" strokeLinecap="round" />
              <polygon points="0,-22 -2.5,-17 2.5,-17" fill="#67e8f9" />
            </g>
          )}
        </svg>

        {/* Primary value badge */}
        <div className="absolute -top-1 -right-1 bg-cyan-900/90 border border-cyan-600/40 rounded px-1 py-0.5 text-[9px] font-mono font-bold text-cyan-200 pointer-events-none whitespace-nowrap">
          {primaryValue}
        </div>

        {/* Station name label */}
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-bold text-slate-900 map-label-halo pointer-events-none">
          {reading.stationName}
        </div>
      </div>
    </Marker>
  );
});
