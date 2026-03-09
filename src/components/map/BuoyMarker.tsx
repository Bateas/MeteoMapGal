/**
 * Map marker for marine buoy stations (Puertos del Estado).
 *
 * Visual design:
 * - Cyan anchor icon (core identity)
 * - WindArrow: SHARED component with weather stations — solid arrow, warm colors
 * - CurrentArrow: DOTTED blue arrow with open chevron — visually distinct from wind
 * - WaveGlyph: 3-crest wave line — amplitude scales with wave height
 * - 4 corner badges: wave height, wind speed, water temp, current speed
 *   Dark near-opaque backgrounds with glow text for ocean map contrast.
 *
 * All directional indicators wrapped in CSS drop-shadow group for
 * visibility on light-blue ocean backgrounds.
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

/** CSS drop-shadow for SVG groups — dark halo for ocean contrast */
const ARROW_SHADOW: React.CSSProperties = {
  filter: 'drop-shadow(0 0 2.5px rgba(15, 23, 42, 0.7))',
};

// ── WaveGlyph — simplified 3-crest SVG wave indicator ─────────
// 3 wave peaks with amplitude that scales with Hm0.
// Calm seas → gentle curves. Rough seas → tall peaked waves with spray.
// Direction shown by glyph rotation (oceanographic "from" convention).
function WaveGlyph({ height, dir, period }: { height: number; dir: number | null; period: number | null }) {
  const color = waveHeightColor(height);
  // Amplitude: 3px (calm 0m) → 9px (rough 4m+)
  const amp = Math.min(3 + height * 1.8, 9);
  // Sharpness: 0 = smooth sine, 1 = peaked. Scale with wave height.
  const sharp = Math.min(height / 3.5, 0.85);
  // Control point horizontal offset: smaller = sharper peaks
  const cpx = 4 * (1 - sharp * 0.5);
  // Wave spacing: shorter period → tighter waves (default ~8s)
  const sp = period != null ? Math.max(5, Math.min(period * 0.9, 8)) : 6;

  // 3-crest wave: alternating up/down bezier arcs
  const halfW = sp * 3; // total width = 6 × spacing
  const wave = `
    M ${-halfW},0
    Q ${-halfW + cpx},${-amp} ${-halfW + sp},0
    Q ${-halfW + sp + cpx},${amp * 0.25} ${-halfW + sp * 2},0
    Q ${-halfW + sp * 2 + cpx},${-amp} ${-halfW + sp * 3},0
    Q ${-halfW + sp * 3 + cpx},${amp * 0.25} ${-halfW + sp * 4},0
    Q ${-halfW + sp * 4 + cpx},${-amp} ${-halfW + sp * 5},0
    Q ${-halfW + sp * 5 + cpx},${amp * 0.25} ${halfW},0
  `;

  const rotation = dir != null ? dir : 0;

  return (
    <g transform={`rotate(${rotation})`}>
      <g transform="translate(0, 22)">
        {/* Primary wave crest — thicker for visibility */}
        <path
          d={wave}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        {/* Spray dots for rough seas (Hm0 > 2m) */}
        {height > 2 && (
          <g opacity={Math.min((height - 2) * 0.35, 0.65)}>
            <circle cx={-sp * 0.5} cy={-amp - 2} r="1.2" fill={color} />
            <circle cx={sp * 0.5} cy={-amp - 3} r="1" fill={color} />
            <circle cx={sp * 1.3} cy={-amp - 1.5} r="1.3" fill={color} />
          </g>
        )}
      </g>
    </g>
  );
}

