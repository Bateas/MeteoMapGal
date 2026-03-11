/**
 * Map markers for sailing spots (multi-sector).
 *
 * Shows a pulsing circle at each spot center with an SVG icon,
 * verdict badge (CALMA/FLOJO/NAVEG./BUENO/FUERTE), and click-to-select.
 * Active spot has a brighter ring + larger size.
 * Badge shows wind in knots — the data a sailor actually needs.
 * Sector-aware: renders spots for the active sector.
 */
import { memo, useCallback, useMemo } from 'react';
import { Marker } from 'react-map-gl/maplibre';
import { getSpotsForSector } from '../../config/spots';
import { useSpotStore } from '../../store/spotStore';
import { useSectorStore } from '../../store/sectorStore';
import { WeatherIcon, type IconId } from '../icons/WeatherIcons';
import type { SpotVerdict } from '../../services/spotScoringEngine';

// ── Verdict colors (5-level scale) ───────────────────────────────
const VERDICT_COLORS: Record<SpotVerdict, { ring: string; bg: string; text: string; glow: string }> = {
  calm:    { ring: '#94a3b8', bg: 'rgba(100, 116, 139, 0.15)', text: '#94a3b8', glow: '#64748b' },
  light:   { ring: '#f87171', bg: 'rgba(239, 68, 68, 0.12)',   text: '#f87171', glow: '#ef4444' },
  sailing: { ring: '#fbbf24', bg: 'rgba(245, 158, 11, 0.15)',  text: '#fbbf24', glow: '#f59e0b' },
  good:    { ring: '#34d399', bg: 'rgba(16, 185, 129, 0.15)',   text: '#34d399', glow: '#10b981' },
  strong:  { ring: '#22d3ee', bg: 'rgba(6, 182, 212, 0.15)',    text: '#22d3ee', glow: '#06b6d4' },
  unknown: { ring: '#94a3b8', bg: 'rgba(100, 116, 139, 0.15)', text: '#94a3b8', glow: '#64748b' },
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
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const spots = useMemo(() => getSpotsForSector(sectorId), [sectorId]);

  return (
    <>
      {spots.map((spot) => {
        const score = scores.get(spot.id);
        const verdict: SpotVerdict = score?.verdict ?? 'unknown';
        const isActive = spot.id === activeSpotId;
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
  onSelect,
}: SpotMarkerItemProps) {
  const colors = VERDICT_COLORS[verdict];
  const size = isActive ? 44 : 36;
  const ringWidth = isActive ? 3 : 2;
  const iconSize = isActive ? 20 : 16;

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
          width={size + 20}
          height={size + 20}
          viewBox={`${-(size / 2 + 10)} ${-(size / 2 + 10)} ${size + 20} ${size + 20}`}
          role="img"
          aria-label={`Spot ${shortName}`}
        >
          {/* Pulse ring for active spot */}
          {isActive && (
            <circle r={size / 2 + 6} fill="none" stroke={colors.glow} strokeWidth="1.5" opacity="0.4">
              <animate
                attributeName="r"
                values={`${size / 2 + 4};${size / 2 + 12};${size / 2 + 4}`}
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

          {/* Outer dashed ring — zone radius indicator */}
          <circle
            r={size / 2 + 2}
            fill="none"
            stroke={colors.ring}
            strokeWidth="1"
            strokeDasharray="5,3"
            opacity={isActive ? 0.6 : 0.3}
          />

          {/* Main circle */}
          <circle
            r={size / 2}
            fill={colors.bg}
            stroke={colors.ring}
            strokeWidth={ringWidth}
            style={{
              filter: isActive ? `drop-shadow(0 0 6px ${colors.glow}66)` : undefined,
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
          className="absolute -top-0.5 -right-0.5 rounded-full px-1.5 py-px pointer-events-none whitespace-nowrap border"
          style={{
            fontSize: 9,
            fontWeight: 800,
            fontFamily: 'ui-monospace, monospace',
            lineHeight: '12px',
            background: 'rgba(15, 23, 42, 0.92)',
            borderColor: `${colors.ring}80`,
            color: colors.text,
            textShadow: `0 0 5px ${colors.glow}66`,
          }}
        >
          {badgeText}
        </div>

        {/* Name label — below marker (dark pill for legibility on any terrain) */}
        <div
          className="absolute -bottom-1 left-1/2 -translate-x-1/2 translate-y-full whitespace-nowrap text-[10px] font-extrabold pointer-events-none rounded-full px-2 py-0.5"
          style={{
            background: 'rgba(15, 23, 42, 0.85)',
            color: '#e2e8f0',
            border: `1px solid ${colors.ring}60`,
            letterSpacing: '0.02em',
          }}
        >
          {shortName}
        </div>
      </div>
    </Marker>
  );
});
