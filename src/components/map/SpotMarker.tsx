/**
 * Map markers for sailing spots (multi-sector).
 *
 * Shows a pulsing circle at each spot center with an SVG icon,
 * verdict badge (CALMA/FLOJO/NAVEG./BUENO/FUERTE), and click-to-select.
 * Active spot has a brighter ring + larger size.
 * Badge shows wind in knots — the data a sailor actually needs.
 * Sector-aware: renders spots for the active sector.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Marker, useMap } from 'react-map-gl/maplibre';
import { getSpotsForSector } from '../../config/spots';
import { useSpotStore } from '../../store/spotStore';
import { useSectorStore } from '../../store/sectorStore';
import { WeatherIcon, type IconId } from '../icons/WeatherIcons';
import type { SpotVerdict } from '../../services/spotScoringEngine';
import { clusterSpots, CLUSTER_DISABLE_ZOOM, type SpotClusterGroup } from '../../services/spotClustering';

// ── Verdict colors — aligned with simplified windSpeedColor() scale ──
const VERDICT_COLORS: Record<SpotVerdict, { ring: string; text: string; glow: string }> = {
  calm:    { ring: '#94a3b8', text: '#94a3b8', glow: '#64748b' },  // slate — calm
  light:   { ring: '#38bdf8', text: '#7dd3fc', glow: '#0284c7' },  // sky — flojo (blue)
  sailing: { ring: '#22c55e', text: '#4ade80', glow: '#16a34a' },  // green — navegable
  good:    { ring: '#eab308', text: '#fde047', glow: '#ca8a04' },  // yellow — bueno
  strong:  { ring: '#f97316', text: '#fdba74', glow: '#ea580c' },  // orange — fuerte
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
  const surfWaveCache = useSpotStore((s) => s.surfWaveCache);
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const spots = useMemo(() => getSpotsForSector(sectorId), [sectorId]);

  // Zoom-based scaling for spots — smaller at low zoom to reduce overlap
  const { current: mapRef } = useMap();
  const [zoomScale, setZoomScale] = useState(1);
  const [zoom, setZoom] = useState(11);
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;
    const onZoom = () => {
      // Discretize to 0.5-zoom steps: clusterSpots only cares about coarse zoom
      // bands, so setting state on every continuous tick (30-60/s during a zoom
      // gesture) re-runs the cluster useMemo + re-renders all spot markers for
      // no visible change. Round + bail when the band is unchanged.
      const z = Math.round(map.getZoom() * 2) / 2;
      setZoom((prev) => (prev === z ? prev : z));
      setZoomScale(z >= 11 ? 1 : z >= 10 ? 0.8 : z >= 9 ? 0.65 : 0.5);
    };
    onZoom();
    // Use 'zoom' event (fires during animation) not just 'zoomend'
    map.on('zoom', onZoom);
    return () => { map.off('zoom', onZoom); };
  }, [mapRef]);

  // Compute cluster items based on current zoom + verdicts
  const items = useMemo(() => {
    const verdictMap = new Map<string, SpotVerdict>();
    for (const spot of spots) {
      const score = scores.get(spot.id);
      // Provisional score (cold load, reading set still partial): treat as
      // 'unknown' so cluster aggregates never color from an untrusted verdict.
      verdictMap.set(spot.id, score?.provisional ? 'unknown' : (score?.verdict ?? 'unknown'));
    }
    return clusterSpots(spots, verdictMap, zoom);
  }, [spots, scores, zoom]);

  const handleClusterClick = useCallback((cluster: SpotClusterGroup) => {
    const map = mapRef?.getMap();
    if (!map) return;
    // Fly to centroid + zoom to the threshold where the cluster will split.
    map.flyTo({ center: [cluster.lon, cluster.lat], zoom: CLUSTER_DISABLE_ZOOM + 0.5, duration: 800 });
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
      {items.map((item) => {
        if (item.type === 'cluster') {
          return (
            <SpotClusterMarker
              key={item.id}
              cluster={item}
              zoomScale={zoomScale}
              onClick={handleClusterClick}
            />
          );
        }
        const spot = item.spot;
        const score = scores.get(spot.id);
        // Provisional score (cold load — same flag SpotPopup reads): the marker
        // NEVER shows a provisional verdict/kt. Downgrade to the neutral
        // 'unknown' render (slate ring, spinner badge, no kt, no gauge).
        const provisional = score?.provisional === true;
        const verdict: SpotVerdict = provisional ? 'unknown' : (score?.verdict ?? 'unknown');
        const isActive = spot.id === activeSpotId;
        // Show spinner while global grace period, provisional data, or no data
        const spotLoading = showSpinner || provisional || verdict === 'unknown';
        return (
          <SpotMarkerItem
            key={spot.id}
            spotId={spot.id}
            icon={spot.icon}
            shortName={spot.shortName}
            lon={spot.center[0]}
            lat={spot.center[1]}
            verdict={verdict}
            windKt={provisional ? null : (score?.effectiveWindKt ?? score?.wind?.avgSpeedKt ?? null)}
            waveHeight={spot.category === 'surf' ? (surfWaveCache.get(spot.id)?.waveHeight ?? null) : (score?.waves?.waveHeight ?? null)}
            wavePeriod={spot.category === 'surf' ? (surfWaveCache.get(spot.id)?.period ?? null) : (score?.waves?.wavePeriod ?? null)}
            isActive={isActive}
            isLoading={spotLoading}
            isProvisional={provisional}
            onSelect={selectSpot}
            zoomScale={zoomScale}
            isSurf={spot.category === 'surf'}
            surfVerdictLabel={surfWaveCache.get(spot.id)?.verdictLabel}
            surfVerdictColor={surfWaveCache.get(spot.id)?.verdictColor}
          />
        );
      })}
    </>
  );
});

// ── Cluster marker ──────────────────────────────────────────────

interface SpotClusterMarkerProps {
  cluster: SpotClusterGroup;
  zoomScale: number;
  onClick: (c: SpotClusterGroup) => void;
}

const SpotClusterMarker = memo(function SpotClusterMarker({
  cluster,
  zoomScale,
  onClick,
}: SpotClusterMarkerProps) {
  const colors = VERDICT_COLORS[cluster.worstVerdict];
  const size = 44 * zoomScale;
  const half = size / 2;
  // Padding so stroke + drop-shadow aren't clipped by the SVG box.
  const svgSize = size + 12;
  const svgHalf = svgSize / 2;

  return (
    // z-index 6: spots always paint above station clusters (z-index 1).
    // Hexagon (not a circle) so a clustered group still reads as "spots",
    // distinct from the round station/buoy context clusters.
    <Marker longitude={cluster.lon} latitude={cluster.lat} anchor="center" style={{ zIndex: 6 }}>
      <button
        onClick={(e) => { e.stopPropagation(); onClick(cluster); }}
        className="relative flex items-center justify-center transition-transform hover:scale-110 cursor-pointer bg-transparent border-0 p-0"
        style={{ width: svgSize, height: svgSize }}
        title={`${cluster.count} spots — click para acercar`}
        aria-label={`Cluster de ${cluster.count} spots, peor estado ${cluster.worstVerdict}`}
      >
        <svg
          width={svgSize}
          height={svgSize}
          viewBox={`${-svgHalf} ${-svgHalf} ${svgSize} ${svgSize}`}
          style={{ position: 'absolute', inset: 0 }}
          aria-hidden="true"
        >
          <path
            d={hexPath(half)}
            fill="rgba(15, 23, 42, 0.85)"
            stroke={colors.ring}
            strokeWidth={2.5}
            strokeLinejoin="round"
            style={{ filter: `drop-shadow(0 0 8px ${colors.glow}80)` }}
          />
        </svg>
        <span
          className="relative font-bold tabular-nums"
          style={{
            color: colors.text,
            fontSize: `${Math.max(13, 18 * zoomScale)}px`,
            textShadow: '0 0 6px rgba(0,0,0,0.9)',
          }}
        >
          {cluster.count}
        </span>
      </button>
    </Marker>
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
  waveHeight: number | null;
  wavePeriod: number | null;
  isActive: boolean;
  isLoading: boolean;
  /** Cold-load provisional score — label/tooltip say "calculando" (verdict already downgraded to 'unknown' by the parent) */
  isProvisional?: boolean;
  onSelect: (id: string) => void;
  zoomScale: number;
  isSurf?: boolean;
  surfVerdictLabel?: string;
  surfVerdictColor?: string;
}

