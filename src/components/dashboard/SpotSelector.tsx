/**
 * Unified spot scoring panel — single source of truth for sailing verdicts.
 *
 * Sector-aware: shows RIAS_SPOTS or EMBALSE_SPOTS based on active sector.
 * 5-level verdict system: Calma / Flojo / Navegable / Buen día / Fuerte.
 * For spots with thermalDetection (Castrelo, Cesantes), shows thermal detail rows
 * (ΔT, thermal probability, wind window, atmosphere, tendency, alerts).
 *
 * Collapsed by default — expands to show all spot cards + detail.
 */
import { memo, useState, useMemo, useRef, useEffect } from 'react';
import { useSpotStore } from '../../store/spotStore';
import { useSectorStore } from '../../store/sectorStore';
import { useUIStore } from '../../store/uiStore';
import { getSpotsForSector } from '../../config/spots';
import type { SpotScore, SpotVerdict, SpotThermalContext } from '../../services/spotScoringEngine';
import type { SpotWindowResult } from '../../services/sailingWindowService';
import { WeatherIcon, type IconId } from '../icons/WeatherIcons';
import { waterTempColor } from '../../services/buoyUtils';

// Re-export for backward compat (moved to config/verdictStyles.ts to fix bundle splitting)
export { VERDICT_STYLE } from '../../config/verdictStyles';

// ── Main component ────────────────────────────────────────────────

export const SpotSelector = memo(function SpotSelector() {
  const activeSpotId = useSpotStore((s) => s.activeSpotId);
  const selectSpot = useSpotStore((s) => s.selectSpot);
  const favoriteSpotId = useSpotStore((s) => s.favoriteSpotId);
  const toggleFavorite = useSpotStore((s) => s.toggleFavorite);
  const scores = useSpotStore((s) => s.scores);
  const sailingWindows = useSpotStore((s) => s.sailingWindows);
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const setFlyToTarget = useUIStore((s) => s.setFlyToTarget);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const isMobile = useUIStore((s) => s.isMobile);
  const [expanded, setExpanded] = useState(false);

  const spots = useMemo(() => getSpotsForSector(sectorId), [sectorId]);

  // Find active spot for this sector (fallback to first spot)
  const activeSpot = spots.find((s) => s.id === activeSpotId) ?? spots[0];
  const activeScore = activeSpot ? scores.get(activeSpot.id) : undefined;
  const activeVerdict = activeScore?.verdict ?? 'unknown';
  const v = VERDICT_STYLE[activeVerdict];

  // Animate verdict changes with a pop effect
  const prevVerdictRef = useRef(activeVerdict);
  const [verdictPop, setVerdictPop] = useState(false);
  useEffect(() => {
    if (prevVerdictRef.current !== activeVerdict && activeVerdict !== 'unknown') {
      setVerdictPop(true);
      const t = setTimeout(() => setVerdictPop(false), 450);
      prevVerdictRef.current = activeVerdict;
      return () => clearTimeout(t);
    }
    prevVerdictRef.current = activeVerdict;
  }, [activeVerdict]);

  if (!activeSpot) return null;

  // Wind info for header
  const windKt = activeScore?.wind?.avgSpeedKt;
  const windDir = activeScore?.wind?.dominantDir;

  return (
    <div className={`rounded-lg border ${v.border} ${v.bg} transition-all`}>
      {/* ── Header: active spot + verdict ── */}
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
      >
        <WeatherIcon id={activeSpot.icon} size={18} className="text-slate-300 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[13px] font-bold text-slate-200">{activeSpot.shortName}</span>
            {activeSpot.id === favoriteSpotId && <span className="text-amber-400 text-xs" title="Tu spot favorito">{'\u2605'}</span>}
            <span className="badge-beta">Beta</span>
            <span className={`${v.text} text-[10px] font-bold px-1.5 py-0.5 rounded-full ${v.bg} ${verdictPop ? 'animate-verdict-pop' : ''} ${activeVerdict === 'good' ? 'badge-shimmer' : ''}`}>
              {v.label}
              {windKt != null && activeVerdict !== 'calm' ? ` ${windKt.toFixed(0)}kt` : ''}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 truncate mt-0.5">
            {activeScore?.summary ?? 'Esperando datos...'}
          </p>
          <NextWindowSummary spotId={activeSpot.id} sailingWindows={sailingWindows} />
        </div>
        <WeatherIcon
          id={expanded ? 'x' : 'info'}
          size={14}
          className="text-slate-500 flex-shrink-0"
        />
      </button>

      {/* ── Expanded: all spots + thermal detail + beta warning ── */}
      {expanded && (
        <div className="px-2 pb-2.5 space-y-1.5 border-t border-slate-700/50 pt-2 animate-stagger">
          {spots.map((spot) => {
            const score = scores.get(spot.id);
            return (
              <SpotCard
                key={spot.id}
                spotId={spot.id}
                icon={spot.icon}
                name={spot.shortName}
                description={spot.description}
                score={score ?? null}
                isActive={spot.id === activeSpot.id}
                isFavorite={spot.id === favoriteSpotId}
                onSelect={() => {
                  selectSpot(spot.id);
                  setFlyToTarget({ lon: spot.center[0], lat: spot.center[1], zoom: 12 });
                  if (isMobile) setSidebarOpen(false);
                }}
                onToggleFavorite={() => toggleFavorite(spot.id)}
              />
            );
          })}

          {/* Beta disclaimer */}
          <div className="flex items-start gap-1.5 px-1.5 pt-1.5 text-[10px] text-amber-500/80 leading-tight">
            <span className="flex-shrink-0 mt-px">&#9888;</span>
            <span>
              Sistema en pruebas. Los patrones de viento son orientativos
              y pueden no reflejar condiciones reales (ej. detectar
              &ldquo;t&eacute;rmica&rdquo; por coincidencia de direcci&oacute;n).
            </span>
          </div>
        </div>
      )}
    </div>
  );
});

