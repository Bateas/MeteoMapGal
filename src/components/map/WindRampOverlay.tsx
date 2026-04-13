/**
 * WindRampOverlay — pulsing glow on stations with rapid wind increase.
 *
 * Auto-reactive: analyzes readingHistory for wind ramps +6kt/30min.
 * No buttons — stations glow orange when wind ramps rapidly.
 *
 * Separate GeoJSON source with only ramping stations.
 * MapLibre circle layer with smooth opacity transitions.
 */

import { useMemo, memo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { useWeatherStore } from '../../store/weatherStore';
import { analyzeWindTrend } from '../../services/windTrendService';

const RAPID_THRESHOLD_KT = 6;

export const WindRampOverlay = memo(function WindRampOverlay() {
  const stations = useWeatherStore((s) => s.stations);
  const currentReadings = useWeatherStore((s) => s.currentReadings);
  const readingHistory = useWeatherStore((s) => s.readingHistory);
  const epoch = useWeatherStore((s) => s.readingsEpoch);

  const rampGeoJson = useMemo<GeoJSON.FeatureCollection>(() => {
    const features: GeoJSON.Feature[] = [];

    for (const station of stations) {
      const history = readingHistory.get(station.id);
      const current = currentReadings.get(station.id);
      if (!history || history.length < 3) continue;

      const trend = analyzeWindTrend(history, current ?? undefined);
      if (!trend || trend.signal !== 'rapid') continue;
      if (trend.currentKt < 4) continue; // ignore ramps from calm

      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [station.lon, station.lat] },
        properties: {
          id: station.id,
          deltaKt: trend.deltaKt,
          currentKt: trend.currentKt,
          intensity: Math.min(1.0, (trend.deltaKt - RAPID_THRESHOLD_KT) / 6 + 0.5),
        },
      });
    }

    return { type: 'FeatureCollection', features };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stations, epoch]);

  if (rampGeoJson.features.length === 0) return null;

  return (
    <Source id="wind-ramp-src" type="geojson" data={rampGeoJson}>
      <Layer
        id="wind-ramp-glow"
        type="circle"
        paint={{
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 18, 12, 30],
          'circle-color': '#f97316',
          'circle-opacity': [
            'interpolate', ['linear'], ['get', 'intensity'],
            0.5, 0.12,
            1.0, 0.25,
          ],
          'circle-blur': 0.8,
          'circle-opacity-transition': { duration: 1000, delay: 0 },
          'circle-radius-transition': { duration: 1000, delay: 0 },
        }}
      />
      <Layer
        id="wind-ramp-ring"
        type="circle"
        paint={{
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 10, 12, 18],
          'circle-color': 'transparent',
          'circle-stroke-color': '#fb923c',
          'circle-stroke-width': 2,
          'circle-stroke-opacity': [
            'interpolate', ['linear'], ['get', 'intensity'],
            0.5, 0.3,
            1.0, 0.6,
          ],
        }}
      />
    </Source>
  );
});
