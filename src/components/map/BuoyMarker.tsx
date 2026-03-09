/**
 * Map marker for marine buoy stations (Puertos del Estado).
 * Renders as a DOM marker with anchor icon + visual data:
 * - Wave height badge (top-right, cyan)
 * - Wind speed + direction arrow (color-coded like weather stations)
 * - Water temperature badge (bottom-right, blue)
 * - Wave direction indicator (separate from wind, dashed cyan)
 *
 * Cyan theme to distinguish from weather station markers.
 */
import { memo, useCallback } from 'react';
import { Marker } from 'react-map-gl/maplibre';
import type { BuoyReading } from '../../api/buoyClient';
import { RIAS_BUOY_STATIONS } from '../../api/buoyClient';
import { useBuoyStore } from '../../store/buoyStore';
import { msToKnots, windSpeedColor } from '../../services/windUtils';

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

/** Wave height color */
function waveColor(h: number): string {
  if (h < 0.5) return '#22c55e';  // green — calm
  if (h < 1.0) return '#a3e635';  // lime — slight
  if (h < 2.0) return '#eab308';  // yellow — moderate
  if (h < 3.0) return '#f97316';  // orange — rough
  return '#ef4444';               // red — high
}

/** Water temp color */
function waterTempColor(t: number): string {
  if (t < 12) return '#60a5fa';   // blue-400
  if (t < 15) return '#22d3ee';   // cyan-400
  if (t < 18) return '#34d399';   // emerald-400
  return '#fbbf24';               // amber-400
}

export const BuoyMarker = memo(function BuoyMarker({ reading, isSelected = false }: BuoyMarkerProps) {
  const selectBuoy = useBuoyStore((s) => s.selectBuoy);
  const coords = getBuoyCoords(reading.stationId);
  if (!coords) return null;

  const freshnessColor = getBuoyFreshnessColor(reading.timestamp);
  const hasWaves = reading.waveHeight != null;
  const hasWind = reading.windSpeed != null && reading.windSpeed > 0.5;
  const hasWaterTemp = reading.waterTemp != null;

  const windKt = hasWind ? msToKnots(reading.windSpeed!) : 0;
  const windColor = hasWind ? windSpeedColor(reading.windSpeed) : '#64748b';

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
        <svg width="60" height="60" viewBox="-30 -30 60 60" role="img" aria-label={`Boya ${reading.stationName}`}>
          {/* Outer ring — wave-like animation */}
          <circle
            r="22"
            fill="none"
            stroke={freshnessColor}
            strokeWidth="1.5"
            strokeDasharray="4,3"
            opacity="0.35"
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

          {/* Wind direction arrow — same style as StationMarker (color-coded) */}
          {hasWind && reading.windDir != null && (
            <g transform={`rotate(${reading.windDir + 180})`}>
              <line x1="0" y1="-22" x2="0" y2="-14" stroke={windColor} strokeWidth="2" strokeLinecap="round" />
              <polygon points="0,-24 -3,-18 3,-18" fill={windColor} />
            </g>
          )}

          {/* Wave direction indicator — dashed arrow, distinct from wind */}
          {reading.waveDir != null && hasWaves && (
            <g transform={`rotate(${reading.waveDir})`} opacity="0.6">
              <line x1="0" y1="14" x2="0" y2="22" stroke="#67e8f9" strokeWidth="1.5" strokeDasharray="2,2" strokeLinecap="round" />
              <polygon points="0,24 -2,20 2,20" fill="#67e8f9" opacity="0.7" />
            </g>
          )}
        </svg>

        {/* ── Wave height badge (top-right) ── */}
        {hasWaves && (
          <div
            className="absolute -top-2 -right-2 rounded px-1 py-0.5 pointer-events-none whitespace-nowrap border"
            style={{
              fontSize: 9,
              fontWeight: 700,
              fontFamily: 'ui-monospace, monospace',
              background: `${waveColor(reading.waveHeight!)}18`,
              borderColor: `${waveColor(reading.waveHeight!)}60`,
              color: waveColor(reading.waveHeight!),
            }}
          >
            🌊 {reading.waveHeight!.toFixed(1)}m
          </div>
        )}

        {/* ── Wind speed badge (top-left) ── */}
        {hasWind && (
          <div
            className="absolute -top-2 -left-3 rounded px-1 py-0.5 pointer-events-none whitespace-nowrap border"
            style={{
              fontSize: 9,
              fontWeight: 700,
              fontFamily: 'ui-monospace, monospace',
              background: `${windColor}18`,
              borderColor: `${windColor}60`,
              color: windColor,
            }}
          >
            {windKt.toFixed(0)}kt
          </div>
        )}

        {/* ── Water temperature badge (bottom-right) ── */}
        {hasWaterTemp && (
          <div
            className="absolute -bottom-3 -right-2 rounded px-1 py-0.5 pointer-events-none whitespace-nowrap border"
            style={{
              fontSize: 9,
              fontWeight: 600,
              fontFamily: 'ui-monospace, monospace',
              background: `${waterTempColor(reading.waterTemp!)}18`,
              borderColor: `${waterTempColor(reading.waterTemp!)}60`,
              color: waterTempColor(reading.waterTemp!),
            }}
          >
            💧{reading.waterTemp!.toFixed(1)}°
          </div>
        )}

        {/* Station name label */}
        <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 translate-y-full whitespace-nowrap text-[10px] font-bold text-slate-900 map-label-halo pointer-events-none">
          {reading.stationName}
        </div>
      </div>
    </Marker>
  );
});
