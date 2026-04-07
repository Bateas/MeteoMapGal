import { useMemo, memo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { useLightningStore } from '../../hooks/useLightningData';

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

/**
 * Lightning strike overlay on the map.
 *
 * Uses circle layers with age-based styling:
 * - Newer strikes (< 15 min): bright yellow, larger
 * - Medium age (15-60 min): orange, medium
 * - Older strikes (1-6h): dim red, smaller
 * - Very old (6-24h): faint gray, tiny
 *
 * Cloud-to-ground vs intra-cloud differentiated by opacity.
 */
export const LightningOverlay = memo(function LightningOverlay() {
  const strikes = useLightningStore((s) => s.strikes);
  const showOverlay = useLightningStore((s) => s.showOverlay);
  // clusters rendered by StormClusterOverlay (arrows + info labels)

  const geojson = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showOverlay || strikes.length === 0) return EMPTY_FC;

    // Filter out strikes > 6h old — they just clutter the map
    const visible = strikes.filter((s) => s.ageMinutes < 360);

    return {
      type: 'FeatureCollection',
      features: visible.map((strike) => ({
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
          // Age bucket for styling: 0=fresh (<15m), 1=recent (15-60m), 2=old (1-6h)
          ageBucket:
            strike.ageMinutes < 15
              ? 0
              : strike.ageMinutes < 60
                ? 1
                : 2,
        },
      })),
    };
  }, [strikes, showOverlay]);

  if (!showOverlay) return null;

  return (
    <>
    <Source id="lightning-strikes" type="geojson" data={geojson}>
      {/* Glow halo behind each strike */}
      <Layer
        id="lightning-glow"
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
        id="lightning-core"
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
            ['match', ['get', 'ageBucket'], 0, 1, 1, 0.85, 2, 0.4, 0.2],
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
    </Source>
    {/* Velocity arrows rendered by StormClusterOverlay (GeoJSON + info labels) */}
    </>
  );
});
