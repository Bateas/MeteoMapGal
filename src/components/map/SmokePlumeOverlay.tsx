/**
 * SmokePlumeOverlay — one fan-shaped plume downwind of each active FIRE.
 *
 * Cross-feature reactive layer: fires (from useFireStore, grouped into fires by
 * selectFireClusters) + wind (from useWeatherStore) → directional smoke
 * polygons. Auto-renders when both data sources have content. Pure visual —
 * no I/O, no toggle.
 *
 * Two rules that were previously broken, both about not drawing fiction:
 *  - ONE plume per fire. Drawing one per hotspot stacked a dozen translucent
 *    fans over the same flames, and stacked translucency compounds until the
 *    map is an opaque brown smear.
 *  - Only from fires seen in the last few hours. A plume crosses the fire's
 *    position with the wind blowing RIGHT NOW; pairing that with a hotspot from
 *    20h ago paints smoke over places where there is none.
 *
 * Length scales with the fire's FRP, direction = wind drift TO. Calm fires
 * (<2kt nearest wind) emit no plume — physics check matches reality.
 */

import { memo, useMemo, useState, useEffect } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import type { FeatureCollection } from 'geojson';
import { useFireStore } from '../../store/fireStore';
import { useWeatherStore } from '../../store/weatherStore';
import { msToKnots } from '../../services/windUtils';
import { nearestWindFromStations, plumeLengthKm, buildPlumePolygon } from '../../services/smokePlumeService';
import { selectFireClusters, canDrawSmoke } from '../../services/fireClustering';

const SOURCE_ID = 'firms-smoke-plumes';

/** Wind moves in minutes; re-check which fires still qualify for a plume. */
const AGE_TICK_MS = 60_000;

/** Below this the air is calm — no directed plume worth drawing. */
const MIN_PLUME_WIND_KT = 2;

function SmokePlumeOverlayInner() {
  const fires = useFireStore((s) => s.fires);
  const stations = useWeatherStore((s) => s.stations);
  const readings = useWeatherStore((s) => s.currentReadings);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => {
      if (document.hidden) return;
      setNow(Date.now());
    }, AGE_TICK_MS);
    return () => clearInterval(iv);
  }, []);

  // Same cluster list the map markers and the ticker read.
  const clusters = selectFireClusters(fires);

  const plumes = useMemo(() => {
    if (clusters.length === 0 || stations.length === 0) return [];

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

    const out: { id: string; polygon: number[][][]; lengthKm: number; bearingTo: number }[] = [];
    for (const c of clusters) {
      if (!canDrawSmoke(c, now)) continue;
      const wind = nearestWindFromStations(c.lat, c.lon, windStations);
      if (!wind || wind.speedKt < MIN_PLUME_WIND_KT) continue;
      // Wind direction is meteorological "from"; smoke drifts to the opposite.
      const bearingTo = (wind.dirDeg + 180) % 360;
      const lengthKm = plumeLengthKm(c.frpMw);
      out.push({
        id: c.id,
        polygon: buildPlumePolygon(c.lat, c.lon, bearingTo, lengthKm),
        lengthKm,
        bearingTo,
      });
    }
    return out;
  }, [clusters, stations, readings, now]);

  const geojson = useMemo<FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: plumes.map((p) => ({
      type: 'Feature',
      id: p.id,
      properties: {
        fireId: p.id,
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
