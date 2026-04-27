/**
 * FireOverlay — NASA FIRMS active wildfire hotspots on the map.
 *
 * Auto-renders when there are any active fires in the FIRMS pull. No toggle.
 * Markers scale by FRP (fire radiative power, MW) and tint by confidence.
 *
 * Lazy-loaded behind <Suspense> from WeatherMap (negligible cost when there
 * are no fires — the Source has zero features and MapLibre skips render).
 */

import { memo, useMemo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import type { GeoJSON } from 'geojson';
import { useFireStore } from '../../store/fireStore';

const SOURCE_ID = 'firms-fires';

function FireOverlayInner() {
  const fires = useFireStore((s) => s.fires);

  const geojson = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: fires.map((f) => ({
      type: 'Feature',
      id: f.id,
      properties: {
        frp: f.frp,
        brightness: f.brightness,
        confidence: f.confidence,
        // MapLibre filter expressions can't compare strings to bool, encode rank
        confRank: f.confidence === 'high' ? 2 : f.confidence === 'nominal' ? 1 : 0,
        acquiredAtIso: f.acquiredAt.toISOString(),
        satellite: f.satellite,
        daynight: f.daynight,
      },
      geometry: { type: 'Point', coordinates: [f.lon, f.lat] },
    })),
  }), [fires]);

  if (fires.length === 0) return null;

  return (
    <Source id={SOURCE_ID} type="geojson" data={geojson}>
      {/* Pulsing halo — large outer ring */}
      <Layer
        id="firms-halo"
        type="circle"
        source={SOURCE_ID}
        paint={{
          // Halo radius scales with FRP: 12px @ 1MW → 30px @ ≥100MW
          'circle-radius': [
            'interpolate', ['linear'], ['get', 'frp'],
            1, 12,
            10, 16,
            50, 22,
            100, 30,
          ],
          'circle-color': '#ef4444',
          'circle-opacity': 0.15,
          'circle-blur': 0.6,
        }}
      />
      {/* Solid core */}
      <Layer
        id="firms-core"
        type="circle"
        source={SOURCE_ID}
        paint={{
          'circle-radius': [
            'interpolate', ['linear'], ['get', 'frp'],
            1, 4,
            10, 6,
            50, 9,
            100, 12,
          ],
          // Tint by confidence: nominal = orange, high = bright red
          'circle-color': [
            'match', ['get', 'confidence'],
            'high', '#dc2626',
            'nominal', '#f97316',
            '#fbbf24', // low (already filtered out, defensive default)
          ],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.2,
          'circle-stroke-opacity': 0.9,
          'circle-opacity': 0.9,
        }}
      />
    </Source>
  );
}

export const FireOverlay = memo(FireOverlayInner);
