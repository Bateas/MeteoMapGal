/**
 * Spot selection + per-spot verdict cards for Rías Baixas.
 *
 * Shows 4 spots (Cesantes, Bocana, Centro Ría, Cíes-Ría) with live
 * GO/MARGINAL/NOGO verdicts. Clicking a spot selects it as active (persisted).
 * Collapsed by default — expands to show detail cards.
 */
import { memo, useState } from 'react';
import { useSpotStore } from '../../store/spotStore';
import { RIAS_SPOTS } from '../../config/spots';
import type { SpotScore, SpotVerdict } from '../../services/spotScoringEngine';
import { WeatherIcon, type IconId } from '../icons/WeatherIcons';

// ── Verdict styling (shared palette with DailySailingBriefing) ─────

const VERDICT_STYLE: Record<SpotVerdict, { label: string; bg: string; border: string; text: string; dot: string }> = {
  go:       { label: 'GO',           bg: 'bg-emerald-500/10', border: 'border-emerald-500/40', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  marginal: { label: 'MARGINAL',     bg: 'bg-amber-500/10',   border: 'border-amber-500/40',   text: 'text-amber-400',   dot: 'bg-amber-400' },
  nogo:     { label: 'NO GO',        bg: 'bg-red-500/10',     border: 'border-red-500/40',     text: 'text-red-400',     dot: 'bg-red-400' },
  unknown:  { label: 'SIN DATOS',    bg: 'bg-slate-500/10',   border: 'border-slate-500/40',   text: 'text-slate-400',   dot: 'bg-slate-400' },
};

// ── Main component ────────────────────────────────────────────────

export const SpotSelector = memo(function SpotSelector() {
  const activeSpotId = useSpotStore((s) => s.activeSpotId);
  const selectSpot = useSpotStore((s) => s.selectSpot);
  const scores = useSpotStore((s) => s.scores);
  const [expanded, setExpanded] = useState(false);

  // Quick verdict overview for header
  const activeScore = scores.get(activeSpotId);
  const activeSpot = RIAS_SPOTS.find((s) => s.id === activeSpotId);
  const activeVerdict = activeScore?.verdict ?? 'unknown';
  const v = VERDICT_STYLE[activeVerdict];

  return (
    <div className={`rounded-lg border ${v.border} ${v.bg} transition-all`}>
      {/* ── Header: active spot + verdict ── */}
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
      >
        <WeatherIcon id={activeSpot?.icon ?? 'waves'} size={18} className="text-slate-300 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-bold text-slate-200">{activeSpot?.shortName ?? 'Spot'}</span>
            <span className={`${v.text} text-[10px] font-bold px-1.5 py-0.5 rounded-full ${v.bg}`}>
              {v.label}
              {activeScore ? ` ${activeScore.score}` : ''}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 truncate mt-0.5">
            {activeScore?.summary ?? 'Esperando datos...'}
          </p>
        </div>
        <WeatherIcon
          id={expanded ? 'x' : 'info'}
          size={14}
          className="text-slate-500 flex-shrink-0"
        />
      </button>

      {/* ── Expanded: all spots ── */}
      {expanded && (
        <div className="px-2 pb-2.5 space-y-1.5 border-t border-slate-700/50 pt-2">
          {RIAS_SPOTS.map((spot) => {
            const score = scores.get(spot.id);
            return (
              <SpotCard
                key={spot.id}
                spotId={spot.id}
                icon={spot.icon}
                name={spot.shortName}
                description={spot.description}
                score={score ?? null}
                isActive={spot.id === activeSpotId}
                onSelect={() => selectSpot(spot.id)}
              />
            );
          })}
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
  onSelect,
}: {
  spotId: string;
  icon: IconId;
  name: string;
  description: string;
  score: SpotScore | null;
  isActive: boolean;
  onSelect: () => void;
}) {
  const verdict = score?.verdict ?? 'unknown';
  const v = VERDICT_STYLE[verdict];

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
        {/* Verdict badge */}
        <span className={`flex items-center gap-1 text-[10px] font-bold ${v.text}`}>
          <span className={`w-2 h-2 rounded-full ${v.dot}`} />
          {v.label}
        </span>
      </div>

      {/* Score detail row */}
      {score && (
        <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-400">
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
            <span>Agua {score.waterTemp.toFixed(0)}°</span>
          )}
          {score.hardGateTriggered && (
            <span className="text-red-400">{score.hardGateTriggered}</span>
          )}
        </div>
      )}

      {/* Description (only for active spot) */}
      {isActive && (
        <p className="text-[10px] text-slate-500 mt-1">{description}</p>
      )}
    </button>
  );
}
