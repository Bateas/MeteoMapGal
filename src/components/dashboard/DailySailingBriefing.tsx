import { memo, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useThermalStore } from '../../store/thermalStore';
import { useAlertStore } from '../../store/alertStore';
import { useWeatherStore } from '../../store/weatherStore';
import { useForecastStore } from '../../hooks/useForecastTimeline';
import { generateSailingBriefing, type SailingBriefing, type SailingVerdict } from '../../services/dailyBriefingService';
import { WeatherIcon } from '../icons/WeatherIcons';

// ── Verdict styling ──────────────────────────────────────────

export const VERDICT_CONFIG: Record<SailingVerdict, { label: string; bg: string; border: string; text: string }> = {
  go:       { label: '¡A navegar!',         bg: 'bg-emerald-500/10', border: 'border-emerald-500/40', text: 'text-emerald-400' },
  marginal: { label: 'Viento flojo',        bg: 'bg-amber-500/10',   border: 'border-amber-500/40',   text: 'text-amber-400' },
  nogo:     { label: 'Sin condiciones',     bg: 'bg-red-500/10',     border: 'border-red-500/40',     text: 'text-red-400' },
  unknown:  { label: 'Sin datos',           bg: 'bg-slate-500/10',   border: 'border-slate-500/40',   text: 'text-slate-400' },
};

// ── Hook for shared briefing logic ───────────────────────────

export function useSailingBriefing(): SailingBriefing {
  const { zoneAlerts, tendencySignals, dailyContext, atmosphericContext } = useThermalStore(
    useShallow((s) => ({
      zoneAlerts: s.zoneAlerts,
      tendencySignals: s.tendencySignals,
      dailyContext: s.dailyContext,
      atmosphericContext: s.atmosphericContext,
    })),
  );
  const alerts = useAlertStore((s) => s.alerts);
  const forecast = useForecastStore((s) => s.hourly);
  const currentReadings = useWeatherStore((s) => s.currentReadings);

  return useMemo(
    () => generateSailingBriefing(forecast, dailyContext, atmosphericContext, zoneAlerts, tendencySignals, alerts, currentReadings),
    [forecast, dailyContext, atmosphericContext, zoneAlerts, tendencySignals, alerts, currentReadings],
  );
}

// ── Component ────────────────────────────────────────────────

