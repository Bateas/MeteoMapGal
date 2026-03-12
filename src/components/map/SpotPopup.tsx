/**
 * Popup for sailing spots — shows scoring summary on marker click.
 * Desktop: MapLibre native popup. Mobile: bottom sheet.
 *
 * Displays: verdict, wind consensus, wave conditions, water temp,
 * matched pattern, score, and summary text.
 * Themed per verdict color to match SpotMarker.
 */
import { memo } from 'react';
import { Popup } from 'react-map-gl/maplibre';
import { useSpotStore } from '../../store/spotStore';
import { useUIStore } from '../../store/uiStore';
import { WeatherIcon } from '../icons/WeatherIcons';
import type { SpotScore, SpotVerdict } from '../../services/spotScoringEngine';
import type { SailingSpot } from '../../config/spots';

// ── Verdict palette (synced with SpotMarker) ────────────────
const VERDICT_STYLE: Record<SpotVerdict, { color: string; bg: string; label: string }> = {
  calm:    { color: '#94a3b8', bg: 'rgba(100,116,139,0.15)', label: 'CALMA' },
  light:   { color: '#f87171', bg: 'rgba(239,68,68,0.12)',   label: 'FLOJO' },
  sailing: { color: '#fbbf24', bg: 'rgba(245,158,11,0.15)',  label: 'NAVEGABLE' },
  good:    { color: '#34d399', bg: 'rgba(16,185,129,0.15)',   label: 'BUENO' },
  strong:  { color: '#22d3ee', bg: 'rgba(6,182,212,0.15)',    label: 'FUERTE' },
  unknown: { color: '#94a3b8', bg: 'rgba(100,116,139,0.15)', label: 'SIN DATOS' },
};

interface SpotPopupProps {
  spot: SailingSpot;
  score: SpotScore | undefined;
}

