/**
 * Popup for sailing spots — shows scoring summary on marker click.
 * Desktop: MapLibre native popup. Mobile: bottom sheet.
 *
 * Displays: verdict, wind consensus, wave conditions, water temp,
 * matched pattern, score, and summary text.
 * Themed per verdict color to match SpotMarker.
 */
import { memo, useState, useMemo, useEffect } from 'react';
import { Popup } from 'react-map-gl/maplibre';
import { useSpotStore } from '../../store/spotStore';
import { useUIStore } from '../../store/uiStore';
import { WeatherIcon } from '../icons/WeatherIcons';
import type { SpotScore, SpotVerdict } from '../../services/spotScoringEngine';
import type { SailingSpot, SpotWebcam, WindPattern } from '../../config/spots';
import type { SailingWindow, SpotWindowResult } from '../../services/sailingWindowService';
import type { ThermalPrecursorResult } from '../../services/thermalPrecursorService';
import type { WebcamVisionResult } from '../../services/webcamVisionService';
import { beaufortToColor } from '../../services/webcamVisionService';
import { temperatureColor } from '../../services/windUtils';
import { fetchTidePredictions } from '../../api/tideClient';
import type { TidePoint } from '../../api/tideClient';

// ── Verdict palette — matches windSpeedColor() for coherence ──
const VERDICT_STYLE: Record<SpotVerdict, { color: string; bg: string; label: string }> = {
  calm:    { color: '#94a3b8', bg: 'rgba(100,116,139,0.15)', label: 'CALMA' },
  light:   { color: '#4ade80', bg: 'rgba(34,197,94,0.12)',   label: 'FLOJO' },
  sailing: { color: '#bef264', bg: 'rgba(163,230,53,0.12)',  label: 'NAVEGABLE' },
  good:    { color: '#facc15', bg: 'rgba(234,179,8,0.12)',   label: 'BUENO' },
  strong:  { color: '#fb923c', bg: 'rgba(249,115,22,0.12)',  label: 'FUERTE' },
  unknown: { color: '#94a3b8', bg: 'rgba(100,116,139,0.15)', label: 'SIN DATOS' },
};

interface SpotPopupProps {
  spot: SailingSpot;
  score: SpotScore | undefined;
}

