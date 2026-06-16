import { useMemo, memo, useState, useEffect, useRef, useCallback } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { useLightningStore } from '../../hooks/useLightningData';
import type { LightningStrike } from '../../types/lightning';

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

/** Min interval between historical-source rebuilds. The bulk of the 24h
 *  strikes live here; re-serializing thousands of features to the worker on
 *  every poll caused a main-thread spike. Aging from 2h→2h10m never flips an
 *  ageBucket, so a stale-by-10-min historical layer is visually identical. */
const HIST_REBUILD_MS = 10 * 60 * 1000;
/** Historical source = strikes at/above this age. */
const HIST_MIN_AGE_MIN = 60;
/** Live source = strikes below this age. It overlaps the historical band by
 *  10 min (= the rebuild window) on purpose: a strike crossing 60 min must stay
 *  rendered by the always-fresh live source until the throttled historical
 *  rebuild picks it up, otherwise it would vanish from BOTH sources for up to
 *  HIST_REBUILD_MS. The 60-70 min overlap is double-rendered (old, low-opacity
 *  context strikes — visually negligible) but never leaves a gap. */
const LIVE_MAX_AGE_MIN = HIST_MIN_AGE_MIN + 10; // 70

function buildFeatures(strikes: LightningStrike[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: strikes.map((strike) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [strike.lon, strike.lat],
      },
      properties: {
        id: strike.id,
        ageMinutes: strike.ageMinutes,
        peakCurrent: Math.abs(strike.peakCurrent),
        cloudToCloud: strike.cloudToCloud ? 1 : 0,
        multiplicity: strike.multiplicity,
        // Age bucket: 0=fresh (<15m), 1=recent (15-60m), 2=old (1-6h), 3=ancient (6-24h)
        ageBucket:
          strike.ageMinutes < 15
            ? 0
            : strike.ageMinutes < 60
              ? 1
              : strike.ageMinutes < 360
                ? 2
                : 3,
      },
    })),
  };
}

/**
 * Glow halo + core dot layers for one strike source.
 * `source` is passed EXPLICITLY (not inherited): react-map-gl's <Source> injects
 * the source id only into its DIRECT children via cloneElement, so wrapping the
 * Layers in this component would leave them source-less (they'd silently render
 * nothing — the v2.84.22 regression). Identical age-based styling for both sources.
 */
function StrikeLayers({ idPrefix, sourceId }: { idPrefix: string; sourceId: string }) {
  return (
    <>
      {/* Glow halo behind each strike */}
      <Layer
        id={`${idPrefix}-glow`}
        source={sourceId}
        type="circle"
        paint={{
          'circle-radius': [
            'match',
            ['get', 'ageBucket'],
            0, 14,   // fresh: large glow
            1, 10,   // recent
            2, 6,    // old
            4,       // ancient
          ],
          'circle-color': [
            'match',
            ['get', 'ageBucket'],
            0, '#fbbf24', // amber
            1, '#f97316', // orange
            2, '#ef4444', // red
            '#6b7280',    // gray
          ],
          'circle-opacity': [
            'match',
            ['get', 'ageBucket'],
            0, 0.35,
            1, 0.2,
            2, 0.12,
            0.06,
          ],
          'circle-blur': 1,
        }}
      />

      {/* Core dot */}
      <Layer
        id={`${idPrefix}-core`}
        source={sourceId}
        type="circle"
        paint={{
          'circle-radius': [
            'match',
            ['get', 'ageBucket'],
            0, 5,
            1, 4,
            2, 3,
            2,
          ],
          'circle-color': [
            'match',
            ['get', 'ageBucket'],
            0, '#fef08a', // yellow-200 (bright flash)
            1, '#fbbf24', // amber-400
            2, '#dc2626', // red-600
            '#9ca3af',    // gray-400
          ],
          'circle-opacity': [
            '*',
            ['match', ['get', 'ageBucket'], 0, 1, 1, 0.85, 2, 0.6, 0.3],
            // Reduce opacity for intra-cloud strikes
            ['match', ['get', 'cloudToCloud'], 1, 0.6, 1],
          ],
          'circle-stroke-width': [
            'match',
            ['get', 'ageBucket'],
            0, 2,
            1, 1.5,
            2, 1,
            0.5,
          ],
          'circle-stroke-color': [
            'match',
            ['get', 'ageBucket'],
            0, '#f59e0b',
            1, '#ea580c',
            2, '#991b1b',
            '#6b7280',
          ],
          'circle-stroke-opacity': [
            'match',
            ['get', 'ageBucket'],
            0, 0.9,
            1, 0.6,
            2, 0.4,
            0.2,
          ],
        }}
      />
    </>
  );
}

