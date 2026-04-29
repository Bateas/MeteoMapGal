/**
 * Convection Risk Overlay — spatial heatmap of CAPE × -LI over Galicia.
 *
 * Renders a translucent heatmap where each grid cell's intensity is the
 * convective risk score (0-100). Red = high risk = where storms are likely
 * to FORM today (vs the storm cluster overlay which shows where they're
 * already firing).
 *
 * Operational use case (S126+1+1):
 *   - Viticultor opens map at 11:00
 *   - Sees red blob over Castrelo de Miño / Ribeiro corridor
 *   - Knows: "this afternoon high hail risk in my zone — prepare nets"
 *
 * Auto-activation logic lives in `useConvectionGridAutoToggle` (separate
 * concern). Here we only render when the toggle is ON and we have data.
 */
import { memo, useMemo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { useMapStyleStore } from '../../store/mapStyleStore';
import { useConvectionGrid, useConvectionGridStore } from '../../hooks/useConvectionGrid';

function ConvectionRiskOverlayInner() {
  const showRisk = useMapStyleStore((s) => s.showConvectionRisk);
  const snapshot = useConvectionGridStore((s) => s.snapshot);

  // Drives the periodic fetch
  useConvectionGrid();

  const geoJson = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showRisk || !snapshot) {
      return { type: 'FeatureCollection', features: [] };
    }
    // Only emit cells with measurable risk — keeps the heatmap tight to
    // actual hot spots rather than painting the whole map a faint pink.
    const features: GeoJSON.Feature[] = [];
    for (const c of snapshot.cells) {
      if (c.risk < 1) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
        properties: {
          risk: c.risk,
          cape: c.cape ?? 0,
          li: c.liftedIndex ?? 0,
        },
      });
    }
    return { type: 'FeatureCollection', features };
  }, [showRisk, snapshot]);

  if (!showRisk || !snapshot || geoJson.features.length === 0) return null;

  return (
    <Source id="convection-risk" type="geojson" data={geoJson}>
      {/* MapLibre native heatmap layer — interpolates between cells smoothly. */}
      <Layer
        id="convection-risk-heat"
        type="heatmap"
        paint={{
          // Intensity weight per point, scaled from risk score.
          // Risk 0 → 0, risk 18 (extreme) → 1.0.
          'heatmap-weight': [
            'interpolate', ['linear'], ['get', 'risk'],
            0,  0,
            2,  0.15,   // CAPE 1000 + LI -2 — early warning territory
            5,  0.35,   // CAPE 1500 + LI -3 — granizo posible
            10, 0.6,    // CAPE 2000 + LI -5 — granizo probable
            20, 0.85,   // CAPE 3000 + LI -7 — extremo
            40, 1.0,    // CAPE 4000 + LI -10 — pure violence
          ],
          // Higher zoom = need MORE intensity per point to maintain heat.
          'heatmap-intensity': [
            'interpolate', ['linear'], ['zoom'],
            7,  0.6,
            10, 1.0,
            13, 1.6,
          ],
          // Color ramp — yellow (low) → orange → red (high). Cool (no risk)
          // is fully transparent so the base map shows through.
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0,    'rgba(0, 0, 0, 0)',
            0.10, 'rgba(250, 204, 21, 0.18)', // yellow-400 — barely visible
            0.30, 'rgba(249, 115, 22, 0.30)', // orange-500
            0.55, 'rgba(220, 38, 38, 0.42)',  // red-600
            0.80, 'rgba(190, 18, 60, 0.55)',  // rose-700 (severe)
            1.00, 'rgba(126, 0, 30, 0.65)',   // dark crimson (extreme)
          ],
          // Each cell paints a halo proportional to grid spacing.
          // Galicia 5km grid → ~30-50 px at typical sector zoom.
          'heatmap-radius': [
            'interpolate', ['linear'], ['zoom'],
            7,  18,
            9,  28,
            11, 45,
            13, 70,
          ],
          // Fade out as user zooms way in (cells become too discrete).
          'heatmap-opacity': [
            'interpolate', ['linear'], ['zoom'],
            7,  1.0,
            12, 0.85,
            14, 0.5,
          ],
        }}
      />
    </Source>
  );
}

export const ConvectionRiskOverlay = memo(ConvectionRiskOverlayInner);