export const SpotPopup = memo(function SpotPopup({ spot, score }: SpotPopupProps) {
  const selectSpot = useSpotStore((s) => s.selectSpot);
  const sailingWindows = useSpotStore((s) => s.sailingWindows);
  const thermalPrecursors = useSpotStore((s) => s.thermalPrecursors);
  const webcamVision = useSpotStore((s) => s.webcamVision);
  const isMobile = useUIStore((s) => s.isMobile);
  const windowResult = sailingWindows.get(spot.id);
  const precursor = spot.thermalDetection ? thermalPrecursors.get(spot.id) : undefined;
  const visionResult = webcamVision.get(spot.id);

  const verdict: SpotVerdict = score?.verdict ?? 'unknown';
  const vs = VERDICT_STYLE[verdict];

  const popupContent = (
    <div className={isMobile ? 'min-w-[240px] max-w-[320px]' : 'min-w-[220px] max-w-[280px]'}>
      {/* ── Header ── */}
      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-700/60">
        <div
          className={`${isMobile ? 'w-10 h-10' : 'w-8 h-8'} rounded-full flex items-center justify-center shrink-0`}
          style={{ background: vs.bg, border: `2px solid ${vs.color}` }}
        >
          <WeatherIcon id={spot.icon} size={isMobile ? 20 : 16} className="text-slate-200" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`${isMobile ? 'text-base' : 'text-sm'} font-bold text-slate-100 truncate`}>{spot.name}</span>
            <span className={`${isMobile ? 'text-[9px]' : 'text-[8px]'} font-bold tracking-wider text-amber-400/80 bg-amber-400/10 px-1.5 py-0.5 rounded-full border border-amber-400/20 shrink-0 leading-none`}>BETA</span>
          </div>
          <div className={`${isMobile ? 'text-[11px]' : 'text-[10px]'} text-slate-400`}>{spot.description}</div>
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
          <div className="flex items-baseline gap-1">
            <span className="text-slate-500 text-[10px]">Viento</span>
            <span className="font-bold" style={{ color: windKtColor(score.wind.avgSpeedKt) }}>
              {score.wind.avgSpeedKt.toFixed(0)} kt
            </span>
            <SpotWindTrend spotId={spot.id} />
            <SpotWindSparkline spotId={spot.id} />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-slate-500 text-[10px]">Dirección</span>
            <span className="font-bold text-slate-200 flex items-center gap-1">
              <span
                className="inline-block text-sm leading-none"
                style={{ transform: `rotate(${(score.wind.dirDeg + 180) % 360}deg)`, display: 'inline-block' }}
              >↑</span>
              {score.wind.dominantDir}
              <span className="text-[10px] text-slate-400 font-normal">{Math.round(score.wind.dirDeg)}°</span>
            </span>
          </div>
          {score.wind.matchedPattern && (
            <div className="col-span-2 text-[10px] text-amber-400/80 italic">
              <WeatherIcon id="thermal-wind" size={11} className="inline -mt-px" /> {score.wind.matchedPattern}
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

      {/* ── Temperatures & conditions ── */}
      {(score?.airTemp != null || score?.waterTemp != null || score?.humidity != null) && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs mb-2 pt-1 border-t border-slate-700/40">
          {score?.airTemp != null && (
            <Cell label="Aire" value={`${score.airTemp.toFixed(1)}°C`} color={temperatureColor(score.airTemp)} />
          )}
          {score?.waterTemp != null && (
            <Cell label="Agua" value={`${score.waterTemp.toFixed(1)}°C`} color={waterTColor(score.waterTemp)} />
          )}
          {score?.humidity != null && (
            <Cell label="Humedad" value={`${score.humidity.toFixed(0)}%`} color={humidityColor(score.humidity)} />
          )}
          {score?.windChill != null && (
            <Cell label="Sensación" value={`${score.windChill.toFixed(1)}°C`} color={temperatureColor(score.windChill)} />
          )}
        </div>
      )}

      {/* ── Tide summary (Rías spots only) ── */}
      {spot.tideStationId && <SpotTideSummary tideStationId={spot.tideStationId} />}

      {/* ── Thermal context (if applicable) ── */}
      {score?.thermal && score.thermal.thermalProbability > 0 && (
        <div className="text-[10px] text-amber-300/70 mb-1">
          <WeatherIcon id="sun" size={12} className="inline -mt-px" /> Térmica {score.thermal.thermalProbability}% prob
          {score.thermal.windWindow && ` · ${score.thermal.windWindow.startHour}h–${score.thermal.windWindow.endHour}h`}
        </div>
      )}

      {/* ── Thermal boost indicator ── */}
      {score?.thermalBoosted && (
        <div
          className="text-[10px] font-semibold mb-1 px-1.5 py-0.5 rounded"
          style={{ background: 'rgba(251,191,36,0.10)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.20)' }}
        >
          <WeatherIcon id="thermal-wind" size={12} className="inline -mt-px" />{' '}
          Térmica detectada — estaciones en tierra subestiman el viento en el agua
        </div>
      )}

      {/* ── Scoring confidence ── */}
      {score && score.scoringConfidence === 'low' && (
        <div className="text-[10px] text-slate-500 italic mb-1">
          <WeatherIcon id="alert-triangle" size={11} className="inline -mt-px" /> Baja confianza: solo {score.wind?.stationCount ?? 0} fuente(s) de viento cercana(s)
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
          <WeatherIcon id="alert-triangle" size={11} className="inline -mt-px" /> {score.hardGateTriggered}
        </div>
      )}

      {/* ── Storm alert ── */}
      {score?.hasStormAlert && (
        <div className="text-[10px] text-red-400 font-bold mt-1">
          <WeatherIcon id="alert-triangle" size={12} className="inline -mt-px" /> Alerta de tormenta activa
        </div>
      )}

      {/* ── Scoring breakdown (collapsible) ── */}
      {score && score.verdict !== 'unknown' && <ScoringBreakdown score={score} spot={spot} />}

      {/* ── Sailing windows (collapsible) ── */}
      {windowResult && <SailingWindowsSection result={windowResult} />}

      {/* ── Thermal precursor early warning (collapsible) ── */}
      {precursor && precursor.level !== 'none' && <ThermalPrecursorSection precursor={precursor} />}

      {/* ── Webcam Vision — Beaufort from LLM (dev mode) ── */}
      {visionResult && visionResult.beaufort > 0 && <WebcamVisionBadge result={visionResult} />}

      {/* ── Webcams (collapsible) ── */}
      {spot.webcams && spot.webcams.length > 0 && <WebcamSection webcams={spot.webcams} />}

      {/* ── Wind patterns (collapsible) ── */}
      {spot.windPatterns.length > 0 && <WindPatterns patterns={spot.windPatterns} />}

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
            className="absolute top-3 right-3 p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
            aria-label="Cerrar"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
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

// ── Sailing windows (collapsible) ─────────────────────────────

function SailingWindowsSection({ result }: { result: SpotWindowResult }) {
  const [open, setOpen] = useState(false);
  const { windows, bestWindow } = result;

  if (windows.length === 0) {
    return (
      <div className="mt-2 pt-1.5 border-t border-slate-700/40">
        <div className="flex items-center gap-1 text-[10px] text-slate-500">
          <WeatherIcon id="clock" size={11} className="text-slate-500" />
          <span>Sin ventanas de viento en 48h</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 pt-1.5 border-t border-slate-700/40">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-300 transition-colors w-full text-left"
      >
        <WeatherIcon id="clock" size={11} className="text-slate-400 shrink-0" />
        <span className="font-semibold">Mejores ventanas</span>
        <span className="text-slate-500 text-[9px] ml-1">({windows.length})</span>
        <span className="text-slate-500 text-[9px] ml-auto">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-1">
          {windows.map((w, i) => (
            <WindowRow key={i} window={w} isBest={bestWindow === w} />
          ))}
        </div>
      )}
    </div>
  );
}

function WindowRow({ window: w, isBest }: { window: SailingWindow; isBest: boolean }) {
  const dotColor = w.verdict === 'good' ? '#22c55e' : '#eab308';
  return (
    <div className={`bg-slate-800/40 rounded px-2 py-1 ${isBest ? 'ring-1 ring-emerald-500/30' : ''}`}>
      <div className="flex items-center gap-1.5 text-[10px]">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: dotColor }} />
        <span className="font-bold text-slate-200 flex-1">{w.summary}</span>
        <span className="text-slate-500 font-mono text-[9px]">{w.avgScore}</span>
      </div>
      {isBest && (
        <div className="text-[9px] text-emerald-400 mt-0.5">★ Mejor ventana</div>
      )}
    </div>
  );
}

