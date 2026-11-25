/**
 * Spots on the map, V3 style G: the state fills the shape and the figure goes inside (SpotShape), with the name under
 * it. The selected one is bigger and adds the state in a word. Sector-aware: renders the spots of the active sector.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Marker, useMap, type MarkerInstance } from 'react-map-gl/maplibre';
import { makeMarkerButton } from './markerA11y';
import { useMapInk } from '../../hooks/useMapInk';
import { getSpotsForSector } from '../../config/spots';
import { useSpotStore } from '../../store/spotStore';
import { useSectorStore } from '../../store/sectorStore';
import type { SpotVerdict } from '../../services/spotScoringEngine';
import { VERDICT_STYLE, windToneOver, surfTone, displayWindDir, displayWindKt, gateWaveText, gateWaveWhere, isWaveGate, verdictDoubt, isGusty, GUSTY_LABEL } from '../../config/verdictStyles';
import { clusterSpots, spotDanger, CLUSTER_DISABLE_ZOOM, type SpotClusterGroup, type SpotDanger } from '../../services/spotClustering';
import { useSpotLightningRisk } from '../../hooks/useSpotLightningRisk';
import { spotWindDrift, TREND_MAX_AGE_MIN } from '../../services/windTrendService';
import { ageMinutes } from '../../services/dataAge';
import { useMinuteClock } from '../../hooks/useMinuteClock';
import { TrendArrow } from '../spot/TrendMark';
import { degreesToCardinal } from '../../services/windUtils';
import { formatSurfWave, surfDisplayState, type SurfVerdictResult } from '../../services/surfVerdictEngine';
import { ListHoverRing } from './ListHoverRing';
import { SpotShape, polygonPoints, type SpotDoubt } from './SpotShape';
import { spotTwinOffset } from './spotTwins';

/** Words on a marker: one size on screen whatever the zoom. The whole marker is scaled down when the map is far,
 *  and without this a 12 px name read as 6 px at zoom 8. */
const MARKER_TEXT_PX = 13;

