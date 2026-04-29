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
import { Zap } from 'lucide-react';
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
    // S126+1+1 v2.70.1: lowered threshold from 1.0 → 0.3 so faint risk
    // (CAPE 300 + LI -1, etc.) still produces visible heat. With the
    // original threshold most non-storm days showed nothing, even though
    // the grid was successfully fetched.
    const features: GeoJSON.Feature[] = [];
    for (const c of snapshot.cells) {
      if (c.risk < 0.3) continue;
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

  // "No risk detected" indicator — shown when overlay is ON, snapshot
  // arrived, but there's no convective potential anywhere on the grid.
  // Confirms the system fetched data successfully (vs "still loading").
  const noRiskMode = showRisk && snapshot != null && geoJson.features.length === 0;

  if (!showRisk) return null;

  return (
    <>
      {snapshot && geoJson.features.length > 0 && (
        <Source id="convection-risk" type="geojson" data={geoJson}>
          <Layer
            id="convection-risk-heat"
            type="heatmap"
            paint={{
              // S126+1+1 v2.70.1: weight curve bumped — even risk 1 (CAPE 500
              // + LI -2 territory) now produces visible heat instead of
              // hiding until risk≥5. Lets the map flag morning ramp-ups
              // before peak afternoon CAPE.
              'heatmap-weight': [
                'interpolate', ['linear'], ['get', 'risk'],
                0,  0,
                0.5, 0.15, // marginal CAPE — barely visible halo
                1,  0.30,  // CAPE 1000 + LI -1 — early warning
                3,  0.55,  // CAPE 1500 + LI -2 — moderate
                8,  0.80,  // CAPE 2000 + LI -4 — granizo posible
                18, 1.0,   // CAPE 3000 + LI -6 — extremo
              ],
              'heatmap-intensity': [
                'interpolate', ['linear'], ['zoom'],
                6,  0.8,
                9,  1.2,
                12, 1.8,
              ],
              'heatmap-color': [
                'interpolate', ['linear'], ['heatmap-density'],
                0,    'rgba(0, 0, 0, 0)',
                0.08, 'rgba(250, 204, 21, 0.20)', // yellow — early warning
                0.25, 'rgba(249, 115, 22, 0.35)', // orange
                0.50, 'rgba(220, 38, 38, 0.50)',  // red
                0.78, 'rgba(190, 18, 60, 0.62)',  // rose-700 (severe)
                1.00, 'rgba(126, 0, 30, 0.72)',   // crimson (extreme)
              ],
              // S126+1+1 v2.70.1: bigger radius at low zooms so scattered cells
              // still merge into a visible blob at sector view.
              'heatmap-radius': [
                'interpolate', ['linear'], ['zoom'],
                6,  35,
                8,  50,
                10, 65,
                12, 80,
              ],
              'heatmap-opacity': [
                'interpolate', ['linear'], ['zoom'],
                6,  1.0,
                12, 0.85,
                14, 0.5,
              ],
            }}
          />
        </Source>
      )}
      {/* No-risk badge — confirms the system fetched data successfully */}
      {noRiskMode && (
        <div
          className="absolute top-20 left-1/2 -translate-x-1/2 z-30 pointer-events-none
                     bg-slate-900/85 border border-slate-700/50 rounded-md px-3 py-1.5
                     shadow-lg"
        >
          <div className="text-[11px] text-slate-300">
            <span className="font-bold text-emerald-400">Riesgo convectivo:</span>{' '}
            sin potencial detectado en Galicia
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            Atmósfera estable — peak CAPE {snapshot?.peakCape ?? 0} J/kg, min LI {snapshot?.minLiftedIndex.toFixed(1) ?? '0.0'}
          </div>
        </div>
      )}
      {/* High-risk badge — visible when overlay rendered + peak risk crosses
          the activation threshold. Useful to say "this is why the overlay
          appeared automatically" when auto-activation kicked in. */}
      {snapshot && snapshot.peakRisk >= 4 && geoJson.features.length > 0 && (
        <div
          className="absolute top-20 left-1/2 -translate-x-1/2 z-30 pointer-events-none
                     bg-red-950/90 border border-red-500/60 rounded-md px-3 py-1.5
                     shadow-lg"
        >
          <div className="text-[11px] flex items-center gap-1.5">
            <Zap size={12} className="text-red-300" aria-hidden="true" />
            <span className="font-bold text-red-300">Riesgo convectivo activo:</span>{' '}
            <span className="text-red-100">
              peak CAPE {snapshot.peakCape} J/kg · min LI {snapshot.minLiftedIndex.toFixed(1)}
            </span>
          </div>
          <div className="text-[10px] text-red-300/80 mt-0.5">
            Zonas rojas = formación más probable de tormentas próximas 6 h
          </div>
        </div>
      )}
    </>
  );
}

export const ConvectionRiskOverlay = memo(ConvectionRiskOverlayInner);
