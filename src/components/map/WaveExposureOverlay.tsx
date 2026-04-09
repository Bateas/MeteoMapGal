/**
 * Wave Exposure Overlay — Coastline colored by swell exposure (#56 v3).
 *
 * Uses OSM coastline vectors (38k points) + buoy swell data to color
 * each coast segment: exposed (red), moderate (yellow), sheltered (cyan).
 *
 * Auto-activates when wave height ≥ 0.5m (significant swell present).
 * Manual toggle: "Costa" in Capas marinas.
 *
 * Data flow:
 *   galicianCoastline.json (lazy) → classifyCoastlineExposure(swellDir)
 *   buoyStore.buoys → getDominantSwell() → swellDir + waveHeight
 *
 * Rías Baixas sector only. Coast filtered to Rías bbox.
 */
import { useState, useEffect, useMemo, memo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { useSectorStore } from '../../store/sectorStore';
import { useBuoyStore } from '../../store/buoyStore';
import { useMapStyleStore } from '../../store/mapStyleStore';
import {
  classifyCoastlineExposure,
  getDominantSwell,
  widthForWaveHeight,
  blurForWaveHeight,
} from '../../services/waveExposureEngine';

// ── Rías Baixas bbox filter — only coast in our area of interest ──
const RIAS_BBOX = {
  west: -9.15,
  east: -8.55,
  south: 42.05,
  north: 42.55,
};

/** Auto-activate threshold: show overlay when waves ≥ this height */
const AUTO_WAVE_THRESHOLD = 0.5; // meters

/** Filter coastline features to Rías Baixas bbox */
function filterToRias(coastline: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  const filtered = coastline.features.filter((f) => {
    if (f.geometry.type !== 'LineString') return false;
    const coords = f.geometry.coordinates as [number, number][];
    // Keep if ANY point is within Rías bbox
    return coords.some(([lon, lat]) =>
      lon >= RIAS_BBOX.west && lon <= RIAS_BBOX.east &&
      lat >= RIAS_BBOX.south && lat <= RIAS_BBOX.north
    );
  });
  return { type: 'FeatureCollection', features: filtered };
}

// ── Component ────────────────────────────────────────

function WaveExposureOverlayInner() {
  // DISABLED — coast normal vs swell direction without wave propagation
  // is MISLEADING. Inner ría shows "exposed" when no waves can reach it.
  // Needs USWAN spatial wave data or BFS fetch-distance model.
  // The visual effect works, but the DATA is wrong.
  return null;

  // eslint-disable-next-line no-unreachable
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const showCoastal = useMapStyleStore((s) => s.showUpwelling); // reuses toggle
  const buoys = useBuoyStore((s) => s.buoys);

  // Lazy-load coastline JSON (~1MB)
  const [rawCoastline, setRawCoastline] = useState<GeoJSON.FeatureCollection | null>(null);
  useEffect(() => {
    if (sectorId !== 'rias') return;
    import('../../config/galicianCoastline.json').then((mod) => {
      const data = (mod.default ?? mod) as GeoJSON.FeatureCollection;
      // Filter to Rías Baixas only
      const filtered = filterToRias(data);
      console.log(`[WaveExposure] Loaded ${filtered.features.length} coast segments (of ${data.features.length} total)`);
      setRawCoastline(filtered);
    });
  }, [sectorId]);

  // Get dominant swell from buoys
  const swell = useMemo(() => getDominantSwell(buoys), [buoys]);

  // Auto-activate when significant waves present
  const autoActive = swell !== null && swell.waveHeight >= AUTO_WAVE_THRESHOLD;
  const isActive = sectorId === 'rias' && (showCoastal || autoActive) && rawCoastline !== null;

  // Classify coastline by exposure
  const exposedCoast = useMemo(() => {
    if (!isActive || !rawCoastline || !swell) return null;
    const t0 = performance.now();
    const result = classifyCoastlineExposure(rawCoastline, swell);
    const ms = (performance.now() - t0).toFixed(0);
    console.log(
      `[WaveExposure] ${result.features.length} segments classified, ` +
      `swell ${swell.swellDir}° ${swell.waveHeight.toFixed(1)}m — ${ms}ms`
    );
    return result;
  }, [isActive, rawCoastline, swell]);

  if (!isActive || !exposedCoast || !swell) return null;

  const lineWidth = widthForWaveHeight(swell.waveHeight);
  const lineBlur = blurForWaveHeight(swell.waveHeight);

  return (
    <Source id="wave-exposure" type="geojson" data={exposedCoast}>
      {/* Glow layer — intensity by wave height */}
      {lineBlur > 0 && (
        <Layer
          id="wave-exposure-glow"
          type="line"
          paint={{
            'line-color': ['get', 'color'],
            'line-width': lineWidth + lineBlur,
            'line-blur': lineBlur,
            'line-opacity': 0.35,
          }}
        />
      )}
      {/* Main coast line — colored by exposure */}
      <Layer
        id="wave-exposure-line"
        type="line"
        paint={{
          'line-color': ['get', 'color'],
          'line-width': lineWidth,
          'line-opacity': 0.8,
        }}
      />
    </Source>
  );
}

export const WaveExposureOverlay = memo(WaveExposureOverlayInner);