export const SpotPopup = memo(function SpotPopup({ spot, score }: SpotPopupProps) {
  const selectSpot = useSpotStore((s) => s.selectSpot);
  const isMobile = useUIStore((s) => s.isMobile);

  const verdict: SpotVerdict = score?.verdict ?? 'unknown';
  const vs = VERDICT_STYLE[verdict];

  const popupContent = (
    <div className="min-w-[220px] max-w-[280px]">
      {/* ── Header ── */}
      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-700/60">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
          style={{ background: vs.bg, border: `2px solid ${vs.color}` }}
        >
          <WeatherIcon id={spot.icon} size={16} className="text-slate-200" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-slate-100 truncate">{spot.name}</span>
            <span className="text-[8px] font-bold tracking-wider text-amber-400/80 bg-amber-400/10 px-1.5 py-0.5 rounded-full border border-amber-400/20 shrink-0 leading-none">BETA</span>
          </div>
          <div className="text-[10px] text-slate-400">{spot.description}</div>
        </div>
      </div>

      {/* ── Verdict badge ── */}
      <div className="flex items-center gap-2 mb-2">
        <span
          className="px-2 py-0.5 rounded-full text-xs font-extrabold tracking-wide"
          style={{ background: vs.bg, color: vs.color, border: `1px solid ${vs.color}40` }}
        >
          {vs.label}
        </span>
        {score && (
          <span className="text-xs text-slate-400 font-mono">
            {score.score}/100
          </span>
        )}
      </div>

      {/* ── Wind consensus ── */}
      {score?.wind && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs mb-2">
          <Cell label="Viento" value={`${score.wind.avgSpeedKt.toFixed(0)} kt`} color={windKtColor(score.wind.avgSpeedKt)} />
          <Cell label="Dirección" value={score.wind.dominantDir} />
          {score.wind.matchedPattern && (
            <div className="col-span-2 text-[10px] text-amber-400/80 italic">
              ⚡ {score.wind.matchedPattern}
            </div>
          )}
          <Cell label="Estaciones" value={`${score.wind.stationCount}`} />
        </div>
      )}

      {/* ── Wave conditions (coastal spots) ── */}
      {score?.waves && score.waves.waveHeight != null && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs mb-2 pt-1 border-t border-slate-700/40">
          <Cell label="Oleaje" value={`${score.waves.waveHeight.toFixed(1)} m`} color={waveColor(score.waves.waveHeight)} />
          {score.waves.wavePeriod != null && (
            <Cell label="Período" value={`${score.waves.wavePeriod.toFixed(0)} s`} />
          )}
        </div>
      )}

      {/* ── Water temp ── */}
      {score?.waterTemp != null && (
        <div className="text-xs mb-2 pt-1 border-t border-slate-700/40">
          <Cell label="Agua" value={`${score.waterTemp.toFixed(1)}°C`} color={waterTColor(score.waterTemp)} />
        </div>
      )}

      {/* ── Thermal context (if applicable) ── */}
      {score?.thermal && score.thermal.thermalProbability > 0 && (
        <div className="text-[10px] text-amber-300/70 mb-1">
          ☀️ Térmica {score.thermal.thermalProbability}% prob
          {score.thermal.windWindow && ` · ${score.thermal.windWindow.startHour}h–${score.thermal.windWindow.endHour}h`}
        </div>
      )}

      {/* ── Summary ── */}
      {score?.summary && (
        <div className="text-[10px] text-slate-400 leading-snug mt-1 pt-1 border-t border-slate-700/40">
          {score.summary}
        </div>
      )}

      {/* ── Hard gate warning ── */}
      {score?.hardGateTriggered && (
        <div className="text-[10px] text-red-400 font-bold mt-1">
          ⚠️ {score.hardGateTriggered}
        </div>
      )}

      {/* ── Storm alert ── */}
      {score?.hasStormAlert && (
        <div className="text-[10px] text-red-400 font-bold mt-1">
          🌩️ Alerta de tormenta activa
        </div>
      )}

      {/* ── Timestamp ── */}
      {score?.computedAt && (
        <div className="text-[9px] text-slate-500 mt-2 text-right">
          Scoring: {timeAgoEs(score.computedAt)}
        </div>
      )}
    </div>
  );

  // ── Mobile: bottom sheet ──────────────────────────
  if (isMobile) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-40 animate-slide-up">
        <div
          className="bg-slate-900 border-t border-slate-700 rounded-t-2xl shadow-2xl max-h-[55dvh] overflow-y-auto p-4"
          style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
        >
          {/* Drag handle */}
          <div className="flex justify-center mb-3">
            <div className="w-10 h-1 rounded-full bg-slate-600" />
          </div>
          {/* Close button */}
          <button
            onClick={() => selectSpot('')}
            className="absolute top-3 right-3 p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
            aria-label="Cerrar"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          {popupContent}
        </div>
      </div>
    );
  }

  // ── Desktop: MapLibre popup ───────────────────────
  return (
    <Popup
      longitude={spot.center[0]}
      latitude={spot.center[1]}
      anchor="bottom"
      offset={[0, -40]}
      closeOnClick={false}
      onClose={() => selectSpot('')}
      className="spot-popup"
    >
      {popupContent}
    </Popup>
  );
});

// ── Helper: data cell ────────────────────────────────────────
function Cell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-slate-500 text-[10px]">{label}</span>
      <span className="font-bold text-slate-200" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}

// ── Color helpers ────────────────────────────────────────────
function windKtColor(kt: number): string {
  if (kt < 5) return '#94a3b8';
  if (kt < 10) return '#fbbf24';
  if (kt < 18) return '#34d399';
  if (kt < 25) return '#22d3ee';
  return '#f87171';
}

function waveColor(m: number): string {
  if (m < 0.5) return '#94a3b8';
  if (m < 1.0) return '#34d399';
  if (m < 2.0) return '#fbbf24';
  return '#f87171';
}

function waterTColor(t: number): string {
  if (t < 13) return '#60a5fa';
  if (t < 16) return '#22d3ee';
  if (t < 20) return '#34d399';
  return '#fbbf24';
}

/** Lightweight relative-time in Spanish */
function timeAgoEs(ts: Date): string {
  const diff = Date.now() - ts.getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.round(mins / 60);
  return `hace ${hrs}h`;
}
