/**
 * Gust Front Overlay — visual pulse on stations marking storm outflow.
 *
 * Subscribes to `useLightningStore.gustFronts` (computed by useLightningData
 * via `detectGustFronts`). Renders a colored circle pulse + label at each
 * detected station so the user instantly sees "the storm is reaching here
 * AHEAD of its body".
 *
 * Color: orange (#f97316) for medium confidence, deep red (#dc2626) for high.
 *        Both pulse via interpolated radius to draw the eye without blocking
 *        the station marker underneath.
 *
 * S126+1 v2.69.0 — phase 1 (visual). Phase 2 (DB persistence) planned in
 * memory/pending-work.md.
 */
import { memo, useMemo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { useLightningStore } from '../../hooks/useLightningData';

function GustFrontOverlayInner() {
  const gustFronts = useLightningStore((s) => s.gustFronts);
  const showOverlay = useLightningStore((s) => s.showOverlay);

  const geoJson = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showOverlay || gustFronts.length === 0) {
      return { type: 'FeatureCollection', features: [] };
    }
    return {
      type: 'FeatureCollection',
      features: gustFronts.map((f) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [f.lon, f.lat] },
        properties: {
          stationId: f.stationId,
          stationName: f.stationName,
          confidence: f.confidence,
          ratio: f.ratio,
          gustKt: f.gustKt,
          windKt: f.windKt,
          clusterDistKm: f.clusterDistKm,
          // Pre-built label for the symbol layer
          label: `Outflow ${f.gustKt.toFixed(0)}kt × ${f.ratio.toFixed(1)}`,
        },
      })),
    };
  }, [showOverlay, gustFronts]);

  if (gustFronts.length === 0) return null;

  return (
    <Source id="gust-front" type="geojson" data={geoJson}>
      {/* Outer glow halo — wide, blurred, low opacity. Pulse-y feel. */}
      <Layer
        id="gust-front-glow"
        type="circle"
        paint={{
          'circle-radius': 22,
          'circle-color': [
            'match', ['get', 'confidence'],
            'high',   'rgba(220, 38, 38, 0.30)',  // red-600
            /* medium */ 'rgba(249, 115, 22, 0.28)', // orange-500
          ],
          'circle-blur': 0.8,
        }}
      />
      {/* Mid ring — outline emphasizes the station as "alerted" */}
      <Layer
        id="gust-front-ring"
        type="circle"
        paint={{
          'circle-radius': 14,
          'circle-color': 'transparent',
          'circle-stroke-color': [
            'match', ['get', 'confidence'],
            'high',   '#dc2626',
            /* medium */ '#f97316',
          ],
          'circle-stroke-width': 2,
          'circle-stroke-opacity': 0.85,
        }}
      />
      {/* Inner solid dot — color-coded by confidence */}
      <Layer
        id="gust-front-dot"
        type="circle"
        paint={{
          'circle-radius': 5,
          'circle-color': [
            'match', ['get', 'confidence'],
            'high',   '#dc2626',
            /* medium */ '#f97316',
          ],
          'circle-stroke-color': '#0f172a',
          'circle-stroke-width': 1.5,
        }}
      />
      {/* Label — only renders when zoomed in enough to keep noise low */}
      <Layer
        id="gust-front-label"
        type="symbol"
        minzoom={9.5}
        layout={{
          'text-field': ['get', 'label'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 11,
          'text-offset': [0, 1.8],
          'text-allow-overlap': false,
          'text-optional': true,
        }}
        paint={{
          'text-color': [
            'match', ['get', 'confidence'],
            'high',   '#fecaca',  // red-200 for high
            /* medium */ '#fed7aa', // orange-200 for medium
          ],
          'text-halo-color': '#0f172a',
          'text-halo-width': 1.5,
        }}
      />
    </Source>
  );
}

export const GustFrontOverlay = memo(GustFrontOverlayInner);