export const SpotMarkers = memo(function SpotMarkers() {
  const activeSpotId = useSpotStore((s) => s.activeSpotId);
  const selectSpot = useSpotStore((s) => s.selectSpot);
  const scores = useSpotStore((s) => s.scores);
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
      // Not under 0.7: the figure inside is 19 px, and it has to stay readable (13 px).
      setZoomScale(z >= 11 ? 1 : z >= 10 ? 0.9 : z >= 9 ? 0.8 : 0.7);
    };
    onZoom();
    // Use 'zoom' event (fires during animation) not just 'zoomend'
    map.on('zoom', onZoom);
    return () => { map.off('zoom', onZoom); };
  }, [mapRef]);

  const items = useMemo(() => clusterSpots(spots, zoom), [spots, zoom]);

  // Where each spot's wind is going, when it is going somewhere: the same rule as the list and the card. Only
  // with a wind figure beside it: not on surf (the figure is the wave), a spot closed by the sea, or a
  // provisional score, and not once the score is old, like the list: the clock takes it away if the readings stop.
  // Handed down as a word, so a new reading repaints only the markers that changed.
  const windHistory = useSpotStore((s) => s.windHistory);
  const now = useMinuteClock();
  const trends = useMemo(() => {
    const out = new Map<string, 'sube' | 'baja'>();
    for (const spot of spots) {
      const score = scores.get(spot.id);
      if (spot.category === 'surf' || isWaveGate(score) || displayWindKt(score) == null) continue;
      const ageMin = ageMinutes(score?.computedAt, now);
      if (ageMin == null || ageMin > TREND_MAX_AGE_MIN) continue;
      const points = (windHistory.get(spot.id) ?? []).map((p) => ({ t: p.ts, kt: p.kt }));
      const drift = spotWindDrift(score?.windTrend, points, now);
      if (drift === 'sube' || drift === 'baja') out.set(spot.id, drift);
    }
    return out;
  }, [spots, scores, windHistory, now]);

  // Spots under a lightning danger now: the same rule as the banner, so a group cannot stay quiet beside it.
  const lightningRisks = useSpotLightningRisk();
  const lightningSpots = useMemo(
    () => new Set(lightningRisks.filter((r) => r.level === 'peligro').map((r) => r.spotId)),
    [lightningRisks],
  );

  const handleClusterClick = useCallback((cluster: SpotClusterGroup) => {
    const map = mapRef?.getMap();
    if (!map) return;
    // Fly to centroid + zoom to the threshold where the cluster will split.
    map.flyTo({ center: [cluster.lon, cluster.lat], zoom: CLUSTER_DISABLE_ZOOM + 0.5, duration: 800 });
  }, [mapRef]);

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
              danger={item.spots.map((sp) => spotDanger(scores.get(sp.id), lightningSpots.has(sp.id))).find(Boolean) ?? null}
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
        // Surf spots read THE surf verdict from the cache entry (built by
        // useSurfMarineData with the consensus wind). Spinner until it exists
        // with its wind; a dash when the forecast gave no usable hour. Over
        // the engine's hard gate the spot shows the engine's own verdict, as
        // any spot does: the wave verdict ignores wind SPEED.
        const isSurf = spot.category === 'surf';
        const surfEntry = isSurf ? surfWaveCache.get(spot.id) : undefined;
        const surfState = isSurf ? surfDisplayState(surfEntry, score) : null;
        const surfDanger = surfState === 'danger';
        // Show spinner while provisional data, or no data yet scored
        const spotLoading = isSurf && !surfDanger
          ? provisional || surfState === 'loading'
          : provisional || verdict === 'unknown';
        return (
          <SpotMarkerItem
            key={spot.id}
            spotId={spot.id}
            shortName={spot.shortName}
            lon={spot.center[0]}
            lat={spot.center[1]}
            verdict={verdict}
            windKt={provisional ? null : (score?.effectiveWindKt ?? score?.wind?.avgSpeedKt ?? null)}
            windFromDeg={provisional ? null : (displayWindDir(score)?.deg ?? null)}
            waveHeight={isSurf ? (surfEntry?.waveHeight ?? null) : (score?.waves?.waveHeight ?? null)}
            isActive={isActive}
            isLoading={spotLoading}
            isProvisional={provisional}
            onSelect={selectSpot}
            zoomScale={zoomScale}
            isSurf={isSurf}
            surfDanger={surfDanger}
            surfVerdict={surfState === 'ready' ? surfEntry?.verdict : null}
            seaGateText={gateWaveText(score)}
            seaGateWhere={gateWaveWhere(score)}
            trend={trends.get(spot.id) ?? null}
            doubtOther={ringDoubt(score, isSurf)?.other ?? null}
            doubtAbove={ringDoubt(score, isSurf)?.above ?? false}
            gusty={!isSurf && isGusty(score)}
            offsetX={spotTwinOffset(spot.id)}
          />
        );
      })}
      <ListHoverRing />
    </>
  );
});

// ── Cluster marker ──────────────────────────────────────────────

interface SpotClusterMarkerProps {
  cluster: SpotClusterGroup;
  zoomScale: number;
  onClick: (c: SpotClusterGroup) => void;
  /** A real danger in some spot of the group. Without one the group is neutral: it counts, it does not judge. */
  danger: SpotDanger | null;
}