/**
 * Lightning strike overlay on the map.
 *
 * Split into two GeoJSON sources to keep the main thread responsive:
 * - LIVE (<60 min): rebuilt every poll. Small (dozens), so re-serializing it
 *   to the MapLibre worker is cheap.
 * - HISTORICAL (1-24h): the bulk of the strikes (thousands). Rebuilt at most
 *   every 10 min, so `setData` no longer re-serializes thousands of features
 *   on every poll (which spiked the main thread on load/poll/pan).
 *
 * Both use age-based circle styling (newer = bright/large, older = dim/small).
 * Live renders above historical so fresh strikes stay prominent.
 */
export const LightningOverlay = memo(function LightningOverlay() {
  const strikes = useLightningStore((s) => s.strikes);
  const showOverlay = useLightningStore((s) => s.showOverlay);
  // clusters rendered by StormClusterOverlay (arrows + info labels)

  // Live source: recompute every poll (cheap — only the last hour of strikes).
  const liveGeojson = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showOverlay || strikes.length === 0) return EMPTY_FC;
    return buildFeatures(strikes.filter((s) => s.ageMinutes < LIVE_MAX_AGE_MIN));
  }, [strikes, showOverlay]);

  // Historical source: throttled rebuild (≥10 min apart) — avoids re-serializing
  // thousands of 1-24h strikes to the worker on every poll.
  const [histGeojson, setHistGeojson] = useState<GeoJSON.FeatureCollection>(EMPTY_FC);
  const lastHistBuildRef = useRef(0);
  // Latest strikes, readable by the interval fallback without re-subscribing it.
  const strikesRef = useRef(strikes);
  strikesRef.current = strikes;

  const rebuildHistorical = useCallback(() => {
    const now = Date.now();
    if (now - lastHistBuildRef.current < HIST_REBUILD_MS) return;
    lastHistBuildRef.current = now;
    setHistGeojson(buildFeatures(strikesRef.current.filter((s) => s.ageMinutes >= HIST_MIN_AGE_MIN)));
  }, []);

  // Rebuild on strikes change (throttled) + immediately on enable; clear on disable.
  useEffect(() => {
    if (!showOverlay) {
      setHistGeojson(EMPTY_FC);
      lastHistBuildRef.current = 0; // force an immediate rebuild when re-enabled
      return;
    }
    rebuildHistorical();
  }, [strikes, showOverlay, rebuildHistorical]);

  // Self-scheduled fallback: keep the historical layer aging even if the strikes
  // array goes reference-stable (e.g. the client returns a cached same-ref array
  // → the effect above stops firing). Without this the historical source could
  // freeze with strikes stuck past their real age. Throttle guard makes it a
  // no-op when the strikes effect already rebuilt recently.
  useEffect(() => {
    if (!showOverlay) return;
    const id = setInterval(rebuildHistorical, HIST_REBUILD_MS);
    return () => clearInterval(id);
  }, [showOverlay, rebuildHistorical]);

  if (!showOverlay) return null;

  return (
    <>
      {/* Historical first → renders BELOW live. buffer:0 — strikes are points;
          the default 128px tile buffer duplicates features into neighboring
          tiles → costly re-tiling on pan with a 24h GeoJSON. */}
      <Source id="lightning-strikes-hist" type="geojson" data={histGeojson} buffer={0}>
        <StrikeLayers idPrefix="lightning-hist" sourceId="lightning-strikes-hist" />
      </Source>
      <Source id="lightning-strikes-live" type="geojson" data={liveGeojson} buffer={0}>
        <StrikeLayers idPrefix="lightning-live" sourceId="lightning-strikes-live" />
      </Source>
    </>
  );
});
