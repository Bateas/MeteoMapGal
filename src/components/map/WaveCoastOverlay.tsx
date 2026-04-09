/**
 * WaveCoastOverlay — pulsing coastal glow when waves are significant.
 *
 * Same DEM pattern as FogOverlay but inverted: paints cells at 0-5m altitude
 * (beaches, rocky coast, harbors) with a pulsing glow proportional to wave height.
 *
 * Only Rías sector. Activates when surf spots report waveHeight >= 0.5m.
 */
import { useState, useEffect, useCallback, memo } from 'react';
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import { useSectorStore } from '../../store/sectorStore';
import { useSpotStore } from '../../store/spotStore';

const COAST_MAX_ALT = 5;
const BBOX = { west: -9.05, east: -8.50, south: 42.08, north: 42.56 };
const COLS = 120;
const ROWS = 100;

function sampleCoastalCells(
  queryElevation: (lngLat: { lng: number; lat: number }) => number | null,
): GeoJSON.FeatureCollection {
  const cellW = (BBOX.east - BBOX.west) / COLS;
  const cellH = (BBOX.north - BBOX.south) / ROWS;
  const features: GeoJSON.Feature[] = [];

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const lng = BBOX.west + (col + 0.5) * cellW;
      const lat = BBOX.south + (row + 0.5) * cellH;

      let elev: number | null;
      try {
        elev = queryElevation({ lng, lat });
      } catch {
        elev = null;
      }

      // null = water (skip — we want the SHORE not the sea)
      // 0-5m = coastal land / beach (paint this)
      if (elev === null || elev <= 0 || elev > COAST_MAX_ALT) continue;

      const x1 = BBOX.west + col * cellW;
      const x2 = x1 + cellW;
      const y1 = BBOX.south + row * cellH;
      const y2 = y1 + cellH;

      features.push({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]],
        },
        properties: {},
      });
    }
  }

  return { type: 'FeatureCollection', features };
}

function WaveCoastOverlayInner() {
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const { current: mapRef } = useMap();
  const [coastGeoJSON, setCoastGeoJSON] = useState<GeoJSON.FeatureCollection | null>(null);
  const [opacity, setOpacity] = useState(0);

  // Max wave height from surf spots
  const surfWaveCache = useSpotStore((s) => s.surfWaveCache);
  let maxWaveHeight = 0;
  if (surfWaveCache && surfWaveCache.size > 0) {
    for (const data of surfWaveCache.values()) {
      if (data.waveHeight > maxWaveHeight) maxWaveHeight = data.waveHeight;
    }
  }

  const active = sectorId === 'rias' && maxWaveHeight >= 0.5;

  // Sample coastal cells from DEM
  const buildCoast = useCallback(() => {
    const map = mapRef?.getMap();
    if (!map) return;

    const data = sampleCoastalCells((lngLat) => {
      try { return map.queryTerrainElevation?.(lngLat) ?? null; }
      catch { return null; }
    });

    if (data.features.length > 5) {
      setCoastGeoJSON(data);
    }
  }, [mapRef]);

  useEffect(() => {
    if (sectorId !== 'rias') { setCoastGeoJSON(null); return; }

    const timer = setTimeout(buildCoast, 3500);
    const map = mapRef?.getMap();
    const onTerrain = () => setTimeout(buildCoast, 1000);
    map?.once('terrain', onTerrain);
    return () => { clearTimeout(timer); map?.off('terrain', onTerrain); };
  }, [sectorId, buildCoast, mapRef]);

  // Pulsing wave animation
  useEffect(() => {
    if (!active || !coastGeoJSON) { setOpacity(0); return; }
    let frame: number;
    const start = Date.now();
    const speed = 0.5 + Math.min(maxWaveHeight, 3) * 0.4;

    function animate() {
      const t = (Date.now() - start) / 1000;
      const wave = Math.pow(Math.max(0, Math.sin(t * speed)), 2);
      const base = Math.min(0.08 + maxWaveHeight * 0.04, 0.25);
      setOpacity(base * (0.3 + 0.7 * wave));
      frame = requestAnimationFrame(animate);
    }
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [active, coastGeoJSON, maxWaveHeight]);

  if (sectorId !== 'rias' || !coastGeoJSON || opacity === 0) return null;

  const color = maxWaveHeight >= 2.5 ? '#f97316' : maxWaveHeight >= 1.5 ? '#22d3ee' : '#38bdf8';

  return (
    <Source id="wave-coast" type="geojson" data={coastGeoJSON}>
      <Layer
        id="wave-coast-fill"
        type="fill"
        paint={{ 'fill-color': color, 'fill-opacity': opacity, 'fill-antialias': false }}
      />
      <Layer
        id="wave-coast-glow"
        type="line"
        paint={{ 'line-color': color, 'line-width': 10, 'line-blur': 16, 'line-opacity': opacity * 0.4 }}
      />
    </Source>
  );
}

export const WaveCoastOverlay = memo(WaveCoastOverlayInner);
