/**
 * SmokePlumeOverlay — fan-shaped translucent plumes downwind of FIRMS hotspots.
 *
 * Cross-feature reactive layer: fires (from useFireStore) + wind (from
 * useWeatherStore) → directional smoke polygons. Auto-renders when both
 * data sources have content. Pure visual — no I/O, no toggle.
 *
 * Length scales with FRP, direction = wind drift TO. Calm fires (<2kt
 * nearest wind) emit no plume — physics check matches reality.
 */

import { memo, useMemo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import type { GeoJSON } from 'geojson';
import { useFireStore } from '../../store/fireStore';
import { useWeatherStore } from '../../store/weatherStore';
import { msToKnots } from '../../services/windUtils';
import { buildAllPlumes } from '../../services/smokePlumeService';

const SOURCE_ID = 'firms-smoke-plumes';

function SmokePlumeOverlayInner() {
  const fires = useFireStore((s) => s.fires);
  const stations = useWeatherStore((s) => s.stations);
  const readings = useWeatherStore((s) => s.currentReadings);

  const plumes = useMemo(() => {
    if (fires.length === 0 || stations.length === 0) return [];

    // Build wind sample list from current sector readings
    const windStations = stations
      .map((s) => {
        const r = readings.get(s.id);
        if (!r) return null;
        // Filter stale (>30min)
        if (r.timestamp && Date.now() - r.timestamp.getTime() > 30 * 60_000) return null;
        if (r.windSpeed == null || r.windDirection == null) return null;
        return {
          lat: s.lat,
          lon: s.lon,
          windDirDeg: r.windDirection,
          windKt: msToKnots(r.windSpeed),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    return buildAllPlumes(fires, windStations);
  }, [fires, stations, readings]);

  const geojson = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: plumes.map((p) => ({
      type: 'Feature',
      id: p.fireId,
      properties: {
        fireId: p.fireId,
        lengthKm: p.lengthKm,
        bearingTo: p.bearingTo,
      },
      geometry: { type: 'Polygon', coordinates: p.polygon },
    })),
  }), [plumes]);

  if (plumes.length === 0) return null;

  return (
    <Source id={SOURCE_ID} type="geojson" data={geojson}>
      {/* Outer soft halo — diffuse smoke at the edge */}
      <Layer
        id="firms-smoke-fill"
        type="fill"
        source={SOURCE_ID}
        paint={{
          'fill-color': '#9a8270', // brownish-grey, matches haze tint
          'fill-opacity': 0.18,
          'fill-antialias': true,
        }}
      />
      {/* Subtle border — outline the plume direction */}
      <Layer
        id="firms-smoke-outline"
        type="line"
        source={SOURCE_ID}
        paint={{
          'line-color': '#7a6452',
          'line-opacity': 0.35,
          'line-width': 1,
          'line-dasharray': [2, 3],
        }}
      />
    </Source>
  );
}

export const SmokePlumeOverlay = memo(SmokePlumeOverlayInner);