// ── Scoring breakdown "¿Por qué?" (collapsible) ─────────────

function ScoringBreakdown({ score, spot }: { score: SpotScore; spot: SailingSpot }) {
  const [open, setOpen] = useState(false);

  const lines: { label: string; value: string; color?: string }[] = [];

  // Wind consensus
  if (score.wind) {
    const w = score.wind;
    lines.push({
      label: 'Consenso viento',
      value: `${w.stationCount} estaciones, ${w.avgSpeedKt.toFixed(0)} kt ${w.dominantDir}`,
      color: windKtColor(w.avgSpeedKt),
    });
    if (w.matchedPattern) {
      lines.push({ label: 'Patrón', value: w.matchedPattern, color: '#fbbf24' });
    }
  }

  // Wave conditions
  if (score.waves?.waveHeight != null) {
    const wh = score.waves.waveHeight;
    const relevance = spot.waveRelevance === 'critical' ? 'oceánico' : spot.waveRelevance === 'moderate' ? 'moderado' : 'interior';
    lines.push({
      label: `Oleaje (${relevance})`,
      value: `${wh.toFixed(1)} m${score.waves.wavePeriod != null ? ` · Tp ${score.waves.wavePeriod.toFixed(0)}s` : ''}`,
      color: waveColor(wh),
    });
  } else if (spot.waveRelevance === 'none') {
    lines.push({ label: 'Aguas', value: 'Aguas planas (bonus)', color: '#22c55e' });
  }

  // Thermal context
  if (score.thermal && score.thermal.thermalProbability > 0) {
    lines.push({
      label: 'Térmica',
      value: `${score.thermal.thermalProbability}% prob${score.thermal.deltaT != null ? ` · ΔT ${score.thermal.deltaT.toFixed(0)}°C` : ''}`,
      color: '#fbbf24',
    });
    if (score.thermal.windWindow) {
      const tw = score.thermal.windWindow;
      lines.push({
        label: 'Ventana térmica',
        value: `${tw.startHour}h–${tw.endHour}h · ~${tw.avgSpeedKt.toFixed(0)} kt ${tw.dominantDir}`,
      });
    }
  }

  // Hard gate
  if (score.hardGateTriggered) {
    lines.push({ label: 'Límite', value: score.hardGateTriggered, color: '#ef4444' });
  }

  // Wind direction penalty
  if (score.wind && spot.id === 'cesantes' && score.wind.dominantDir === 'N') {
    lines.push({ label: 'Penalización', value: 'Norte en Cesantes (−15)', color: '#f97316' });
  }

  if (lines.length === 0) return null;

  return (
    <div className="mt-2 pt-1.5 border-t border-slate-700/40">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-300 transition-colors w-full text-left"
      >
        <WeatherIcon id="info" size={11} className="text-slate-400 shrink-0" />
        <span className="font-semibold">¿Por qué {VERDICT_STYLE[score.verdict].label.toLowerCase()}?</span>
        <span className="text-slate-500 text-[9px] ml-auto">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-1">
          {lines.map((line, i) => (
            <div key={i} className="flex items-baseline gap-1.5 text-[10px]">
              <span className="text-slate-500 shrink-0 w-[72px] text-right">{line.label}</span>
              <span className="font-semibold" style={line.color ? { color: line.color } : { color: '#e2e8f0' }}>
                {line.value}
              </span>
            </div>
          ))}
          <div className="text-[9px] text-slate-600 mt-1 italic">
            Score: {score.score}/100 · {score.wind?.stationCount ?? 0} estaciones
          </div>
        </div>
      )}
    </div>
  );
}

