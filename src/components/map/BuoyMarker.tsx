/**
 * Map marker for marine buoy stations (Puertos del Estado).
 *
 * Visual design:
 * - Cyan anchor icon (core identity)
 * - WindArrow: SHARED component with weather stations (identical visual)
 * - CurrentArrow: teal dashed arrow showing current direction/speed
 * - WaveGlyph: SVG wave indicator — amplitude scales with wave height,
 *   peaks sharpen with bigger waves. Direction shown by glyph rotation.
 * - Badges: wave height (top-right), wind speed (top-left),
 *   water temperature (bottom-right), current speed (bottom-left)
 *
 * Color scales from buoyUtils.ts — shared with BuoyPopup and BuoyPanel.
 */
import { memo, useCallback } from 'react';
import { Marker } from 'react-map-gl/maplibre';
import type { BuoyReading } from '../../api/buoyClient';
import { RIAS_BUOY_STATIONS } from '../../api/buoyClient';
import { useBuoyStore } from '../../store/buoyStore';
import { WindArrow } from './WindArrow';
import { msToKnots, windSpeedColor } from '../../services/windUtils';
import { waveHeightColor, waterTempColor, currentSpeedColor } from '../../services/buoyUtils';

interface BuoyMarkerProps {
  reading: BuoyReading;
  isSelected?: boolean;
}

/** Buoy station coordinates lookup */
const BUOY_COORDS = new Map(
  RIAS_BUOY_STATIONS.map((s) => [s.id, { lat: s.lat, lon: s.lon }]),
);

/** Data freshness color based on timestamp age */
function freshnessColor(timestamp: string): string {
  const age = (Date.now() - new Date(timestamp).getTime()) / 60000;
  if (age < 60) return '#06b6d4';    // cyan — fresh (buoys update hourly)
  if (age < 180) return '#eab308';   // yellow — stale
  return '#6b7280';                  // grey — offline
}

// ── WaveGlyph — improved SVG wave indicator ──────────────
// Multiple wave crests with amplitude and sharpness that scale with Hm0.
// Calm seas → gentle curves. Rough seas → tall peaked waves with spray.
// Direction shown by glyph rotation (oceanographic "from" convention).
// Includes period info via spacing: short period = tighter waves.
function WaveGlyph({ height, dir, period }: { height: number; dir: number | null; period: number | null }) {
  const color = waveHeightColor(height);
  // Amplitude: 2.5px (calm 0m) → 9px (rough 4m+)
  const amp = Math.min(2.5 + height * 2, 9);
  // Sharpness: 0 = smooth sine, 1 = peaked. Scale with wave height.
  const sharp = Math.min(height / 3.5, 0.9);
  // Control point horizontal squeeze: smaller = more peaked
  const cpx = 5 * (1 - sharp * 0.6);
  // Wave spacing: shorter period → tighter waves (default ~8s)
  const spacing = period != null ? Math.max(4, Math.min(period * 0.8, 7)) : 5;

  // Build wave crests as quadratic bezier arcs
  const y0 = 0;
  const halfW = spacing * 3;
  const wave = `
    M ${-halfW},${y0}
    Q ${-halfW + cpx},${y0 - amp} ${-halfW + spacing},${y0}
    Q ${-halfW + spacing + cpx},${y0 + amp * 0.3} ${-halfW + spacing * 2},${y0}
    Q ${-halfW + spacing * 2 + cpx},${y0 - amp} ${-halfW + spacing * 3},${y0}
    Q ${-halfW + spacing * 3 + cpx},${y0 + amp * 0.3} ${-halfW + spacing * 4},${y0}
    Q ${-halfW + spacing * 4 + cpx},${y0 - amp} ${-halfW + spacing * 5},${y0}
    Q ${-halfW + spacing * 5 + cpx},${y0 + amp * 0.3} ${halfW},${y0}
  `;

  const rotation = dir != null ? dir : 0;

  return (
    <g transform={`rotate(${rotation})`} opacity="0.85">
      {/* Primary wave crest */}
      <g transform="translate(0, 20)">
        <path
          d={wave}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
        />
        {/* Secondary wave behind — subtler, offset */}
        <g transform="translate(1.5, 4)" opacity="0.35">
          <path
            d={wave}
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </g>
        {/* Spray dots for rough seas (Hm0 > 2m) */}
        {height > 2 && (
          <g opacity={Math.min((height - 2) * 0.3, 0.6)}>
            <circle cx={-spacing} cy={-amp - 2} r="1" fill={color} />
            <circle cx={spacing * 0.5} cy={-amp - 3} r="0.8" fill={color} />
            <circle cx={spacing * 2} cy={-amp - 1.5} r="1.2" fill={color} />
          </g>
        )}
      </g>
    </g>
  );
}

// ── Current arrow — teal dashed indicator ─────────────────
// Distinct from wind arrow: dashed line, teal color, smaller, with
// a wave-like arrowhead. Current direction is oceanographic "going to".
function CurrentArrow({ speed, dir }: { speed: number; dir: number }) {
  const color = currentSpeedColor(speed);
  // Length: 12px (slow) → 28px (fast). Currents are typically 0-0.5 m/s.
  const length = Math.min(12 + speed * 40, 28);

  return (
    <g transform={`rotate(${dir})`} opacity="0.85">
      <line
        x1="0" y1="0"
        x2="0" y2={-length}
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="3,2"
      />
      {/* Smaller arrowhead */}
      <polygon
        points={`-3,${-length + 2} 3,${-length + 2} 0,${-length - 4}`}
        fill={color}
      />
    </g>
  );
}

