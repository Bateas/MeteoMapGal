/**
 * WaveCoastOverlay — vector coastline colored by wave exposure + height (#56).
 *
 * Extracts coastline segments from waterZones polygon boundaries.
 * Each segment's outward normal is compared to current swell direction:
 * - Exposed (facing swell <30°): red/orange
 * - Moderate (30-75°): yellow
 * - Sheltered (>75°): cyan
 *
 * Line width + glow scales with wave height (FLAT→GRANDE).
 * Rías sector only. Toggle in MapStyleSelector "Costa y olas".
 */
import { useMemo, memo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { useSectorStore } from '../../store/sectorStore';
import { useMapStyleStore } from '../../store/mapStyleStore';
import { useBuoyStore } from '../../store/buoyStore';
import { WATER_ZONES, extractCoastlineSegments } from '../../config/waterZones';

// ── Static coastline geometry (computed once) ──────────

const RIAS_ZONES = WATER_ZONES.filter(z => z.sector === 'rias');
const BASE_SEGMENTS = extractCoastlineSegments(RIAS_ZONES);

// ── Exposure classification ────────────────────────────

const EXPOSURE_COLORS = {
  exposed: '#ef4444',   // red — faces directly into swell
  moderate: '#eab308',  // yellow — oblique
  sheltered: '#22d3ee', // cyan — facing away
  unknown: '#94a3b8',   // gray — no swell data
} as const;

function classifyExposure(normalBearing: number, swellDir: number): 'exposed' | 'moderate' | 'sheltered' {
  // Swell comes FROM swellDir. A segment is exposed if its outward normal
  // faces the incoming swell (angleDiff ≈ 0).
  let diff = Math.abs(normalBearing - swellDir);
  if (diff > 180) diff = 360 - diff;
  if (diff < 30) return 'exposed';
  if (diff < 75) return 'moderate';
  return 'sheltered';
}

// ── Component ──────────────────────────────────────────

function WaveCoastOverlayInner() {
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const showWaveCoast = useMapStyleStore((s) => s.showWaveCoast);
  const buoys = useBuoyStore((s) => s.buoys);

  // Resolve current swell direction + max wave height from buoys
  const { swellDir, maxWaveHeight } = useMemo(() => {
    const readings = buoys ?? [];
    let bestDir: number | null = null;
    let maxH = 0;

    for (const b of readings) {
      if (b.waveHeight != null && b.waveHeight > maxH) {
        maxH = b.waveHeight;
      }
      if (b.waveDir != null && bestDir === null) {
        bestDir = b.waveDir; // Use first available swell direction
      }
    }

    return {
      swellDir: bestDir ?? 315, // Default NW swell (dominant in Galicia)
      maxWaveHeight: maxH,
    };
  }, [buoys]);

  // Build GeoJSON with dynamic exposure + wave height properties
  const geojson = useMemo(() => {
    if (BASE_SEGMENTS.features.length === 0) return null;

    const features = BASE_SEGMENTS.features.map(f => {
      const normal = (f.properties as any)?.normalBearing ?? 0;
      const exposure = classifyExposure(normal, swellDir);
      const color = EXPOSURE_COLORS[exposure];

      return {
        ...f,
        properties: {
          ...f.properties,
          exposure,
          color,
          waveHeight: maxWaveHeight,
        },
      };
    });

    return { type: 'FeatureCollection' as const, features };
  }, [swellDir, maxWaveHeight]);

  // DISABLED: v1 exposure classification is wrong — polygon normals ≠ wave fetch.
  // Interior ría segments show as "exposed" when no waves ever reach them.
  // Needs redesign: distance-from-mouth or DEM-based zone approach.
  // TODO #56 v2
  return null;
  // eslint-disable-next-line no-unreachable
  if (!showWaveCoast || sectorId !== 'rias' || !geojson) return null;

  return (
    <Source id="wave-coast-src" type="geojson" data={geojson}>
      {/* Glow layer — wide + blurred for bigger waves */}
      <Layer
        id="wave-coast-glow"
        type="line"
        paint={{
          'line-color': ['get', 'color'],
          'line-width': [
            'step', ['get', 'waveHeight'],
            0,       // wh < 0.3: no glow
            0.3, 2,  // PEQUE
            0.8, 4,  // SURF OK
            1.5, 8,  // CLASICO
            2.5, 14, // GRANDE
          ],
          'line-blur': [
            'step', ['get', 'waveHeight'],
            0,
            0.3, 3,
            0.8, 6,
            1.5, 10,
            2.5, 18,
          ],
          'line-opacity': [
            'step', ['get', 'waveHeight'],
            0,       // no glow for FLAT
            0.3, 0.2,
            0.8, 0.3,
            1.5, 0.4,
            2.5, 0.5,
          ],
        }}
      />
      {/* Core line — crisp, colored by exposure */}
      <Layer
        id="wave-coast-line"
        type="line"
        paint={{
          'line-color': ['get', 'color'],
          'line-width': [
            'step', ['get', 'waveHeight'],
            1,       // FLAT
            0.3, 1.5, // PEQUE
            0.8, 2.5, // SURF OK
            1.5, 3.5, // CLASICO
            2.5, 5,   // GRANDE
          ],
          'line-opacity': [
            'step', ['get', 'waveHeight'],
            0.3,     // FLAT: barely visible
            0.3, 0.5,
            0.8, 0.7,
            1.5, 0.85,
            2.5, 1.0,
          ],
        }}
        layout={{
          'line-cap': 'round',
          'line-join': 'round',
        }}
      />
    </Source>
  );
}

export const WaveCoastOverlay = memo(WaveCoastOverlayInner);