// ── Per-spot card ─────────────────────────────────────────────────

function SpotCard({
  spotId,
  icon,
  name,
  description,
  score,
  isActive,
  isFavorite,
  onSelect,
  onToggleFavorite,
}: {
  spotId: string;
  icon: IconId;
  name: string;
  description: string;
  score: SpotScore | null;
  isActive: boolean;
  isFavorite: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
}) {
  const verdict = score?.verdict ?? 'unknown';
  const v = VERDICT_STYLE[verdict];
  const windKt = score?.wind?.avgSpeedKt;

  return (
    <button
      onClick={onSelect}
      className={`
        w-full text-left rounded-md px-2.5 py-2 transition-all
        ${isActive ? `${v.bg} ring-1 ring-inset ${v.border.replace('border-', 'ring-')}` : 'hover:bg-slate-800/50'}
      `}
    >
      <div className="flex items-center gap-2">
        <WeatherIcon id={icon} size={14} className="text-slate-300 flex-shrink-0" />
        <span className="text-[12px] font-bold text-slate-200 flex-1">{name}</span>
        {/* Favorite star */}
        <span
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
          className={`text-sm cursor-pointer transition-colors ${isFavorite ? 'text-amber-400' : 'text-slate-600 hover:text-slate-400'}`}
          title={isFavorite ? 'Quitar de favorito' : 'Marcar como favorito'}
          role="button"
          aria-label={isFavorite ? 'Quitar favorito' : 'Marcar favorito'}
        >
          {isFavorite ? '\u2605' : '\u2606'}
        </span>
        {/* Verdict badge with kt */}
        <span className={`flex items-center gap-1 text-[10px] font-bold ${v.text}`}>
          <span className={`w-2 h-2 rounded-full ${v.dot}`} />
          {v.label}
          {windKt != null && verdict !== 'calm' && verdict !== 'unknown' ? ` ${windKt.toFixed(0)}kt` : ''}
        </span>
      </div>

      {/* Score detail row */}
      {score && (
        <div className="flex items-center gap-2 flex-wrap mt-1 text-[10px] text-slate-400">
          {score.wind && (
            <span>{score.wind.dominantDir} ~{score.wind.avgSpeedKt.toFixed(0)}kt</span>
          )}
          {score.wind?.matchedPattern && (
            <span className={`${v.text} font-semibold`}>{score.wind.matchedPattern}</span>
          )}
          {score.waves?.waveHeight != null && (
            <span>Olas {score.waves.waveHeight.toFixed(1)}m</span>
          )}
          {score.waterTemp != null && (
            <span style={{ color: waterTempColor(score.waterTemp) }}>Agua {score.waterTemp.toFixed(0)}°</span>
          )}
          {score.hardGateTriggered && (
            <span className="text-red-400">{score.hardGateTriggered}</span>
          )}
        </div>
      )}

      {/* Thermal detail rows (only for spots with thermalDetection) */}
      {isActive && score?.thermal && (
        <ThermalDetails thermal={score.thermal} />
      )}

      {/* Storm alert — shown for ALL spots, not just thermal ones */}
      {isActive && score?.hasStormAlert && !score.thermal?.hasStormAlert && (
        <div className="mt-1 pt-1 border-t border-slate-700/30">
          <DetailRow
            icon="alert-triangle"
            iconColor="text-red-400"
            label="Alerta"
            value="Tormenta activa"
            color="text-red-400"
          />
        </div>
      )}

      {/* Description (only for active spot) */}
      {isActive && (
        <p className="text-[10px] text-slate-500 mt-1">{description}</p>
      )}
    </button>
  );
}

