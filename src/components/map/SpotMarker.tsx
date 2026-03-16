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
import { Marker } from 'react-map-gl/maplibre';
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
}: SpotMarkerItemProps) {
  const colors = VERDICT_COLORS[verdict];
  const size = isActive ? 48 : 40;
  const ringWidth = isActive ? 3 : 2;
  const iconSize = isActive ? 22 : 18;

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

  return (
    <Marker longitude={lon} latitude={lat} anchor="center" onClick={handleClick}>
      <div className="spot-marker relative cursor-pointer" title={shortName}>
        <svg
          width={size + 30}
          height={size + 30}
          viewBox={`${-(size / 2 + 15)} ${-(size / 2 + 15)} ${size + 30} ${size + 30}`}
          role="img"
          aria-label={`Spot ${shortName}`}
        >
          <defs>
            {/* Radial gradient for ambient glow */}
            <radialGradient id={`spot-glow-${spotId}`}>
              <stop offset="0%" stopColor={colors.glow} stopOpacity="0.25" />
              <stop offset="70%" stopColor={colors.glow} stopOpacity="0.06" />
              <stop offset="100%" stopColor={colors.glow} stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Invisible larger hit area for easier clicking */}
          <circle r={size / 2 + 14} fill="transparent" />

          {/* Ambient glow circle (always visible, subtle) */}
          <circle r={size / 2 + 10} fill={`url(#spot-glow-${spotId})`} />

          {/* Pulse ring for active spot */}
          {isActive && (
            <circle r={size / 2 + 8} fill="none" stroke={colors.glow} strokeWidth="1.5" opacity="0.4">
              <animate
                attributeName="r"
                values={`${size / 2 + 6};${size / 2 + 14};${size / 2 + 6}`}
                dur="3s"
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                values="0.5;0.15;0.5"
                dur="3s"
                repeatCount="indefinite"
              />
            </circle>
          )}

          {/* Outer dashed ring — zone indicator */}
          <circle
            r={size / 2 + 4}
            fill="none"
            stroke={colors.ring}
            strokeWidth="1"
            strokeDasharray="5,3"
            opacity={isActive ? 0.6 : 0.35}
          />

          {/* Secondary solid ring (new — makes spot pop vs station dots) */}
          <circle
            r={size / 2 + 1}
            fill="none"
            stroke={colors.ring}
            strokeWidth="0.8"
            opacity={isActive ? 0.5 : 0.2}
          />

          {/* Main circle */}
          <circle
            r={size / 2}
            fill={colors.bg}
            stroke={colors.ring}
            strokeWidth={ringWidth}
            style={{
              filter: isActive
                ? `drop-shadow(0 0 8px ${colors.glow}88)`
                : `drop-shadow(0 0 4px ${colors.glow}44)`,
            }}
          />

          {/* Icon via foreignObject — renders WeatherIcon (lucide SVG) inside the circle */}
          <foreignObject
            x={-iconSize / 2}
            y={-iconSize / 2}
            width={iconSize}
            height={iconSize}
            style={{ pointerEvents: 'none' }}
          >
            <div style={{ width: iconSize, height: iconSize, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <WeatherIcon id={icon} size={iconSize} className="text-slate-200" />
            </div>
          </foreignObject>
        </svg>

        {/* Verdict badge — top-right — shows kt for sailor glance value */}
        <div
          className="absolute -top-0.5 -right-0.5 rounded-full pointer-events-none whitespace-nowrap border flex items-center gap-0.5"
          style={{
            fontSize: 11,
            fontWeight: 800,
            fontFamily: 'ui-monospace, monospace',
            lineHeight: '14px',
            padding: isLoading ? '2px 5px' : '1px 6px',
            background: 'rgba(15, 23, 42, 0.92)',
            borderColor: isLoading ? '#60a5fa80' : `${colors.ring}80`,
            color: isLoading ? '#93c5fd' : colors.text,
            textShadow: isLoading ? 'none' : `0 0 5px ${colors.glow}66`,
            backfaceVisibility: 'hidden',
            WebkitFontSmoothing: 'antialiased',
            MozOsxFontSmoothing: 'grayscale',
            willChange: 'transform',
          } as React.CSSProperties}
        >
          {isLoading ? <LoadingSpinner /> : badgeText}
        </div>

        {/* Name label — below marker (dark pill for legibility on any terrain) */}
        <div
          className="absolute -bottom-1 left-1/2 -translate-x-1/2 translate-y-full whitespace-nowrap text-xs font-extrabold pointer-events-none rounded-full px-2 py-0.5"
          style={{
            background: 'rgba(15, 23, 42, 0.85)',
            color: '#e2e8f0',
            border: `1px solid ${colors.ring}60`,
            letterSpacing: '0.02em',
            backfaceVisibility: 'hidden',
            WebkitFontSmoothing: 'antialiased',
            MozOsxFontSmoothing: 'grayscale',
            willChange: 'transform',
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