export const BuoyMarker = memo(function BuoyMarker({ reading, isSelected = false }: BuoyMarkerProps) {
  const selectBuoy = useBuoyStore((s) => s.selectBuoy);
  const coords = BUOY_COORDS.get(reading.stationId);
  if (!coords) return null;

  const fColor = freshnessColor(reading.timestamp);
  const hasWaves = reading.waveHeight != null;
  const hasWind = reading.windSpeed != null && reading.windSpeed > 0.3;
  const hasWaterTemp = reading.waterTemp != null;
  const hasCurrent = reading.currentSpeed != null && reading.currentSpeed > 0.01 && reading.currentDir != null;

  const windKt = hasWind ? msToKnots(reading.windSpeed!) : 0;

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
        <svg width="90" height="90" viewBox="-45 -45 90 90" role="img" aria-label={`Boya ${reading.stationName}`}>
          {/* ── Wind arrow — SHARED component with StationMarker ── */}
          <WindArrow
            direction={reading.windDir ?? null}
            speed={reading.windSpeed ?? null}
          />

          {/* ── Current direction arrow (dashed teal, distinct from wind) ── */}
          {hasCurrent && (
            <CurrentArrow speed={reading.currentSpeed!} dir={reading.currentDir!} />
          )}

          {/* ── Wave direction glyph ── */}
          {hasWaves && (
            <WaveGlyph
              height={reading.waveHeight!}
              dir={reading.waveDir}
              period={reading.wavePeriod}
            />
          )}

          {/* Outer ring — animated dashes (marine identity) */}
          <circle
            r="16"
            fill="none"
            stroke={fColor}
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
            r="12"
            fill="#0e7490"
            stroke={isSelected ? '#ffffff' : fColor}
            strokeWidth={isSelected ? 3 : 2}
            opacity="0.95"
          />

          {/* Anchor icon (simplified) */}
          <g transform="translate(0, -1)" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <line x1="0" y1="-5" x2="0" y2="5" />
            <circle cx="0" cy="-6" r="1.5" fill="none" />
            <path d="M -5,2 Q -5,6 0,6 Q 5,6 5,2" />
            <line x1="-2" y1="-2" x2="2" y2="-2" />
          </g>
        </svg>

        {/* ── Wave height badge (top-right) ── */}
        {hasWaves && (
          <div
            className="absolute -top-1 -right-1 rounded px-1 py-0.5 pointer-events-none whitespace-nowrap border"
            style={{
              fontSize: 9,
              fontWeight: 700,
              fontFamily: 'ui-monospace, monospace',
              background: `${waveHeightColor(reading.waveHeight!)}18`,
              borderColor: `${waveHeightColor(reading.waveHeight!)}60`,
              color: waveHeightColor(reading.waveHeight!),
            }}
          >
            {reading.waveHeight!.toFixed(1)}m
          </div>
        )}

        {/* ── Wind speed badge (top-left) ── */}
        {hasWind && (
          <div
            className="absolute -top-1 -left-2 rounded px-1 py-0.5 pointer-events-none whitespace-nowrap border"
            style={{
              fontSize: 9,
              fontWeight: 700,
              fontFamily: 'ui-monospace, monospace',
              background: `${windSpeedColor(reading.windSpeed)}18`,
              borderColor: `${windSpeedColor(reading.windSpeed)}60`,
              color: windSpeedColor(reading.windSpeed),
            }}
          >
            {windKt.toFixed(0)}kt
          </div>
        )}

        {/* ── Water temperature badge (bottom-right) ── */}
        {hasWaterTemp && (
          <div
            className="absolute -bottom-2 -right-1 rounded px-1 py-0.5 pointer-events-none whitespace-nowrap border"
            style={{
              fontSize: 9,
              fontWeight: 600,
              fontFamily: 'ui-monospace, monospace',
              background: `${waterTempColor(reading.waterTemp!)}18`,
              borderColor: `${waterTempColor(reading.waterTemp!)}60`,
              color: waterTempColor(reading.waterTemp!),
            }}
          >
            {reading.waterTemp!.toFixed(1)}°
          </div>
        )}

        {/* ── Current speed badge (bottom-left) ── */}
        {hasCurrent && (
          <div
            className="absolute -bottom-2 -left-2 rounded px-1 py-0.5 pointer-events-none whitespace-nowrap border"
            style={{
              fontSize: 9,
              fontWeight: 600,
              fontFamily: 'ui-monospace, monospace',
              background: `${currentSpeedColor(reading.currentSpeed!)}18`,
              borderColor: `${currentSpeedColor(reading.currentSpeed!)}60`,
              color: currentSpeedColor(reading.currentSpeed!),
            }}
          >
            {(reading.currentSpeed! * 100).toFixed(0)}cm/s
          </div>
        )}

        {/* Station name label */}
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 translate-y-full whitespace-nowrap text-[10px] font-bold text-slate-900 map-label-halo pointer-events-none">
          {reading.stationName}
        </div>
      </div>
    </Marker>
  );
});