// ── Current arrow — DOTTED blue indicator with chevron tip ─────
// Visually distinct from wind arrow:
//   Wind:    solid line + filled triangle tip (warm colors)
//   Current: round dots + open chevron tip (cool colors)
// Current direction is oceanographic "going to".
function CurrentArrow({ speed, dir }: { speed: number; dir: number }) {
  const color = currentSpeedColor(speed);
  // Length: 14px (slow) → 30px (fast). Currents are typically 0–0.5 m/s.
  const length = Math.min(14 + speed * 40, 30);

  return (
    <g transform={`rotate(${dir})`}>
      {/* Dotted shaft — round dots via zero-length dash + round linecap */}
      <line
        x1="0" y1="0"
        x2="0" y2={-length + 4}
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="0.5,5"
      />
      {/* Open chevron arrowhead — distinct from wind's filled triangle */}
      <polyline
        points={`-5,${-length + 5} 0,${-length - 3} 5,${-length + 5}`}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
}

/** Badge style factory — high-contrast dark bg with glow text */
function badgeStyle(color: string, position: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left') {
  const posClass = {
    'top-right': '-top-3.5 -right-3',
    'top-left': '-top-3.5 -left-4',
    'bottom-right': '-bottom-4 -right-3',
    'bottom-left': '-bottom-4 -left-4',
  }[position];

  return {
    className: `absolute ${posClass} rounded px-1.5 py-0.5 pointer-events-none whitespace-nowrap border`,
    style: {
      fontSize: 11,
      fontWeight: 700 as const,
      fontFamily: 'ui-monospace, monospace',
      lineHeight: '15px',
      background: 'rgba(15, 23, 42, 0.92)',
      borderColor: `${color}99`,
      color,
      textShadow: `0 0 6px ${color}88`,
    },
  };
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

          {/* ── Directional indicators — all with dark halo for ocean contrast ── */}
          <g style={ARROW_SHADOW}>
            {/* Wind arrow — SHARED component with StationMarker (solid + filled triangle) */}
            <WindArrow
              direction={reading.windDir ?? null}
              speed={reading.windSpeed ?? null}
            />

            {/* Current arrow — DOTTED + open chevron (distinct from wind) */}
            {hasCurrent && (
              <CurrentArrow speed={reading.currentSpeed!} dir={reading.currentDir!} />
            )}

            {/* Wave direction glyph — 3-crest wave lines */}
            {hasWaves && (
              <WaveGlyph
                height={reading.waveHeight!}
                dir={reading.waveDir}
                period={reading.wavePeriod}
              />
            )}
          </g>

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

        {/* ── Data badges — near-opaque dark bg + glow text ── */}

        {/* Wave height (top-right) */}
        {hasWaves && (() => {
          const wColor = waveHeightColor(reading.waveHeight!);
          const b = badgeStyle(wColor, 'top-right');
          return <div className={b.className} style={b.style}>{reading.waveHeight!.toFixed(1)}m</div>;
        })()}

        {/* Wind speed (top-left) */}
        {hasWind && (() => {
          const wColor = windSpeedColor(reading.windSpeed);
          const b = badgeStyle(wColor, 'top-left');
          return <div className={b.className} style={b.style}>{windKt.toFixed(0)}kt</div>;
        })()}

        {/* Water temperature (bottom-right) */}
        {hasWaterTemp && (() => {
          const wColor = waterTempColor(reading.waterTemp!);
          const b = badgeStyle(wColor, 'bottom-right');
          return <div className={b.className} style={b.style}>{reading.waterTemp!.toFixed(1)}°</div>;
        })()}

        {/* Current speed (bottom-left) — only if data available */}
        {hasCurrent && (() => {
          const cColor = currentSpeedColor(reading.currentSpeed!);
          const b = badgeStyle(cColor, 'bottom-left');
          return <div className={b.className} style={b.style}>{(reading.currentSpeed! * 100).toFixed(0)}cm/s</div>;
        })()}

        {/* Station name — larger, with halo for map contrast */}
        <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 translate-y-full whitespace-nowrap text-[11px] font-bold text-slate-900 map-label-halo pointer-events-none mt-0.5">
          {reading.stationName}
        </div>
      </div>
    </Marker>
  );
});