const SpotClusterMarker = memo(function SpotClusterMarker({
  cluster,
  zoomScale,
  onClick,
  danger,
}: SpotClusterMarkerProps) {
  const r = Math.max(17, 22 * zoomScale);
  // Never under the touch target.
  const svgSize = Math.max(r * 2 + 12, 44);
  const c = svgSize / 2;

  // The Marker wrapper is the keyboard button (see markerA11y); it carries the
  // name the inner <button> used to have.
  const label = `Grupo de ${cluster.count} spots${danger ? `; peligro por ${danger}` : ''}`;
  const markerRef = useCallback(
    (mk: MarkerInstance | null) => makeMarkerButton(mk, label, () => onClick(cluster)),
    [label, onClick, cluster],
  );

  return (
    // z-index 6: spots always paint above station clusters (z-index 1).
    // Hexagon (not a circle) so a clustered group still reads as "spots",
    // distinct from the round station/buoy context clusters.
    <Marker ref={markerRef} longitude={cluster.lon} latitude={cluster.lat} anchor="center" style={{ zIndex: 26 }}>
      {/* div, not <button>: the wrapper is now the one button. A <button> inside
          role="button" is nested-interactive and a second tab stop. */}
      <div
        onClick={(e) => { e.stopPropagation(); onClick(cluster); }}
        className="relative flex items-center justify-center transition-transform hover:scale-110 cursor-pointer bg-transparent border-0 p-0"
        style={{ width: svgSize, height: svgSize }}
        title={`${cluster.count} spots${danger ? `, peligro por ${danger}` : ''}: pulsa para acercar`}
      >
        <svg width={svgSize} height={svgSize} viewBox={`0 0 ${svgSize} ${svgSize}`} style={{ position: 'absolute', inset: 0 }} aria-hidden="true">
          <polygon
            points={polygonPoints(6, r, c, c)}
            fill="var(--g-bg)"
            stroke={danger ? 'var(--g-danger)' : 'var(--g-m-ring)'}
            strokeWidth={danger ? 3 : 2}
            strokeLinejoin="round"
          />
        </svg>
        <span className="relative tabular-nums" style={{ color: 'var(--g-ink)', font: `800 ${Math.max(14, 18 * zoomScale)}px var(--g-narrow)` }}>
          {cluster.count}{danger ? '!' : ''}
        </span>
      </div>
    </Marker>
  );
});

/**
 * The doubt the ring draws: only on the lines that change a plan (12 and 18 kt), and never on a beach that reads its
 * waves. Lower lines stay out of the map, the card says them.
 */
export function ringDoubt(score: Parameters<typeof verdictDoubt>[0], isSurf: boolean): SpotDoubt | null {
  if (isSurf) return null;
  const d = verdictDoubt(score);
  if (!d || (d.high !== 'good' && d.high !== 'strong')) return null;
  const above = score!.verdict === d.low;
  return { other: above ? d.high : d.low, above };
}

// ── Individual spot marker ──────────────────────────────────────

interface SpotMarkerItemProps {
  spotId: string;
  shortName: string;
  lon: number;
  lat: number;
  verdict: SpotVerdict;
  windKt: number | null;
  /** Where the wind comes from; null when the sources disagree. */
  windFromDeg: number | null;
  waveHeight: number | null;
  isActive: boolean;
  isLoading: boolean;
  /** Cold-load provisional score — label/tooltip say "calculando" (verdict already downgraded to 'unknown' by the parent) */
  isProvisional?: boolean;
  onSelect: (id: string) => void;
  zoomScale: number;
  isSurf?: boolean;
  /** Surf spot over the engine's hard gate: badge, colours and gauge follow the
   *  wind verdict like any spot (the pentagon stays) */
  surfDanger?: boolean;
  /** THE surf verdict from the cache entry; null/undefined = no usable data */
  surfVerdict?: SurfVerdictResult | null;
  /** Spot closed by the sea (wave hard gate): «3,0 m» and where it was measured. The badge and
   *  gauge then show the SEA; the wind figure next to «FUERTE» read as a bug (Cíes, 21-oct). */
  seaGateText?: string | null;
  seaGateWhere?: string | null;
  /** The wind is going up or down; nothing when it holds or there is no way to say. */
  trend?: 'sube' | 'baja' | null;
  /** Within a knot of the 12 or the 18 kt line: the other level it may be. */
  doubtOther?: SpotVerdict | null;
  doubtAbove?: boolean;
  /** A light mean with strong gusts (isGusty): the name says «racheado». */
  gusty?: boolean;
  /** Sideways on screen, for two spots on one beach. */
  offsetX?: number;
}

