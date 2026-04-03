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

// ── Verdict colors — aligned with windSpeedColor() scale (cold→hot) ──
const VERDICT_COLORS: Record<SpotVerdict, { ring: string; text: string; glow: string }> = {
  calm:    { ring: '#94a3b8', text: '#94a3b8', glow: '#64748b' },  // slate — no wind
  light:   { ring: '#22c55e', text: '#4ade80', glow: '#16a34a' },  // green-500 — gentle breeze
  sailing: { ring: '#a3e635', text: '#d9f99d', glow: '#65a30d' },  // lime-400 — moderate
  good:    { ring: '#eab308', text: '#fde047', glow: '#ca8a04' },  // yellow-500 — fresh wind
  strong:  { ring: '#f97316', text: '#fdba74', glow: '#ea580c' },  // orange-500 — strong
  unknown: { ring: '#94a3b8', text: '#94a3b8', glow: '#64748b' },  // slate
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
      setZoomScale(z >= 11 ? 1 : z >= 10 ? 0.8 : z >= 9 ? 0.65 : 0.5);
    };
    onZoom();
    // Use 'zoom' event (fires during animation) not just 'zoomend'
    map.on('zoom', onZoom);
    return () => { map.off('zoom', onZoom); };
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
            isSurf={spot.category === 'surf'}
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
  isSurf?: boolean;
}

/** Hexagon path for spot shape — distinctive from circular stations */
function hexPath(r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2; // start at top
    pts.push(`${r * Math.cos(angle)},${r * Math.sin(angle)}`);
  }
  return `M ${pts.join(' L ')} Z`;
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
  isSurf,
}: SpotMarkerItemProps) {
  const colors = VERDICT_COLORS[verdict];
  const size = isActive ? 48 : 42;
  const iconSize = isActive ? 22 : 18;
  const gaugeR = size / 2 + 5;

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

          {/* Ambient glow — always visible, makes spot "pop" vs stations */}
          <circle
            r={size / 2 + 8}
            fill="none"
            stroke={colors.glow}
            strokeWidth="1"
            opacity={isActive ? 0.25 : 0.12}
          />

          {/* Gauge track ring */}
          <circle
            r={gaugeR}
            fill="none"
            stroke={colors.ring}
            strokeWidth={isActive ? 3.5 : 2.5}
            opacity={0.2}
          />

          {/* Wind gauge arc — proportional to wind speed */}
          {windKt != null && windKt >= 1 && (
            <path
              d={gaugeArc(gaugeR, windKt)}
              fill="none"
              stroke={colors.ring}
              strokeWidth={isActive ? 4 : 3}
              strokeLinecap="round"
              opacity={isActive ? 1 : 0.8}
            />
          )}

          {/* Main hexagon — distinctive shape vs circular stations */}
          <path
            d={hexPath(size / 2)}
            fill={`${colors.ring}15`}
            stroke={colors.ring}
            strokeWidth={isActive ? 2.5 : 2}
            strokeLinejoin="round"
            style={{ filter: `drop-shadow(0 0 ${isActive ? 8 : 4}px ${colors.glow}55)` }}
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

        {/* Verdict badge — centered above the marker */}
        <div
          className="absolute left-1/2 -translate-x-1/2 pointer-events-none whitespace-nowrap flex items-center"
          style={{
            top: -2,
            transform: `translateX(-50%) translateY(-100%)`,
            fontSize: 11,
            fontWeight: 800,
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            lineHeight: '14px',
            padding: isLoading ? '2px 6px' : '3px 8px',
            background: 'rgba(15, 23, 42, 0.9)',
            border: `1.5px solid ${colors.ring}70`,
            borderRadius: 6,
            color: isLoading ? '#93c5fd' : colors.text,
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
          } as React.CSSProperties}
        >
          {isLoading ? <LoadingSpinner /> : badgeText}
        </div>

        {/* Name label — below marker */}
        <div
          className="absolute left-1/2 -translate-x-1/2 pointer-events-none whitespace-nowrap text-[11px] font-bold px-2 py-0.5"
          style={{
            bottom: -2,
            transform: `translateX(-50%) translateY(100%)`,
            color: colors.text,
            textShadow: '0 1px 3px rgba(0,0,0,0.9), 0 0 10px rgba(0,0,0,0.7)',
            letterSpacing: '0.03em',
          } as React.CSSProperties}
        >
          {shortName}
          {isSurf && (
            <span className="ml-1 text-[8px] font-bold tracking-wider text-cyan-300 bg-cyan-500/20 px-1 py-px rounded border border-cyan-500/30 align-middle">SURF</span>
          )}
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
