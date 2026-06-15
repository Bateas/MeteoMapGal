import { useMemo, memo, useState, useEffect, useRef } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { useLightningStore } from '../../hooks/useLightningData';
import type { LightningStrike } from '../../types/lightning';

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

/** Strikes younger than this go to the "live" source (rebuilt every poll);
 *  older ones go to the "historical" source (rebuilt at most every 10 min). */
const LIVE_MAX_AGE_MIN = 60;
/** Min interval between historical-source rebuilds. The bulk of the 24h
 *  strikes live here; re-serializing thousands of features to the worker on
 *  every poll caused a main-thread spike. Aging from 2h→2h10m never flips an
 *  ageBucket, so a stale-by-10-min historical layer is visually identical. */
const HIST_REBUILD_MS = 10 * 60 * 1000;

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
 * Rendered as children of a <Source>; the source binds via react-map-gl context.
 * Identical age-based styling for both the live and historical sources.
 */
function StrikeLayers({ idPrefix }: { idPrefix: string }) {
  return (
    <>
      {/* Glow halo behind each strike */}
      <Layer
        id={`${idPrefix}-glow`}
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
  useEffect(() => {
    if (!showOverlay) {
      setHistGeojson(EMPTY_FC);
      lastHistBuildRef.current = 0; // force an immediate rebuild when re-enabled
      return;
    }
    const now = Date.now();
    if (now - lastHistBuildRef.current < HIST_REBUILD_MS) return;
    lastHistBuildRef.current = now;
    setHistGeojson(buildFeatures(strikes.filter((s) => s.ageMinutes >= LIVE_MAX_AGE_MIN)));
  }, [strikes, showOverlay]);

  if (!showOverlay) return null;

  return (
    <>
      {/* Historical first → renders BELOW live. buffer:0 — strikes are points;
          the default 128px tile buffer duplicates features into neighboring
          tiles → costly re-tiling on pan with a 24h GeoJSON. */}
      <Source id="lightning-strikes-hist" type="geojson" data={histGeojson} buffer={0}>
        <StrikeLayers idPrefix="lightning-hist" />
      </Source>
      <Source id="lightning-strikes-live" type="geojson" data={liveGeojson} buffer={0}>
        <StrikeLayers idPrefix="lightning-live" />
      </Source>
    </>
  );
});