// ── Wind patterns (collapsible) ──────────────────────────────

/** Cardinal arrow for wind direction (degrees) */
function dirArrow(deg: number): string {
  const arrows = ['↓', '↙', '←', '↖', '↑', '↗', '→', '↘'];
  return arrows[Math.round(deg / 45) % 8];
}

function WindPatterns({ patterns }: { patterns: WindPattern[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 pt-1.5 border-t border-slate-700/40">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-300 transition-colors w-full text-left"
      >
        <WeatherIcon id="wind" size={11} className="text-slate-500 shrink-0" />
        <span className="font-semibold">Patrones de viento</span>
        <span className="text-slate-500 text-[9px] ml-auto">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5">
          {patterns.map((p) => (
            <div key={p.name} className="bg-slate-800/40 rounded px-2 py-1.5">
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="text-slate-300 font-mono">{dirArrow(p.direction)}</span>
                <span className="font-bold text-slate-200">{p.name}</span>
                <span className="text-slate-500 ml-auto">{p.season}</span>
              </div>
              <p className="text-[9px] text-slate-400 mt-0.5 leading-snug">{p.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Webcam section (collapsible) ─────────────────────────────

/** Compass label from azimuth degrees */
function azimuthLabel(deg: number): string {
  const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return labels[Math.round(deg / 45) % 8];
}

// ── Thermal precursor early warning ────────────────────────
const PRECURSOR_LEVEL_STYLE: Record<string, { color: string; bg: string }> = {
  watch:    { color: '#94a3b8', bg: 'rgba(100,116,139,0.12)' },
  probable: { color: '#fbbf24', bg: 'rgba(251,191,36,0.10)' },
  imminent: { color: '#fb923c', bg: 'rgba(249,115,22,0.12)' },
  active:   { color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
};

function ThermalPrecursorSection({ precursor }: { precursor: ThermalPrecursorResult }) {
  const [open, setOpen] = useState(false);
  const style = PRECURSOR_LEVEL_STYLE[precursor.level] ?? PRECURSOR_LEVEL_STYLE.watch;

  const activeSignals = Object.entries(precursor.signals).filter(([, s]) => s.active);

  return (
    <div className="mt-2 pt-2 border-t border-slate-700/40">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-left group"
      >
        <span className="text-[11px] font-semibold" style={{ color: style.color }}>
          <WeatherIcon id="thermal-wind" size={12} className="inline -mt-px" />{' '}
          Alerta térmica temprana
        </span>
        <span className="text-[10px] text-slate-500 group-hover:text-slate-400">{open ? '▴' : '▾'}</span>
      </button>

      {/* Summary always visible */}
      <div
        className="text-[10px] mt-1 px-1.5 py-1 rounded"
        style={{ background: style.bg, color: style.color, border: `1px solid ${style.color}33` }}
      >
        {precursor.summary}
        {precursor.eta && (
          <span className="ml-1 opacity-80">· ventana {precursor.eta}</span>
        )}
      </div>

      {/* Confidence badge */}
      <div className="flex items-center gap-2 mt-1 text-[9px] text-slate-500">
        <span>Probabilidad: <strong style={{ color: style.color }}>{precursor.probability}%</strong></span>
        <span>· Confianza: {precursor.confidence}</span>
        <span>· {activeSignals.length}/6 señales</span>
      </div>

      {/* Expanded signal details */}
      {open && (
        <div className="mt-1.5 space-y-0.5">
          {Object.entries(precursor.signals).map(([key, signal]) => (
            <PrecursorSignalRow key={key} name={SIGNAL_NAMES[key] ?? key} signal={signal} />
          ))}
        </div>
      )}
    </div>
  );
}

const SIGNAL_NAMES: Record<string, string> = {
  terral: 'Terral matutino',
  deltaTWaterAir: 'ΔT agua-aire',
  solarRamp: 'Radiación solar',
  humidityGradient: 'Gradiente humedad',
  windDivergence: 'Divergencia viento',
  forecastFavorable: 'Previsión favorable',
};

function PrecursorSignalRow({ name, signal }: { name: string; signal: { active: boolean; score: number; value: string; weight: number } }) {
  const barWidth = Math.min(100, signal.score);
  const color = signal.active ? '#22c55e' : '#475569';

  return (
    <div className="flex items-center gap-1.5 text-[9px]">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
      <span className="text-slate-400 w-[90px] truncate">{name}</span>
      <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${barWidth}%`, background: color }} />
      </div>
      <span className="text-slate-500 w-[80px] truncate text-right" title={signal.value}>{signal.value}</span>
    </div>
  );
}

// ── Webcam Vision result badge ─────────────────────────────
function WebcamVisionBadge({ result }: { result: WebcamVisionResult }) {
  const color = beaufortToColor(result.beaufort);
  const ago = timeAgoEs(result.analyzedAt);
  return (
    <div
      className="mt-2 pt-2 border-t border-slate-700/40 text-[10px]"
    >
      <div className="flex items-center gap-2">
        <span className="text-slate-400 flex items-center gap-1"><WeatherIcon id="camera" size={11} /> Visión webcam:</span>
        <span
          className="font-bold px-1.5 py-0.5 rounded"
          style={{ color, background: `${color}15`, border: `1px solid ${color}33` }}
        >
          Beaufort {result.beaufort} · {result.beaufortLabel} · ~{result.windEstimateKt}kt
        </span>
        <span className="text-slate-600">{result.confidence}</span>
      </div>
      <div className="text-slate-500 mt-0.5 truncate" title={result.description}>
        {result.description}
      </div>
      <div className="text-[9px] text-slate-600 mt-0.5">
        vía {result.providerUsed} · {result.latencyMs}ms · {ago}
      </div>
    </div>
  );
}

function WebcamSection({ webcams }: { webcams: SpotWebcam[] }) {
  const [open, setOpen] = useState(false);
  const [imgKey, setImgKey] = useState(0);

  return (
    <div className="mt-2 pt-1.5 border-t border-slate-700/40">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-300 transition-colors w-full text-left"
      >
        <WeatherIcon id="camera" size={11} className="text-slate-500 shrink-0" />
        <span className="font-semibold">Webcams</span>
        <span className="text-slate-500 text-[9px] ml-1">({webcams.length})</span>
        <span className="text-slate-500 text-[9px] ml-auto">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-2">
          {webcams.map((cam) => (
            <div key={cam.url} className="bg-slate-800/40 rounded px-2 py-1.5">
              <div className="flex items-center gap-1.5 text-[10px] mb-1">
                <span className="font-bold text-slate-200">{cam.label}</span>
                <span className="text-slate-500 ml-auto">{azimuthLabel(cam.azimuth)}</span>
              </div>

              {cam.type === 'image' ? (
                <>
                  <img
                    key={imgKey}
                    src={`${cam.url}?_t=${imgKey || Date.now()}`}
                    alt={cam.label}
                    className="w-full rounded border border-slate-700/60"
                    loading="lazy"
                  />
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[9px] text-slate-500">{cam.source}</span>
                    <button
                      onClick={() => setImgKey(Date.now())}
                      className="text-[9px] text-sky-400 hover:text-sky-300 transition-colors"
                    >
                      ↻ Actualizar
                    </button>
                  </div>
                </>
              ) : (
                <a
                  href={cam.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-[10px] text-sky-400 hover:text-sky-300 transition-colors"
                >
                  <span>▶</span>
                  <span>Ver stream en vivo</span>
                  <span className="text-slate-500 ml-auto">{cam.source}</span>
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Wind trend + sparkline for spots ─────────────────────────

const SPARK_W = 40;
const SPARK_H = 16;

function SpotWindSparkline({ spotId }: { spotId: string }) {
  const history = useSpotStore((s) => s.windHistory.get(spotId));

  const path = useMemo(() => {
    if (!history || history.length < 3) return null;
    const speeds = history.map((h) => h.kt);
    const max = Math.max(...speeds, 1);
    const step = SPARK_W / (speeds.length - 1);
    return speeds
      .map((s, i) => {
        const x = (i * step).toFixed(1);
        const y = (SPARK_H - (s / max) * (SPARK_H - 2) - 1).toFixed(1);
        return `${i === 0 ? 'M' : 'L'}${x},${y}`;
      })
      .join(' ');
  }, [history]);

  if (!path) return null;

  return (
    <svg width={SPARK_W} height={SPARK_H} className="ml-0.5 flex-shrink-0 opacity-60" aria-label="Tendencia viento spot">
      <path fill="none" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  );
}

function SpotWindTrend({ spotId }: { spotId: string }) {
  const history = useSpotStore((s) => s.windHistory.get(spotId));

  const trend = useMemo(() => {
    if (!history || history.length < 3) return null;
    const recent = history.slice(-3);
    const older = history.slice(-6, -3);
    if (older.length === 0) return null;
    const avgRecent = recent.reduce((a, b) => a + b.kt, 0) / recent.length;
    const avgOlder = older.reduce((a, b) => a + b.kt, 0) / older.length;
    const diff = avgRecent - avgOlder;
    if (diff > 1) return { symbol: '\u2191', color: '#22c55e' };
    if (diff < -1) return { symbol: '\u2193', color: '#ef4444' };
    return { symbol: '\u2192', color: '#64748b' };
  }, [history]);

  if (!trend) return null;

  return (
    <span className="text-xs font-bold leading-none" style={{ color: trend.color }} title="Tendencia viento">
      {trend.symbol}
    </span>
  );
}

// ── Spot tide summary ─────────────────────────────────────────

function SpotTideSummary({ tideStationId }: { tideStationId: string }) {
  const [tides, setTides] = useState<TidePoint[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchTidePredictions(tideStationId)
      .then((pts) => { if (!cancelled) setTides(pts); })
      .catch(() => { if (!cancelled) setTides(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tideStationId]);

  // Find next tide from now
  const nextTide = useMemo(() => {
    if (!tides || tides.length === 0) return null;
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    for (const t of tides) {
      const parts = t.time.split(':').map(Number);
      if (parts.length < 2) continue;
      const tideMins = parts[0] * 60 + parts[1];
      if (tideMins > nowMins) return t;
    }
    return tides[0]; // wrap to first tomorrow
  }, [tides]);

  if (loading) return null;
  if (!tides || tides.length === 0) return null;

  return (
    <div className="text-[10px] mb-1.5 pt-1 border-t border-slate-700/40">
      <div className="flex items-center gap-1 text-slate-400 mb-0.5">
        <WeatherIcon id="anchor" size={10} className="text-cyan-500/70" />
        <span className="font-semibold">Mareas hoy</span>
      </div>
      <div className="flex gap-2 flex-wrap">
        {tides.map((t, i) => {
          const isNext = t === nextTide;
          const icon = t.type === 'high' ? '▲' : '▼';
          const color = t.type === 'high' ? '#22d3ee' : '#60a5fa';
          return (
            <span
              key={i}
              className={`font-mono ${isNext ? 'font-bold' : 'opacity-60'}`}
              style={{ color: isNext ? color : undefined }}
              title={t.type === 'high' ? 'Pleamar' : 'Bajamar'}
            >
              {icon} {t.time} ({t.height.toFixed(1)}m)
            </span>
          );
        })}
      </div>
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

function humidityColor(h: number): string {
  if (h < 40) return '#fbbf24';
  if (h < 60) return '#34d399';
  if (h < 80) return '#60a5fa';
  return '#a78bfa';
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
