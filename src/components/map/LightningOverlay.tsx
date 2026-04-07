import { useMemo, memo } from 'react';
import { Source, Layer, Marker } from 'react-map-gl/maplibre';
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
  const clusters = useLightningStore((s) => s.clusters);

  const geojson = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showOverlay || strikes.length === 0) return EMPTY_FC;

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
          // Age bucket for styling: 0=fresh, 1=recent, 2=old, 3=ancient
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
    </Source>
    {/* Storm cluster velocity arrows */}
    {clusters.filter((c) => c.velocity != null && c.velocity.speedKmh > 5).map((c, i) => {
      const v = c.velocity!; // safe — filter guarantees non-null
      return (
        <Marker key={`storm-${i}`} latitude={c.centroidLat} longitude={c.centroidLon} anchor="center">
          <svg
            width="32" height="32" viewBox="-16 -16 32 32"
            style={{ transform: `rotate(${v.bearingDeg}deg)`, opacity: 0.7, pointerEvents: 'none' }}
          >
            <line x1="0" y1="8" x2="0" y2="-10" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M-5,-4 L0,-12 L5,-4" fill="none" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div style={{ position: 'absolute', top: 18, left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap', fontSize: 10, color: '#fca5a5', fontWeight: 600, textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
            {v.speedKmh.toFixed(0)} km/h
            {c.etaMinutes != null && c.approaching ? ` \u00b7 ${c.etaMinutes.toFixed(0)}min` : ''}
          </div>
        </Marker>
      );
    })}
    </>
  );
});