/** Hexagon path for sailing spots — 6 sides */
function hexPath(r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2; // start at top
    pts.push(`${r * Math.cos(angle)},${r * Math.sin(angle)}`);
  }
  return `M ${pts.join(' L ')} Z`;
}

/** Pentagon path for surf spots — 5 sides, visually distinct from hex */
function pentaPath(r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 5; i++) {
    const angle = (2 * Math.PI / 5) * i - Math.PI / 2; // start at top
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

/** Convert a hex color to ring/text/glow variants for marker rendering */
function surfColorFromHex(hex: string): typeof VERDICT_COLORS['calm'] {
  return { ring: hex, text: hex, glow: hex };
}

/** Simple surf verdict for map markers — fallback when cached verdict not available */
function surfMarkerVerdict(wh: number | null): { label: string; colors: typeof VERDICT_COLORS['calm'] } {
  if (wh === null || wh < 0.3) return { label: 'FLAT', colors: VERDICT_COLORS.calm };
  if (wh < 0.8) return { label: 'PEQUE', colors: { ring: '#22d3ee', text: '#67e8f9', glow: '#0891b2' } };   // cyan
  if (wh < 1.5) return { label: 'SURF OK', colors: { ring: '#3b82f6', text: '#93c5fd', glow: '#2563eb' } };  // blue
  if (wh < 2.5) return { label: 'CLASICO', colors: { ring: '#22c55e', text: '#4ade80', glow: '#16a34a' } };  // green
  return { label: 'GRANDE', colors: { ring: '#f97316', text: '#fdba74', glow: '#ea580c' } };                  // orange
}

const SpotMarkerItem = memo(function SpotMarkerItem({
  spotId,
  icon,
  shortName,
  lon,
  lat,
  verdict,
  windKt,
  waveHeight,
  wavePeriod: _wavePeriod,
  isActive,
  isLoading,
  isProvisional,
  onSelect,
  zoomScale,
  isSurf,
  surfVerdictLabel,
  surfVerdictColor,
}: SpotMarkerItemProps) {
  // Surf spots: use cached verdict from popup (includes period+wind modifiers).
  // Falls back to wave-height-only verdict if popup hasn't been opened yet.
  const surfV = isSurf
    ? (surfVerdictLabel && surfVerdictColor
        ? { label: surfVerdictLabel, colors: surfColorFromHex(surfVerdictColor) }
        : surfMarkerVerdict(waveHeight))
    : null;
  const colors = surfV?.colors ?? VERDICT_COLORS[verdict];
  const size = isActive ? 48 : 42;
  const iconSize = isActive ? 22 : 18;
  const gaugeR = size / 2 + 5;

  // Verdict upgrade flash — detect CALMA→NAVEGABLE transitions
  const prevVerdictRef = useRef(verdict);
  const [upgradeFlash, setUpgradeFlash] = useState(false);
  useEffect(() => {
    const prev = prevVerdictRef.current;
    prevVerdictRef.current = verdict;
    const low = ['calm', 'light', 'unknown'];
    const high = ['sailing', 'good', 'strong'];
    if (low.includes(prev) && high.includes(verdict)) {
      setUpgradeFlash(true);
      const t = setTimeout(() => setUpgradeFlash(false), 3000);
      return () => clearTimeout(t);
    }
  }, [verdict]);

  const handleClick = useCallback(
    (e: { originalEvent: MouseEvent }) => {
      e.originalEvent.stopPropagation();
      onSelect(spotId);
    },
    [onSelect, spotId],
  );

  // Badge text: surf uses wave label + height, sailing uses wind label + kt
  const badgeText = isSurf && surfV
    ? (waveHeight !== null && waveHeight >= 0.3 ? `${surfV.label} ${waveHeight.toFixed(1)}m` : surfV.label)
    : (windKt !== null && verdict !== 'calm' && verdict !== 'unknown'
      ? `${VERDICT_MAP_LABEL[verdict]} ${windKt.toFixed(0)}kt`
      : VERDICT_MAP_LABEL[verdict]);

  const svgSize = size + 24;
  const half = svgSize / 2;

  return (
    // z-index above station clusters (1); active spot floats above other spots.
    <Marker longitude={lon} latitude={lat} anchor="center" onClick={handleClick} style={{ zIndex: isActive ? 8 : 6 }}>
      <div className="spot-marker relative cursor-pointer" title={isProvisional ? `${shortName} — calculando condiciones` : shortName} style={{ transform: `scale(${zoomScale})`, transformOrigin: 'center' }}>
        <svg
          width={svgSize}
          height={svgSize}
          viewBox={`${-half} ${-half} ${svgSize} ${svgSize}`}
          role="img"
          aria-label={isProvisional ? `Spot ${shortName}: calculando condiciones` : `Spot ${shortName}: ${badgeText}`}
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

          {/* Gauge arc — wind speed for sailing, wave height for surf */}
          {(isSurf ? (waveHeight != null && waveHeight >= 0.3) : (windKt != null && windKt >= 1)) && (
            <path
              d={isSurf ? gaugeArc(gaugeR, (waveHeight ?? 0) * 8) : gaugeArc(gaugeR, windKt)}
              fill="none"
              stroke={colors.ring}
              strokeWidth={isActive ? 4 : 3}
              strokeLinecap="round"
              opacity={isActive ? 1 : 0.8}
            />
          )}

          {/* Main hexagon — distinctive shape vs circular stations */}
          <path
            d={(isSurf ? pentaPath : hexPath)(size / 2)}
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
            {/* Lucide icons usan currentColor — el color va en el contenedor, WeatherIcon no acepta style */}
            <div style={{ width: iconSize, height: iconSize, display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.ring }}>
              <WeatherIcon id={icon} size={iconSize} />
            </div>
          </foreignObject>
        </svg>

        {/* Verdict badge — centered above the marker */}
        <div
          className={`absolute left-1/2 -translate-x-1/2 pointer-events-none whitespace-nowrap flex items-center${upgradeFlash ? ' animate-verdict-pop' : ''}`}
          style={{
            top: -2,
            transform: `translateX(-50%) translateY(-100%)`,
            fontSize: 11,
            fontWeight: 800,
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            lineHeight: '14px',
            padding: isLoading ? '2px 6px' : '3px 8px',
            background: upgradeFlash ? 'rgba(34, 197, 94, 0.25)' : 'rgba(15, 23, 42, 0.9)',
            border: `1.5px solid ${upgradeFlash ? '#22c55e' : colors.ring + '70'}`,
            boxShadow: upgradeFlash ? `0 0 12px ${colors.glow}88` : undefined,
            transition: 'background 1s ease, border-color 1s ease, box-shadow 1s ease',
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
