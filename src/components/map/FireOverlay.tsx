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
import type { FeatureCollection } from 'geojson';
import { useFireStore } from '../../store/fireStore';
import { fireAttributionKey } from '../../api/firmsClient';

const SOURCE_ID = 'firms-fires';

function FireOverlayInner() {
  const fires = useFireStore((s) => s.fires);
  const attribution = useFireStore((s) => s.attribution);

  const geojson = useMemo<FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: fires.map((f) => {
      const lit = attribution.get(fireAttributionKey(f.lat, f.lon));
      return {
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
          // Lightning origin, when our own strike history accounts for it.
          // 0 = no known cause; never means "not checked".
          litByLightning: lit ? 1 : 0,
          lightningLabel: lit?.hoursAfterStrike != null
            ? `rayo ${Math.round(lit.hoursAfterStrike)}h`
            : '',
        },
        geometry: { type: 'Point', coordinates: [f.lon, f.lat] },
      };
    }),
  }), [fires, attribution]);

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
          // Purple ring when a strike lit it — the same purple lightning wears
          // everywhere else on the map, so the link reads without a legend.
          'circle-stroke-color': [
            'case', ['==', ['get', 'litByLightning'], 1], '#a855f7', '#ffffff',
          ],
          'circle-stroke-width': [
            'case', ['==', ['get', 'litByLightning'], 1], 2.2, 1.2,
          ],
          'circle-stroke-opacity': 0.9,
          'circle-opacity': 0.9,
        }}
      />
      {/* How long the strike smouldered before the satellite saw it */}
      <Layer
        id="firms-lightning-label"
        type="symbol"
        source={SOURCE_ID}
        filter={['==', ['get', 'litByLightning'], 1]}
        minzoom={8}
        layout={{
          'text-field': ['get', 'lightningLabel'],
          // Explicit font: the default stack 404s on the protomaps CDN
          'text-font': ['Noto Sans Regular'],
          'text-size': 10,
          'text-offset': [0, 1.6],
          'text-anchor': 'top',
          'text-allow-overlap': false,
          'text-optional': true,
        }}
        paint={{
          'text-color': '#c084fc',
          'text-halo-color': '#0f172a',
          'text-halo-width': 1.2,
        }}
      />
    </Source>
  );
}

export const FireOverlay = memo(FireOverlayInner);
