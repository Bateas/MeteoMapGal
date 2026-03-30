/**
 * Side-by-side spot comparison panel.
 *
 * Shows all spots in a compact grid with key metrics aligned vertically
 * for easy comparison: verdict, wind, direction, waves, temperature.
 * Lazy-loaded in Sidebar as a tab panel.
 */
import { memo, useMemo } from 'react';
import { useSpotStore } from '../../store/spotStore';
import { useSectorStore } from '../../store/sectorStore';
import { useUIStore } from '../../store/uiStore';
import { getSpotsForSector } from '../../config/spots';
import { VERDICT_STYLE, VERDICT_HEX } from '../../config/verdictStyles';
import { msToKnots, degreesToCardinal } from '../../services/windUtils';
import type { SpotScore, SpotVerdict } from '../../services/spotScoringEngine';

export const SpotComparator = memo(function SpotComparator() {
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const scores = useSpotStore((s) => s.scores);
  const selectSpot = useSpotStore((s) => s.selectSpot);
  const setFlyToTarget = useUIStore((s) => s.setFlyToTarget);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const isMobile = useUIStore((s) => s.isMobile);

  const spots = useMemo(() => getSpotsForSector(sectorId), [sectorId]);

  // Sort: best verdict first (strong > good > sailing > light > calm > unknown)
  const VERDICT_ORDER: Record<SpotVerdict, number> = {
    strong: 5, good: 4, sailing: 3, light: 2, calm: 1, unknown: 0,
  };

  const sorted = useMemo(() => {
    return [...spots].sort((a, b) => {
      const sa = scores.get(a.id);
      const sb = scores.get(b.id);
      return (VERDICT_ORDER[sb?.verdict ?? 'unknown'] || 0)
        - (VERDICT_ORDER[sa?.verdict ?? 'unknown'] || 0);
    });
  }, [spots, scores]);

  const handleSpotClick = (spotId: string) => {
    const spot = spots.find(s => s.id === spotId);
    if (!spot) return;
    selectSpot(spotId);
    setFlyToTarget({ lon: spot.center[0], lat: spot.center[1], zoom: 13 });
    if (isMobile) setSidebarOpen(false);
  };

  if (spots.length === 0) {
    return <div className="p-4 text-slate-500 text-sm text-center">No hay spots en este sector</div>;
  }

  return (
    <div className="p-3 space-y-2">
      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
        Comparador de spots
      </h3>

      {/* Header row */}
      <div className="grid grid-cols-[1fr_60px_50px_50px_50px_45px] gap-1 text-[11px] font-bold text-slate-500 uppercase px-2">
        <span>Spot</span>
        <span className="text-center">Estado</span>
        <span className="text-center">Viento</span>
        <span className="text-center">Dir</span>
        <span className="text-center">Olas</span>
        <span className="text-center">Temp</span>
      </div>

      {/* Spot rows */}
      {sorted.map((spot) => {
        const score = scores.get(spot.id);
        const verdict: SpotVerdict = score?.verdict ?? 'unknown';
        const vs = VERDICT_STYLE[verdict];
        const windKt = score?.windSpeedMs != null
          ? Math.round(msToKnots(score.windSpeedMs))
          : null;
        const dir = score?.windDirDeg != null
          ? degreesToCardinal(score.windDirDeg)
          : null;
        const waveH = score?.waveHeightM != null
          ? score.waveHeightM.toFixed(1)
          : null;
        const temp = score?.airTemp != null
          ? Math.round(score.airTemp)
          : null;

        return (
          <button
            key={spot.id}
            onClick={() => handleSpotClick(spot.id)}
            className={`grid grid-cols-[1fr_60px_50px_50px_50px_45px] gap-1 items-center px-2 py-2.5
              rounded-lg border transition-all text-left
              hover:bg-slate-800/60 cursor-pointer
              ${vs.bg} ${vs.border}`}
          >
            {/* Name */}
            <span className="text-xs font-semibold text-slate-200 truncate">
              {spot.name.split('(')[0].trim()}
            </span>

            {/* Verdict badge */}
            <span
              className="text-[11px] font-bold text-center rounded px-1.5 py-0.5"
              style={{
                color: VERDICT_HEX[verdict],
                background: `${VERDICT_HEX[verdict]}18`,
                border: `1px solid ${VERDICT_HEX[verdict]}40`,
              }}
            >
              {vs.label}
            </span>

            {/* Wind speed */}
            <span className={`text-xs font-bold text-center ${windKt != null ? 'text-slate-200' : 'text-slate-600'}`}>
              {windKt != null ? `${windKt}kt` : '—'}
            </span>

            {/* Direction */}
            <span className="text-[11px] text-center text-slate-400 font-mono">
              {dir ?? '—'}
            </span>

            {/* Waves */}
            <span className={`text-xs text-center ${waveH != null ? 'text-cyan-400' : 'text-slate-600'}`}>
              {waveH != null ? `${waveH}m` : '—'}
            </span>

            {/* Temperature */}
            <span className={`text-xs text-center ${temp != null ? 'text-slate-300' : 'text-slate-600'}`}>
              {temp != null ? `${temp}°` : '—'}
            </span>
          </button>
        );
      })}

      {/* Summary */}
      <div className="text-[11px] text-slate-600 text-center pt-2">
        {spots.length} spots · Toca uno para ver detalles en el mapa
      </div>
    </div>
  );
});