export const DailySailingBriefing = memo(function DailySailingBriefing() {
  const [expanded, setExpanded] = useState(false);
  const briefing = useSailingBriefing();
  const v = VERDICT_CONFIG[briefing.verdict];

  return (
    <div className={`rounded-lg border ${v.border} ${v.bg} transition-all`}>
      {/* ── Header: verdict + score ─────────────────────── */}
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
      >
        <WeatherIcon id="sailboat" size={16} className={`flex-shrink-0 ${v.text}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-[13px] font-bold ${v.text}`}>{v.label}</span>
            <ScoreBadge score={briefing.score} verdict={briefing.verdict} />
          </div>
          <p className="text-[11px] text-slate-400 truncate mt-0.5">{briefing.summary}</p>
        </div>
        <WeatherIcon
          id={expanded ? 'x' : 'info'}
          size={14}
          className="text-slate-500 flex-shrink-0"
        />
      </button>

      {/* ── Expanded details ────────────────────────────── */}
      {expanded && (
        <div className="px-3 pb-2.5 space-y-2 border-t border-slate-700/50">
          {/* Real-time wind consensus (most important) */}
          {briefing.windConsensus && (
            <DetailRow
              icon={<WeatherIcon id="wind" size={12} className="text-emerald-400" />}
              label="Consenso real"
              value={`${briefing.windConsensus.dominantDir} ${briefing.windConsensus.avgSpeedKt.toFixed(0)}kt · ${briefing.windConsensus.stationCount} estaciones`}
              color={
                briefing.windConsensus.stationCount >= 5 ? 'text-green-400'
                  : briefing.windConsensus.stationCount >= 3 ? 'text-emerald-400'
                  : 'text-amber-400'
              }
            />
          )}

          {/* Forecast wind window */}
          <DetailRow
            icon={<WeatherIcon id="wind" size={12} className="text-sky-400" />}
            label="Ventana viento"
            value={briefing.windWindow
              ? `${briefing.windWindow.dominantDir} ${briefing.windWindow.avgSpeedKt.toFixed(0)}kt (${briefing.windWindow.startHour}:00–${briefing.windWindow.endHour}:00)`
              : 'Sin ventana clara'
            }
            color={briefing.windWindow ? 'text-sky-300' : 'text-slate-500'}
          />

          {/* ΔT */}
          <DetailRow
            icon={<WeatherIcon id="thermometer" size={12} className="text-orange-400" />}
            label="ΔT diurno"
            value={briefing.deltaT !== null ? `${briefing.deltaT.toFixed(1)}°C` : '—'}
            color={
              briefing.deltaT !== null
                ? briefing.deltaT >= 20 ? 'text-green-400'
                  : briefing.deltaT >= 16 ? 'text-emerald-400'
                  : briefing.deltaT >= 12 ? 'text-amber-400'
                  : 'text-red-400'
                : 'text-slate-500'
            }
          />

          {/* Thermal probability */}
          <DetailRow
            icon={<WeatherIcon id="sun" size={12} className="text-yellow-400" />}
            label="Prob. térmicas"
            value={`${briefing.thermalProbability}%`}
            color={
              briefing.thermalProbability >= 60 ? 'text-green-400'
                : briefing.thermalProbability >= 35 ? 'text-amber-400'
                : 'text-red-400'
            }
          />

          {/* Cloud + CAPE */}
          {briefing.atmosphere.cloudCover !== null && (
            <DetailRow
              icon={<WeatherIcon id="cloud" size={12} className="text-slate-400" />}
              label="Nubes / CAPE"
              value={`${Math.round(briefing.atmosphere.cloudCover)}%${briefing.atmosphere.cape !== null ? ` · ${Math.round(briefing.atmosphere.cape)} J/kg` : ''}`}
              color={
                briefing.atmosphere.cloudCover < 30 ? 'text-green-400'
                  : briefing.atmosphere.cloudCover < 60 ? 'text-amber-400'
                  : 'text-red-400'
              }
            />
          )}

          {/* Rain probability */}
          {briefing.rainProbability !== null && briefing.rainProbability > 20 && (
            <DetailRow
              icon={<WeatherIcon id="cloud-rain" size={12} className="text-blue-400" />}
              label="Prob. lluvia"
              value={`${briefing.rainProbability}%`}
              color={briefing.rainProbability > 60 ? 'text-red-400' : 'text-amber-400'}
            />
          )}

          {/* Storm alert */}
          {briefing.hasStormAlert && (
            <DetailRow
              icon={<WeatherIcon id="alert-triangle" size={12} className="text-red-400" />}
              label="Alerta"
              value="Tormenta activa"
              color="text-red-400"
            />
          )}

          {/* Tendency */}
          {briefing.bestTendency !== 'none' && (
            <DetailRow
              icon={<WeatherIcon id="sun" size={12} className="text-amber-400" />}
              label="Tendencia"
              value={
                briefing.bestTendency === 'active' ? 'Térmicas activas'
                  : briefing.bestTendency === 'likely' ? 'Térmicas probables'
                  : 'En formación'
              }
              color={
                briefing.bestTendency === 'active' ? 'text-green-400'
                  : briefing.bestTendency === 'likely' ? 'text-amber-400'
                  : 'text-sky-400'
              }
            />
          )}
        </div>
      )}
    </div>
  );
});

// ── Sub-components ───────────────────────────────────────────

export function ScoreBadge({ score, verdict }: { score: number; verdict: SailingVerdict }) {
  const bg = verdict === 'go' ? 'bg-emerald-500/20'
    : verdict === 'marginal' ? 'bg-amber-500/20'
    : verdict === 'nogo' ? 'bg-red-500/20'
    : 'bg-slate-500/20';
  const text = VERDICT_CONFIG[verdict].text;

  return (
    <span className={`${bg} ${text} text-[10px] font-bold px-1.5 py-0.5 rounded-full tabular-nums`}>
      {score}/100
    </span>
  );
}

function DetailRow({ icon, label, value, color }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2 pt-1.5 first:pt-2">
      {icon}
      <span className="text-[11px] text-slate-500 w-20 flex-shrink-0">{label}</span>
      <span className={`text-[12px] font-semibold ${color} truncate`}>{value}</span>
    </div>
  );
}