// ── Thermal detail rows ──────────────────────────────────────────

function ThermalDetails({ thermal }: { thermal: SpotThermalContext }) {
  return (
    <div className="mt-1.5 pt-1.5 border-t border-slate-700/30 space-y-0.5">
      {/* ΔT */}
      <DetailRow
        icon="thermometer"
        iconColor="text-orange-400"
        label="\u0394T diurno"
        value={thermal.deltaT !== null ? `${thermal.deltaT.toFixed(1)}\u00b0C` : '\u2014'}
        color={
          thermal.deltaT !== null
            ? thermal.deltaT >= 20 ? 'text-green-400'
              : thermal.deltaT >= 16 ? 'text-emerald-400'
              : thermal.deltaT >= 12 ? 'text-amber-400'
              : 'text-red-400'
            : 'text-slate-500'
        }
      />

      {/* Thermal probability */}
      <DetailRow
        icon="sun"
        iconColor="text-yellow-400"
        label="Prob. t\u00e9rmicas"
        value={`${thermal.thermalProbability}%`}
        color={
          thermal.thermalProbability >= 60 ? 'text-green-400'
            : thermal.thermalProbability >= 35 ? 'text-amber-400'
            : 'text-red-400'
        }
      />

      {/* Wind window */}
      <DetailRow
        icon="wind"
        iconColor="text-sky-400"
        label="Ventana viento"
        value={thermal.windWindow
          ? `${thermal.windWindow.dominantDir} ${thermal.windWindow.avgSpeedKt.toFixed(0)}kt (${thermal.windWindow.startHour}:00\u2013${thermal.windWindow.endHour}:00)`
          : 'Sin ventana clara'
        }
        color={thermal.windWindow ? 'text-sky-300' : 'text-slate-500'}
      />

      {/* Clouds + CAPE */}
      {thermal.atmosphere.cloudCover !== null && (
        <DetailRow
          icon="cloud"
          iconColor="text-slate-400"
          label="Nubes / CAPE"
          value={`${Math.round(thermal.atmosphere.cloudCover)}%${thermal.atmosphere.cape !== null ? ` \u00b7 ${Math.round(thermal.atmosphere.cape)} J/kg` : ''}`}
          color={
            thermal.atmosphere.cloudCover < 30 ? 'text-green-400'
              : thermal.atmosphere.cloudCover < 60 ? 'text-amber-400'
              : 'text-red-400'
          }
        />
      )}

      {/* Tendency */}
      {thermal.bestTendency !== 'none' && (
        <DetailRow
          icon="sun"
          iconColor="text-amber-400"
          label="Tendencia"
          value={
            thermal.bestTendency === 'active' ? 'T\u00e9rmicas activas'
              : thermal.bestTendency === 'likely' ? 'T\u00e9rmicas probables'
              : 'En formaci\u00f3n'
          }
          color={
            thermal.bestTendency === 'active' ? 'text-green-400'
              : thermal.bestTendency === 'likely' ? 'text-amber-400'
              : 'text-sky-400'
          }
        />
      )}

      {/* Storm alert */}
      {thermal.hasStormAlert && (
        <DetailRow
          icon="alert-triangle"
          iconColor="text-red-400"
          label="Alerta"
          value="Tormenta activa"
          color="text-red-400"
        />
      )}

      {/* Rain probability */}
      {thermal.rainProbability !== null && thermal.rainProbability > 20 && (
        <DetailRow
          icon="cloud-rain"
          iconColor="text-blue-400"
          label="Prob. lluvia"
          value={`${thermal.rainProbability}%`}
          color={thermal.rainProbability > 60 ? 'text-red-400' : 'text-amber-400'}
        />
      )}
    </div>
  );
}

function DetailRow({ icon, iconColor, label, value, color }: {
  icon: IconId;
  iconColor: string;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <WeatherIcon id={icon} size={11} className={`flex-shrink-0 ${iconColor}`} />
      <span className="text-[10px] text-slate-500 w-[72px] flex-shrink-0">{label}</span>
      <span className={`text-[11px] font-semibold ${color} truncate`}>{value}</span>
    </div>
  );
}

// ── Next sailing window summary (in header) ──────────────────────

function NextWindowSummary({ spotId, sailingWindows }: {
  spotId: string;
  sailingWindows: Map<string, SpotWindowResult>;
}) {
  const result = sailingWindows.get(spotId);
  if (!result || result.windows.length === 0) return null;

  const best = result.bestWindow;
  if (!best) return null;

  const dot = best.verdict === 'good' ? '🟢' : '🟡';
  return (
    <p className="text-[10px] text-emerald-400/80 truncate mt-0.5">
      {dot} {best.summary}
    </p>
  );
}
