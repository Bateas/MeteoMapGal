/**
 * WindRampOverlay — pulsing glow on stations with rapid wind increase.
 *
 * Auto-reactive: reads wind trend alerts from alertStore.
 * No buttons, no user interaction — stations glow when wind ramps +6kt/30min.
 *
 * Implementation: separate GeoJSON source with only ramping stations.
 * MapLibre circle layer with CSS-animated opacity for pulse effect.
 * Lightweight — decoupled from StationSymbolLayer.
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

  // Find stations with rapid wind ramp — recompute when readings change
  const rampGeoJson = useMemo<GeoJSON.FeatureCollection>(() => {
    const features: GeoJSON.Feature[] = [];

    for (const station of stations) {
      const history = readingHistory.get(station.id);
      const current = currentReadings.get(station.id);
      if (!history || history.length < 3) continue;

      const trend = analyzeWindTrend(history, current ?? undefined);
      if (!trend || trend.signal !== 'rapid') continue;
      if (trend.currentKt < 4) continue; // ignore ramps from 0→6kt calm

      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [station.lon, station.lat] },
        properties: {
          id: station.id,
          deltaKt: trend.deltaKt,
          currentKt: trend.currentKt,
          // Intensity: 0.5 for +6kt, 1.0 for +12kt+
          intensity: Math.min(1.0, (trend.deltaKt - RAPID_THRESHOLD_KT) / 6 + 0.5),
        },
      });
    }

    return { type: 'FeatureCollection', features };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stations, epoch]); // epoch changes on every reading update

  if (rampGeoJson.features.length === 0) return null;

  return (
    <Source id="wind-ramp-src" type="geojson" data={rampGeoJson}>
      {/* Outer glow pulse — larger, semi-transparent */}
      <Layer
        id="wind-ramp-glow"
        type="circle"
        paint={{
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 18, 12, 30],
          'circle-color': '#f97316',  // orange-500
          'circle-opacity': [
            'interpolate', ['linear'], ['get', 'intensity'],
            0.5, 0.12,
            1.0, 0.25,
          ],
          'circle-blur': 0.8,
          // Transition creates gentle pulse effect on data updates
          'circle-opacity-transition': { duration: 1000, delay: 0 },
          'circle-radius-transition': { duration: 1000, delay: 0 },
        }}
      />
      {/* Inner ring — sharper accent */}
      <Layer
        id="wind-ramp-ring"
        type="circle"
        paint={{
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 10, 12, 18],
          'circle-color': 'transparent',
          'circle-stroke-color': '#fb923c', // orange-400
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
