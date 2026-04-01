/**
 * Map markers for sailing spots (multi-sector).
 *
 * Shows a pulsing circle at each spot center with an SVG icon,
 * verdict badge (CALMA/FLOJO/NAVEG./BUENO/FUERTE), and click-to-select.
 * Active spot has a brighter ring + larger size.
 * Badge shows wind in knots — the data a sailor actually needs.
 * Sector-aware: renders spots for the active sector.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Marker, useMap } from 'react-map-gl/maplibre';
import { getSpotsForSector } from '../../config/spots';
import { useSpotStore } from '../../store/spotStore';
import { useSectorStore } from '../../store/sectorStore';
import { WeatherIcon, type IconId } from '../icons/WeatherIcons';
import type { SpotVerdict } from '../../services/spotScoringEngine';

// ── Verdict colors — matches windSpeedColor() scale for coherence ──
const VERDICT_COLORS: Record<SpotVerdict, { ring: string; bg: string; text: string; glow: string }> = {
  calm:    { ring: '#94a3b8', bg: 'rgba(100, 116, 139, 0.15)', text: '#94a3b8', glow: '#64748b' },  // slate (calm)
  light:   { ring: '#22c55e', bg: 'rgba(34, 197, 94, 0.12)',   text: '#4ade80', glow: '#22c55e' },   // green (6-8kt)
  sailing: { ring: '#a3e635', bg: 'rgba(163, 230, 53, 0.12)',  text: '#bef264', glow: '#84cc16' },   // lime (8-12kt)
  good:    { ring: '#eab308', bg: 'rgba(234, 179, 8, 0.12)',   text: '#facc15', glow: '#ca8a04' },   // yellow (12-18kt)
  strong:  { ring: '#f97316', bg: 'rgba(249, 115, 22, 0.12)',  text: '#fb923c', glow: '#ea580c' },   // orange (18kt+)
  unknown: { ring: '#94a3b8', bg: 'rgba(100, 116, 139, 0.15)', text: '#94a3b8', glow: '#64748b' },  // slate
};

/** Short map labels — must fit in a tiny badge */
const VERDICT_MAP_LABEL: Record<SpotVerdict, string> = {
  calm:    'CALMA',
  light:   'FLOJO',
  sailing: 'NAVEG.',
  good:    'BUENO',
  strong:  'FUERTE',
  unknown: '—',
};

export const SpotMarkers = memo(function SpotMarkers() {
  const activeSpotId = useSpotStore((s) => s.activeSpotId);
  const selectSpot = useSpotStore((s) => s.selectSpot);
  const scores = useSpotStore((s) => s.scores);
  const lastScored = useSpotStore((s) => s.lastScored);
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const spots = useMemo(() => getSpotsForSector(sectorId), [sectorId]);

  // Zoom-based scaling for spots — smaller at low zoom to reduce overlap
  const { current: mapRef } = useMap();
  const [zoomScale, setZoomScale] = useState(1);
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;
    const onZoom = () => {
      const z = map.getZoom();
      // Scale: 0.65 at zoom 9, 0.8 at zoom 10, 1.0 at zoom 11+
      setZoomScale(z >= 11 ? 1 : z >= 10 ? 0.8 : z >= 9 ? 0.65 : 0.5);
    };
    onZoom();
    map.on('zoomend', onZoom);
    return () => { map.off('zoomend', onZoom); };
  }, [mapRef]);

  // Show spinner until scoring has run + 3s grace period.
  // Spots mount under the loading screen (~10s), so we delay dismissal
  // after first scoring to give a visible spinner during map reveal.
  const [showSpinner, setShowSpinner] = useState(true);
  useEffect(() => {
    if (lastScored === 0) return; // not scored yet — keep spinner
    const timer = setTimeout(() => setShowSpinner(false), 3_000);
    return () => clearTimeout(timer);
  }, [lastScored > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {spots.map((spot) => {
        const score = scores.get(spot.id);
        const verdict: SpotVerdict = score?.verdict ?? 'unknown';
        const isActive = spot.id === activeSpotId;
        // Show spinner while global grace period OR this spot has no data
        const spotLoading = showSpinner || verdict === 'unknown';
        return (
          <SpotMarkerItem
            key={spot.id}
            spotId={spot.id}
            icon={spot.icon}
            shortName={spot.shortName}
            lon={spot.center[0]}
            lat={spot.center[1]}
            verdict={verdict}
            windKt={score?.wind?.avgSpeedKt ?? null}
            isActive={isActive}
            isLoading={spotLoading}
            onSelect={selectSpot}
            zoomScale={zoomScale}
          />
        );
      })}
    </>
  );
});

// ── Individual spot marker ──────────────────────────────────────

interface SpotMarkerItemProps {
  spotId: string;
  icon: IconId;
  shortName: string;
  lon: number;
  lat: number;
  verdict: SpotVerdict;
  windKt: number | null;
  isActive: boolean;
  isLoading: boolean;
  onSelect: (id: string) => void;
  zoomScale: number;
}