/**
 * Whether a change of the badge's verdict is an upgrade worth a flash.
 * Keys are `wind:<verdict>` or `surf:<level>` (empty level = no verdict).
 * Wind: CALMA/FLOJO/— → NAVEG./BUENO/FUERTE, as before. Surf: the WAVE level
 * entering SURF OK or CLÁSICO — a beach's wind verdict says nothing about its
 * waves (an onshore wind building flashed the badge green while the surf got
 * worse), and GRANDE is not an upgrade. A switch between the two kinds
 * (hard gate on or off) is not one either.
 */
function isVerdictUpgrade(prev: string, next: string): boolean {
  const [prevKind, prevValue] = prev.split(':');
  const [nextKind, nextValue] = next.split(':');
  if (prevKind !== nextKind) return false;
  if (nextKind === 'wind') {
    return ['calm', 'light', 'unknown'].includes(prevValue) && ['sailing', 'good', 'strong'].includes(nextValue);
  }
  const prevLevel = prevValue === '' ? -1 : Number(prevValue);
  const nextLevel = nextValue === '' ? -1 : Number(nextValue);
  return (nextLevel === 2 || nextLevel === 3) && prevLevel < 2;
}

const SpotMarkerItem = memo(function SpotMarkerItem({
  spotId,
  shortName,
  lon,
  lat,
  verdict,
  windKt,
  windFromDeg,
  waveHeight,
  isActive,
  isLoading,
  isProvisional,
  onSelect,
  zoomScale,
  isSurf,
  surfDanger,
  surfVerdict,
  seaGateText,
  seaGateWhere,
  trend,
  doubtOther = null,
  doubtAbove = false,
  gusty = false,
  offsetX = 0,
}: SpotMarkerItemProps) {
  const ink = useMapInk();
  // A surf spot shows its WAVE verdict unless the engine's hard gate is on, where it reads the wind verdict like any
  // spot. The pentagon stays either way: the shape says what kind of spot it is.
  const surfWaveMode = !!isSurf && !surfDanger;
  // Surf spots: THE verdict from the cache entry (same one list, popup and ticker read). No fallback of its own:
  // without it the shape says there is nothing yet.
  const surfV = surfWaveMode && surfVerdict ? surfVerdict : null;

  // Verdict upgrade flash (see isVerdictUpgrade). The key changes only with
  // the verdict the badge shows, so a sailing spot behaves exactly as before.
  const flashKey = surfWaveMode ? `surf:${surfV?.level ?? ''}` : `wind:${verdict}`;
  const prevFlashKeyRef = useRef(flashKey);
  const [upgradeFlash, setUpgradeFlash] = useState(false);
  useEffect(() => {
    const prev = prevFlashKeyRef.current;
    prevFlashKeyRef.current = flashKey;
    if (isVerdictUpgrade(prev, flashKey)) {
      setUpgradeFlash(true);
      const t = setTimeout(() => setUpgradeFlash(false), 3000);
      return () => clearTimeout(t);
    }
  }, [flashKey]);

  const handleClick = useCallback(
    (e: { originalEvent: MouseEvent }) => {
      e.originalEvent.stopPropagation();
      onSelect(spotId);
    },
    [onSelect, spotId],
  );

  const surfHeight = waveHeight !== null ? formatSurfWave(waveHeight) : null;
  // What goes inside the shape: the sea when it closes the spot (the wind figure next to «FUERTE» read as a bug, Cíes,
  // 21-oct), the wave at the beach (a model, hence the «~»), otherwise the wind. Nothing while it is being worked out.
  const figure = isLoading ? null
    : seaGateText ? seaGateText.replace(' m', '')
    : surfWaveMode ? (surfV ? (waveHeight !== null && waveHeight >= 0.3 ? surfHeight!.replace(' m', '') : surfV.label) : null)
    : (windKt !== null && verdict !== 'unknown' ? windKt.toFixed(0) : null);
  // The ring fills with what the figure says, up to 20 kt or 2,5 m. Nothing while there is no figure.
  const gauge = figure == null ? null
    : seaGateText || surfWaveMode ? (waveHeight ?? 0) / 2.5
    : (windKt ?? 0) / 20;
  // The state in a word: only on the one selected, the colour already says it. A closed spot always says it, because
  // its figure is not wind.
  const word = isLoading ? '' : seaGateText ? 'oleaje' : surfWaveMode ? (surfV?.label ?? '') : (VERDICT_STYLE[verdict]?.label ?? '');
  const badgeText = surfWaveMode
    ? (surfV ? `${surfV.label}${waveHeight !== null && waveHeight >= 0.3 ? ` ${surfHeight}` : ''}` : 'sin dato')
    : `${word}${figure ? ` ${figure} kt` : ''}${figure && windFromDeg != null && !seaGateText ? ` del ${degreesToCardinal(windFromDeg)}` : ''}`;

  // Same text the inner <svg> used to carry; it now names the wrapper, which is
  // the element MapLibre exposes as role="button". Enter/Space select the spot
  // exactly like a click does.
  const calculating = isProvisional || (surfWaveMode && isLoading);
  const ariaLabel = calculating
    ? `Spot ${shortName}: calculando condiciones`
    : surfWaveMode
      ? (surfV ? `Spot ${shortName}: ${badgeText} (olas: modelo)` : `Spot ${shortName}: sin dato de olas`)
      : seaGateText
        ? `Spot ${shortName}: oleaje de ${seaGateText} ${seaGateWhere ?? ''}`
        : `Spot ${shortName}: ${badgeText}${gusty ? `, ${GUSTY_LABEL}` : ''}${trend ? `, ${trend}` : ''}`;
  // The hover title says what the «~» means: the only surface where the word
  // «modelo» does not fit on screen.
  const title = calculating
    ? `${shortName} — calculando condiciones`
    : seaGateText ? `${shortName} — oleaje de ${seaGateText} ${seaGateWhere ?? ''}; no es viento`
    : surfV ? `${shortName}: ${badgeText}. Olas: modelo, nadie las mide en la playa`
    : trend ? `${shortName} — el viento ${trend}, últimos 45 minutos frente al rato anterior` : shortName;
  const markerRef = useCallback(
    (mk: MarkerInstance | null) => makeMarkerButton(mk, ariaLabel, () => onSelect(spotId)),
    [ariaLabel, onSelect, spotId],
  );

  return (
    // z-index above station clusters (1); active spot floats above other spots.
    <Marker ref={markerRef} longitude={lon} latitude={lat} anchor="center" offset={[offsetX, 0]} onClick={handleClick} style={{ zIndex: isActive ? 28 : 26 }}>
      <div className="spot-marker relative cursor-pointer" title={title} style={{ transform: `scale(${zoomScale})`, transformOrigin: 'center' }}>
        <div className={upgradeFlash ? 'animate-verdict-pop' : undefined}>
          <SpotShape pentagon={isSurf} hollow={surfWaveMode} verdict={surfV ? surfTone(surfV.level) : verdict} tone={surfWaveMode || surfV ? null : windToneOver(verdict, windKt)} value={figure} gauge={gauge} doubt={doubtOther && !seaGateText && !surfWaveMode ? { other: doubtOther, above: doubtAbove } : null} fromDeg={!seaGateText && !surfWaveMode ? windFromDeg : null} big={isActive} />
        </div>

        {/* Name under it, with where the wind is going when it is going somewhere. Same size on screen at any zoom. */}
        <div
          className="absolute left-1/2 pointer-events-none whitespace-nowrap"
          style={{
            top: '100%',
            transform: 'translateX(-50%)',
            marginTop: -9,
            textAlign: 'center',
            font: `${isActive ? 700 : 600} ${MARKER_TEXT_PX / zoomScale}px/1.2 var(--g-font)`,
            color: ink.text,
            textShadow: ink.shadow,
          } as React.CSSProperties}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3em' }}>
            {shortName}
            {!isLoading && trend && <TrendArrow drift={trend} size="0.9em" />}
          </span>
          {word && (isActive || seaGateText) && <div style={{ fontWeight: 800 }}>{word}</div>}
        </div>
      </div>
    </Marker>
  );
});
