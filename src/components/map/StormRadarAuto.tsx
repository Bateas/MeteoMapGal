/**
 * StormRadarAuto — Automatic subtle precipitation overlay when storms are active.
 *
 * Shows the LATEST RainViewer radar frame at low opacity (0.35) whenever
 * lightning clusters are detected. No controls, no animation — just a
 * transparent hint of where rain is falling.
 *
 * Activates: clusters.length > 0
 * Deactivates: no clusters (auto-hides)
 * Independent of the manual Radar layer toggle.
 */

import { memo, useEffect, useState, useCallback, useRef } from 'react';
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import { useLightningStore } from '../../hooks/useLightningData';
import { useWeatherLayerStore } from '../../store/weatherLayerStore';
import { fetchRainViewerFrames, buildTileUrlScheme } from '../../api/rainviewerClient';

const SOURCE_ID = 'storm-radar-auto';
const LAYER_ID = 'storm-radar-auto-layer';
// Scheme 8 (black→red→yellow→white): darkest base, only intense rain visible.
const RAINVIEWER_SCHEME = 8;
const AUTO_OPACITY = 0.5;
const POLL_MS = 5 * 60_000; // refresh every 5 min

export const StormRadarAuto = memo(function StormRadarAuto() {
  const clusters = useLightningStore((s) => s.clusters);
  const activeLayer = useWeatherLayerStore((s) => s.activeLayer);
  const manualRadarActive = activeLayer === 'radar';
  const { current: map } = useMap();

  const [tileUrl, setTileUrl] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  // Don't show if manual radar is already active (avoid double overlay)
  const shouldShow = clusters.length > 0 && !manualRadarActive;

  const fetchLatest = useCallback(async () => {
    try {
      const data = await fetchRainViewerFrames();
      if (data && data.past.length > 0) {
        const latest = data.past[data.past.length - 1];
        setTileUrl(buildTileUrlScheme(data.host, latest.path, RAINVIEWER_SCHEME));
      }
    } catch {
      // Silent — this is a convenience feature, not critical
    }
  }, []);

  // Fetch on activation, poll while active
  useEffect(() => {
    if (!shouldShow) {
      setTileUrl(null);
      clearInterval(intervalRef.current);
      return;
    }

    fetchLatest();
    intervalRef.current = setInterval(() => {
      if (!document.hidden) fetchLatest();
    }, POLL_MS);

    return () => clearInterval(intervalRef.current);
  }, [shouldShow, fetchLatest]);

  // Cleanup MapLibre source/layer on unmount
  useEffect(() => {
    return () => {
      if (!map) return;
      try {
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch { /* map may be destroyed */ }
    };
  }, [map]);

  if (!shouldShow || !tileUrl) return null;

  return (
    <Source
      id={SOURCE_ID}
      type="raster"
      tiles={[tileUrl]}
      tileSize={256}
      maxzoom={7}
    >
      <Layer
        id={LAYER_ID}
        type="raster"
        paint={{
          'raster-opacity': AUTO_OPACITY,
          'raster-fade-duration': 500,
          // Scheme 8 is black→red→yellow→white.
          // Black is invisible on dark map. Only intense rain (red/yellow/white) pops.
        }}
      />
    </Source>
  );
});