/** SVG arc path for wind gauge (0-20kt mapped to 0-270°) */
function gaugeArc(r: number, windKt: number | null): string {
  if (windKt == null || windKt < 1) return '';
  const angle = Math.min(270, (windKt / 20) * 270); // 20kt = full arc
  const rad = ((angle - 90) * Math.PI) / 180; // start at top (-90°)
  const startRad = (-90 * Math.PI) / 180;
  const x1 = r * Math.cos(startRad);
  const y1 = r * Math.sin(startRad);
  const x2 = r * Math.cos(rad);
  const y2 = r * Math.sin(rad);
  const large = angle > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

const SpotMarkerItem = memo(function SpotMarkerItem({
  spotId,
  icon,
  shortName,
  lon,
  lat,
  verdict,
  windKt,
  isActive,
  isLoading,
  onSelect,
  zoomScale,
}: SpotMarkerItemProps) {
  const colors = VERDICT_COLORS[verdict];
  // Scale down at low zoom to avoid overlapping other markers
  const baseSize = isActive ? 44 : 36;
  const size = baseSize;
  const iconSize = isActive ? 20 : 16;
  const gaugeR = size / 2 + 4;

  const handleClick = useCallback(
    (e: { originalEvent: MouseEvent }) => {
      e.originalEvent.stopPropagation();
      onSelect(spotId);
    },
    [onSelect, spotId],
  );

  // Badge text: "BUENO 15kt" or "CALMA" (no kt when calm/unknown)
  const label = VERDICT_MAP_LABEL[verdict];
  const badgeText = windKt !== null && verdict !== 'calm' && verdict !== 'unknown'
    ? `${label} ${windKt.toFixed(0)}kt`
    : label;

  const svgSize = size + 24;
  const half = svgSize / 2;

  return (
    <Marker longitude={lon} latitude={lat} anchor="center" onClick={handleClick}>
      <div className="spot-marker relative cursor-pointer" title={shortName} style={{ transform: `scale(${zoomScale})`, transformOrigin: 'center' }}>
        <svg
          width={svgSize}
          height={svgSize}
          viewBox={`${-half} ${-half} ${svgSize} ${svgSize}`}
          role="img"
          aria-label={`Spot ${shortName}: ${badgeText}`}
        >
          {/* Hit area */}
          <circle r={half} fill="transparent" />

          {/* Pulse ring — active only */}
          {isActive && (
            <circle r={size / 2 + 8} fill="none" stroke={colors.ring} strokeWidth="1" opacity="0.3">
              <animate attributeName="r" values={`${size / 2 + 6};${size / 2 + 12};${size / 2 + 6}`} dur="2.5s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.4;0.1;0.4" dur="2.5s" repeatCount="indefinite" />
            </circle>
          )}

          {/* Background track ring (dark) */}
          <circle
            r={gaugeR}
            fill="none"
            stroke={colors.ring}
            strokeWidth={isActive ? 3 : 2}
            opacity={0.15}
          />

          {/* Wind gauge arc — proportional to wind speed */}
          {windKt != null && windKt >= 1 && (
            <path
              d={gaugeArc(gaugeR, windKt)}
              fill="none"
              stroke={colors.ring}
              strokeWidth={isActive ? 3.5 : 2.5}
              strokeLinecap="round"
              opacity={isActive ? 0.9 : 0.7}
            />
          )}

          {/* Main filled circle */}
          <circle
            r={size / 2}
            fill={`${colors.ring}18`}
            stroke={colors.ring}
            strokeWidth={isActive ? 2 : 1.5}
            opacity={isActive ? 1 : 0.85}
          />

          {/* Icon */}
          <foreignObject
            x={-iconSize / 2}
            y={-iconSize / 2}
            width={iconSize}
            height={iconSize}
            style={{ pointerEvents: 'none' }}
          >
            <div style={{ width: iconSize, height: iconSize, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <WeatherIcon id={icon} size={iconSize} style={{ color: colors.ring }} />
            </div>
          </foreignObject>
        </svg>

        {/* Verdict badge — top-right */}
        <div
          className="absolute -top-1 -right-1 rounded-full pointer-events-none whitespace-nowrap flex items-center gap-0.5"
          style={{
            fontSize: 11,
            fontWeight: 800,
            fontFamily: 'ui-monospace, monospace',
            lineHeight: '14px',
            padding: isLoading ? '2px 5px' : '2px 7px',
            background: `${colors.ring}20`,
            border: `1.5px solid ${colors.ring}60`,
            color: isLoading ? '#93c5fd' : colors.text,
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
          } as React.CSSProperties}
        >
          {isLoading ? <LoadingSpinner /> : badgeText}
        </div>

        {/* Name label — below marker */}
        <div
          className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 translate-y-full whitespace-nowrap text-[11px] font-bold pointer-events-none px-2 py-0.5 rounded"
          style={{
            color: colors.text,
            textShadow: '0 1px 3px rgba(0,0,0,0.8), 0 0 8px rgba(0,0,0,0.6)',
            letterSpacing: '0.03em',
          } as React.CSSProperties}
        >
          {shortName}
        </div>
      </div>
    </Marker>
  );
});

// ── Loading spinner for spot badges ─────────────────────────────
/** Tiny animated arc spinner — shown while scoring data loads */
function LoadingSpinner() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" style={{ display: 'block' }}>
      <circle cx="6" cy="6" r="4.5" fill="none" stroke="#334155" strokeWidth="1.5" />
      <circle
        cx="6" cy="6" r="4.5" fill="none"
        stroke="#60a5fa" strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="14 14"
      >
        <animateTransform
          attributeName="transform" type="rotate"
          values="0 6 6;360 6 6" dur="1s" repeatCount="indefinite"
        />
      </circle>
    </svg>
  );
}
