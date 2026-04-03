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
import { useWebcamStore } from '../../store/webcamStore';
import { useSwipeToDismiss } from '../../hooks/useSwipeToDismiss';
import { WeatherIcon } from '../icons/WeatherIcons';
import type { SpotScore, SpotVerdict, WindContribution } from '../../services/spotScoringEngine';
import type { SailingSpot, SpotWebcam, WindPattern } from '../../config/spots';
import type { SailingWindow, SpotWindowResult } from '../../services/sailingWindowService';
import type { ThermalPrecursorResult } from '../../services/thermalPrecursorService';
import type { WebcamVisionResult } from '../../services/webcamVisionService';
import type { HourlyForecast } from '../../types/forecast';
import { detectThermalForecast } from '../../services/thermalForecastDetector';
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
  const favoriteSpotId = useSpotStore((s) => s.favoriteSpotId);
  const toggleFavorite = useSpotStore((s) => s.toggleFavorite);
  const sailingWindows = useSpotStore((s) => s.sailingWindows);
  const thermalPrecursors = useSpotStore((s) => s.thermalPrecursors);
  const webcamVision = useSpotStore((s) => s.webcamVision);
  const isMobile = useUIStore((s) => s.isMobile);
  const dismiss = () => selectSpot('');
  const { sheetRef, onTouchStart, onTouchMove, onTouchEnd } = useSwipeToDismiss(dismiss);
  const sectorForecast = useSpotStore((s) => s.sectorForecast);
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
            <button
              onClick={(e) => { e.stopPropagation(); toggleFavorite(spot.id); }}
              className={`shrink-0 transition-colors ${isMobile ? 'text-base' : 'text-sm'} ${
                favoriteSpotId === spot.id ? 'text-amber-400' : 'text-slate-500 hover:text-amber-300'
              }`}
              title={favoriteSpotId === spot.id ? 'Quitar favorito' : 'Marcar favorito'}
              aria-label={favoriteSpotId === spot.id ? 'Quitar favorito' : 'Marcar favorito'}
            >
              {favoriteSpotId === spot.id ? '\u2605' : '\u2606'}
            </button>
            <span className={`${isMobile ? 'text-[11px]' : 'text-[11px]'} font-bold tracking-wider text-amber-300 bg-amber-500/20 px-1.5 py-0.5 rounded-full border border-amber-500/30 shrink-0 leading-none`}>BETA</span>
          </div>
          <div className={`${isMobile ? 'text-[11px]' : 'text-[11px]'} text-slate-400`}>{spot.description}</div>
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
            <span className="text-slate-500 text-[11px]">Viento</span>
            <span className="font-bold" style={{ color: windKtColor(score.wind.avgSpeedKt) }}>
              {score.wind.avgSpeedKt.toFixed(0)} kt
            </span>
            <SpotWindTrend spotId={spot.id} />
            <SpotWindSparkline spotId={spot.id} />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-slate-500 text-[11px]">Dirección</span>
            <span className="font-bold text-slate-200 flex items-center gap-1">
              <span
                className="inline-block text-sm leading-none"
                style={{ transform: `rotate(${(score.wind.dirDeg + 180) % 360}deg)`, display: 'inline-block' }}
              >↑</span>
              {score.wind.dominantDir}
              <span className="text-[11px] text-slate-400 font-normal">{Math.round(score.wind.dirDeg)}°</span>
            </span>
          </div>
          {score.gustKt != null && score.gustKt > score.wind.avgSpeedKt && (
            <Cell label="Racha" value={`${score.gustKt.toFixed(0)} kt`} color={windKtColor(score.gustKt)} />
          )}
          {score.wind.matchedPattern && (
            <div className="col-span-2 text-[11px] text-amber-400/80 italic">
              <WeatherIcon id="thermal-wind" size={11} className="inline -mt-px" /> {score.wind.matchedPattern}
            </div>
          )}
          <Cell label="Estaciones" value={`${score.wind.stationCount}`} />
        </div>
      )}

      {/* ── Wind trend (30min ramp detection) ── */}
      {score?.windTrend && score.windTrend.signal !== 'none' && (
        <div className={`text-[11px] rounded px-2 py-1 mb-2 ${
          score.windTrend.signal === 'rapid' ? 'text-red-400 bg-red-500/10' :
          score.windTrend.signal === 'building' ? 'text-sky-400 bg-sky-500/10' :
          'text-amber-400 bg-amber-500/10'
        }`}>
          {score.windTrend.signal === 'rapid' && <WeatherIcon id="alert-triangle" size={11} className="inline -mt-px mr-1" />}
          {score.windTrend.signal === 'building' && <WeatherIcon id="wind" size={11} className="inline -mt-px mr-1" />}
          {score.windTrend.signal === 'dropping' && <WeatherIcon id="wind" size={11} className="inline -mt-px mr-1" />}
          {score.windTrend.label}
        </div>
      )}

      {/* ── Wave conditions (coastal spots) ── */}
      {score?.waves && score.waves.waveHeight != null && spot.waveRelevance !== 'none' && (
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
          {score?.dewPoint != null && (
            <Cell label="P. rocío" value={`${score.dewPoint.toFixed(1)}°C`} />
          )}
          {score?.windChill != null && (
            <Cell label="Sensación" value={`${score.windChill.toFixed(1)}°C`} color={temperatureColor(score.windChill)} />
          )}
          {score?.heatIndex != null && (
            <Cell label="Calor" value={`${score.heatIndex.toFixed(1)}°C`} color={score.heatIndex > 35 ? '#ef4444' : score.heatIndex > 32 ? '#fb923c' : '#facc15'} />
          )}
        </div>
      )}

      {/* ── Humidity precursor signal (bruma pattern) ── */}
      {score?.humiditySignal && (
        <div className="text-[11px] text-amber-400 bg-amber-500/10 rounded px-2 py-1 mb-2">
          {score.humiditySignal}
        </div>
      )}

      {/* ── Thermal forecast early warning (BETA) ── */}
      {spot.thermalDetection && sectorForecast && sectorForecast.length > 0 && (
        <ThermalForecastBadge forecast={sectorForecast} />
      )}

      {/* ── Tide summary (Rías spots only) ── */}
      {spot.tideStationId && <SpotTideSummary tideStationId={spot.tideStationId} />}

      {/* ── Thermal context (if applicable) ── */}
      {score?.thermal && score.thermal.thermalProbability > 0 && (
        <div className="text-[11px] text-amber-300/70 mb-1">
          <WeatherIcon id="sun" size={12} className="inline -mt-px" /> Térmica {score.thermal.thermalProbability}% prob
          {score.thermal.windWindow && ` · ${score.thermal.windWindow.startHour}h–${score.thermal.windWindow.endHour}h`}
        </div>
      )}

      {/* Thermal boost indicator removed — redundant with "Térmica X% prob" already shown above */}

      {/* ── Scoring confidence ── */}
      {score && score.scoringConfidence === 'low' && (
        <div className="text-[11px] text-slate-500 italic mb-1">
          <WeatherIcon id="alert-triangle" size={11} className="inline -mt-px" /> Baja confianza: solo {score.wind?.stationCount ?? 0} fuente(s) de viento cercana(s)
        </div>
      )}

      {/* ── Summary ── */}
      {score?.summary && (
        <div className="text-[11px] text-slate-400 leading-snug mt-1 pt-1 border-t border-slate-700/40">
          {score.summary}
        </div>
      )}

      {/* ── Hard gate warning ── */}
      {score?.hardGateTriggered && (
        <div className="text-[11px] text-red-400 font-bold mt-1">
          <WeatherIcon id="alert-triangle" size={11} className="inline -mt-px" /> {score.hardGateTriggered}
        </div>
      )}

      {/* ── Storm alert ── */}
      {score?.hasStormAlert && (
        <div className="text-[11px] text-red-400 font-bold mt-1">
          <WeatherIcon id="alert-triangle" size={12} className="inline -mt-px" /> Alerta de tormenta activa
        </div>
      )}

      {/* ── Scoring breakdown (collapsible) ── */}
      {score && score.verdict !== 'unknown' && <ScoringBreakdown score={score} spot={spot} />}

      {/* ── Sailing windows (collapsible) ── */}
      {windowResult && <SailingWindowsSection result={windowResult} />}

      {/* ── Forecast mini-timeline (12h) ── */}
      {sectorForecast.length > 0 && <ForecastMiniTimeline forecast={sectorForecast} />}

      {/* ── Thermal precursor early warning (collapsible) ── */}
      {precursor && precursor.level !== 'none' && <ThermalPrecursorSection precursor={precursor} />}

      {/* ── Webcam Vision — weather analysis from LLM ── */}
      {visionResult && (visionResult.beaufort >= 0 || visionResult.weather.weatherDescription) && (
        <WebcamVisionBadge result={visionResult} />
      )}

      {/* ── Webcams (collapsible) ── */}
      {spot.webcams && spot.webcams.length > 0 && <WebcamSection webcams={spot.webcams} />}

      {/* ── Wind patterns (collapsible) ── */}
      {spot.windPatterns.length > 0 && <WindPatterns patterns={spot.windPatterns} />}

      {/* ── Share + Timestamp ── */}
      <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-700/30">
        <ShareButton spot={spot} score={score} verdict={verdict} vs={vs} />
        {score?.computedAt && (
          <span className="text-[11px] text-slate-500">
            {timeAgoEs(score.computedAt)}
          </span>
        )}
      </div>
    </div>
  );

  // ── Mobile: bottom sheet ──────────────────────────
  if (isMobile) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-50 animate-slide-up">
        <div
          ref={sheetRef}
          className="bg-slate-900 border-t border-slate-700 rounded-t-2xl shadow-2xl max-h-[60dvh] overflow-y-auto p-4"
          style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom, 0px))' }}
        >
          {/* Drag handle — swipe down to dismiss */}
          <div className="flex justify-center mb-3" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
            <div className="w-10 h-1 rounded-full bg-slate-600" />
          </div>
          {/* Close button */}
          <button
            onClick={dismiss}
            className="absolute top-3 right-3 p-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white min-w-[44px] min-h-[44px] flex items-center justify-center"
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
      <span className="text-slate-500 text-[11px]">{label}</span>
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
        <div className="flex items-center gap-1 text-[11px] text-slate-500">
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
        className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-300 transition-colors w-full text-left"
      >
        <WeatherIcon id="clock" size={11} className="text-slate-400 shrink-0" />
        <span className="font-semibold">Mejores ventanas</span>
        <span className="text-slate-500 text-[11px] ml-1">({windows.length})</span>
        <span className="text-slate-500 text-[11px] ml-auto">{open ? '▲' : '▼'}</span>
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
      <div className="flex items-center gap-1.5 text-[11px]">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: dotColor }} />
        <span className="font-bold text-slate-200 flex-1">{w.summary}</span>
        <span className="text-slate-500 font-mono text-[11px]">{w.avgScore}</span>
      </div>
      {isBest && (
        <div className="text-[11px] text-emerald-400 mt-0.5">★ Mejor ventana</div>
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
        className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-300 transition-colors w-full text-left"
      >
        <WeatherIcon id="info" size={11} className="text-slate-400 shrink-0" />
        <span className="font-semibold">¿Por qué {VERDICT_STYLE[score.verdict].label.toLowerCase()}?</span>
        <span className="text-slate-500 text-[11px] ml-auto">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-1">
          {lines.map((line, i) => (
            <div key={i} className="flex items-baseline gap-1.5 text-[11px]">
              <span className="text-slate-500 shrink-0 w-[72px] text-right">{line.label}</span>
              <span className="font-semibold" style={line.color ? { color: line.color } : { color: '#e2e8f0' }}>
                {line.value}
              </span>
            </div>
          ))}
          <div className="text-[11px] text-slate-600 mt-1 italic">
            Score: {score.score}/100 · {score.wind?.stationCount ?? 0} fuentes
          </div>
          {score.wind?.contributions && <WindSources contributions={score.wind.contributions} />}
          <SpotVisionBadge spot={spot} />
        </div>
      )}
    </div>
  );
}

// ── Vision IA badge for spots with nearby webcam ────────────

function SpotVisionBadge({ spot }: { spot: SailingSpot }) {
  const visionResults = useWebcamStore((s) => s.visionResults);
  if (!spot.webcams || spot.webcams.length === 0) return null;

  // Find vision data for any webcam linked to this spot (via config/webcams.ts nearestSpotId)
  // Also check by matching webcam URL patterns
  let bestResult: { bf: number; label: string; kt: number; confidence: string; sky: string; fog: boolean; ago: number; webcamName: string } | null = null;

  for (const [webcamId, result] of visionResults) {
    if (result.beaufort < 0) continue;
    // Check if this webcam's spotId matches
    if (result.spotId === spot.id) {
      const ago = Math.round((Date.now() - result.analyzedAt.getTime()) / 60_000);
      if (!bestResult || result.confidence === 'high' || ago < (bestResult.ago ?? 999)) {
        bestResult = { bf: result.beaufort, label: result.beaufortLabel, kt: result.windEstimateKt, confidence: result.confidence, sky: result.weather.sky, fog: result.weather.fogVisible, ago, webcamName: webcamId };
      }
    }
  }

  if (!bestResult) return null;

  const color = bestResult.bf <= 1 ? '#94a3b8' : bestResult.bf <= 3 ? '#38bdf8' : bestResult.bf <= 5 ? '#fbbf24' : '#f87171';

  return (
    <div className="mt-1 pt-1 border-t border-slate-700/30">
      <div className="flex items-center gap-1.5 text-[10px]">
        <span className="text-slate-600">Vision IA:</span>
        <span className="font-bold" style={{ color }}>B{bestResult.bf}</span>
        <span className="text-slate-500">{bestResult.label} ~{bestResult.kt}kt</span>
        {bestResult.fog && <span className="text-amber-400">Niebla</span>}
        <span className="ml-auto text-slate-600">{bestResult.ago < 60 ? `${bestResult.ago}m` : `${Math.round(bestResult.ago / 60)}h`}</span>
      </div>
    </div>
  );
}

// ── Wind sources (collapsible) ──────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  aemet: 'AEMET', meteogalicia: 'MG', meteoclimatic: 'MC',
  wunderground: 'WU', netatmo: 'NT', skyx: 'SkyX', buoy: 'Boya',
};

function WindSources({ contributions }: { contributions: WindContribution[] }) {
  const [open, setOpen] = useState(false);
  if (!contributions || contributions.length === 0) return null;
  return (
    <div className="mt-1 pt-1 border-t border-slate-700/30">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-[10px] text-blue-400/70 hover:text-blue-300 cursor-pointer flex items-center gap-1"
      >
        <span className="text-[8px]">{open ? '▼' : '▶'}</span>
        Fuentes ({contributions.length})
      </button>
      {open && (
        <div className="mt-1 space-y-0.5">
          {contributions.slice(0, 8).map((c, i) => (
            <div key={i} className="flex items-center gap-1 text-[9px] text-slate-400">
              <span className={`w-[24px] shrink-0 font-mono ${c.source === 'buoy' ? 'text-cyan-400' : 'text-slate-500'}`}>
                {SOURCE_LABELS[c.source] ?? c.source}
              </span>
              <span className="truncate flex-1" title={c.name}>{c.name}</span>
              <span className="font-semibold text-slate-300 w-[32px] text-right">{c.speedKt}kt</span>
              <span className="w-[16px] text-center">{c.dir ?? '-'}</span>
              <span className="text-slate-600 w-[28px] text-right">{c.distKm}km</span>
              <span className="text-slate-600 w-[22px] text-right">{c.weightPct}%</span>
            </div>
          ))}
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
        className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-300 transition-colors w-full text-left"
      >
        <WeatherIcon id="wind" size={11} className="text-slate-500 shrink-0" />
        <span className="font-semibold">Patrones de viento</span>
        <span className="text-slate-500 text-[11px] ml-auto">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5">
          {patterns.map((p) => (
            <div key={p.name} className="bg-slate-800/40 rounded px-2 py-1.5">
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="text-slate-300 font-mono">{dirArrow(p.direction)}</span>
                <span className="font-bold text-slate-200">{p.name}</span>
                <span className="text-slate-500 ml-auto">{p.season}</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{p.description}</p>
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
        <span className="text-[11px] text-slate-500 group-hover:text-slate-400">{open ? '▴' : '▾'}</span>
      </button>

      {/* Summary always visible */}
      <div
        className="text-[11px] mt-1 px-1.5 py-1 rounded"
        style={{ background: style.bg, color: style.color, border: `1px solid ${style.color}33` }}
      >
        {precursor.summary}
        {precursor.eta && (
          <span className="ml-1 opacity-80">· ventana {precursor.eta}</span>
        )}
      </div>

      {/* Confidence badge */}
      <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
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
    <div className="flex items-center gap-1.5 text-[11px]">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
      <span className="text-slate-400 w-[90px] truncate">{name}</span>
      <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${barWidth}%`, background: color }} />
      </div>
      <span className="text-slate-500 w-[80px] truncate text-right" title={signal.value}>{signal.value}</span>
    </div>
  );
}

// ── Sky condition icons ─────────────────────────────────────
const SKY_LABELS: Record<string, { label: string; color: string }> = {
  clear: { label: 'Despejado', color: '#fbbf24' },
  partly_cloudy: { label: 'Parcial', color: '#94a3b8' },
  overcast: { label: 'Nublado', color: '#64748b' },
  fog: { label: 'Niebla', color: '#a78bfa' },
  rain: { label: 'Lluvia', color: '#60a5fa' },
  storm: { label: 'Tormenta', color: '#f87171' },
  night: { label: 'Noche', color: '#818cf8' },
  unknown: { label: '--', color: '#64748b' },
};

const VIS_LABELS: Record<string, { color: string; label: string }> = {
  good: { color: '#4ade80', label: 'Buena' },
  moderate: { color: '#fbbf24', label: 'Moderada' },
  poor: { color: '#f87171', label: 'Pobre' },
};

const LIGHT_LABELS: Record<string, string> = {
  bright: 'Luminoso',
  diffuse: 'Difuso',
  dim: 'Tenue',
  dark: 'Oscuro',
};

// ── Webcam Vision result badge ─────────────────────────────
function WebcamVisionBadge({ result }: { result: WebcamVisionResult }) {
  const color = beaufortToColor(result.beaufort);
  const ago = timeAgoEs(result.analyzedAt);
  const w = result.weather;
  const skyInfo = SKY_LABELS[w.sky] ?? SKY_LABELS.unknown;
  const visInfo = VIS_LABELS[w.visibility] ?? VIS_LABELS.good;

  return (
    <div className="mt-2 pt-2 border-t border-slate-700/40 text-[11px]">
      <div className="flex items-center gap-1.5 mb-1">
        <WeatherIcon id="camera" size={11} className="text-cyan-400" />
        <span className="text-slate-300 font-semibold">Visión IA</span>
        <span className="text-[11px] text-slate-600 ml-auto">{ago}</span>
      </div>

      {/* Weather description */}
      {w.weatherDescription && (
        <div className="text-slate-300 mb-1.5 leading-snug">
          {w.weatherDescription}
        </div>
      )}

      {/* Conditions grid */}
      <div className="grid grid-cols-3 gap-x-2 gap-y-0.5 text-[11px]">
        {/* Sky */}
        <div className="text-slate-500">Cielo</div>
        <div className="col-span-2"><span style={{ color: skyInfo.color }}>{skyInfo.label}</span>{w.cloudType ? ` · ${w.cloudType}` : ''}</div>

        {/* Wind/Beaufort */}
        {result.beaufort >= 0 && (
          <>
            <div className="text-slate-500">Viento</div>
            <div className="col-span-2">
              <span className="font-bold" style={{ color }}>B{result.beaufort}</span>
              <span className="text-slate-400"> {result.beaufortLabel} · ~{result.windEstimateKt}kt</span>
            </div>
          </>
        )}

        {/* Sea state */}
        {w.seaState && (
          <>
            <div className="text-slate-500">Mar</div>
            <div className="col-span-2 text-slate-400">{w.seaState}</div>
          </>
        )}

        {/* Visibility */}
        <div className="text-slate-500">Visib.</div>
        <div className="col-span-2" style={{ color: visInfo.color }}>{visInfo.label}</div>

        {/* Light */}
        {w.light && (
          <>
            <div className="text-slate-500">Luz</div>
            <div className="col-span-2 text-slate-400">{LIGHT_LABELS[w.light] ?? w.light}</div>
          </>
        )}

        {/* Alerts */}
        {w.precipitation && (
          <>
            <div className="text-slate-500">Precip.</div>
            <div className="col-span-2 text-amber-400">Lluvia visible</div>
          </>
        )}
        {w.fogVisible && (
          <>
            <div className="text-slate-500">Niebla</div>
            <div className="col-span-2 text-amber-400">Niebla/bruma</div>
          </>
        )}
      </div>

      <div className="text-[11px] text-slate-600 mt-1 flex items-center gap-1">
        <span className="opacity-60">🤖</span> {result.providerUsed} · {result.latencyMs}ms · {result.confidence}
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
        className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-300 transition-colors w-full text-left"
      >
        <WeatherIcon id="camera" size={11} className="text-slate-500 shrink-0" />
        <span className="font-semibold">Webcams</span>
        <span className="text-slate-500 text-[11px] ml-1">({webcams.length})</span>
        <span className="text-slate-500 text-[11px] ml-auto">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-2">
          {webcams.map((cam) => (
            <div key={cam.url} className="bg-slate-800/40 rounded px-2 py-1.5">
              <div className="flex items-center gap-1.5 text-[11px] mb-1">
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
                    <span className="text-[11px] text-slate-500">{cam.source}</span>
                    <button
                      onClick={() => setImgKey(Date.now())}
                      className="text-[11px] text-sky-400 hover:text-sky-300 transition-colors"
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
                  className="flex items-center gap-1.5 text-[11px] text-sky-400 hover:text-sky-300 transition-colors"
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

// ── Thermal forecast early warning (BETA) ─────────────────────

function ThermalForecastBadge({ forecast }: { forecast: HourlyForecast[] }) {
  const signals = useMemo(() => detectThermalForecast(forecast), [forecast]);
  if (signals.length === 0) return null;

  return (
    <div className="mb-2 space-y-1">
      {signals.map((s, i) => {
        const color = s.confidence === 'alta'
          ? 'text-green-400 bg-green-500/10'
          : s.confidence === 'media'
            ? 'text-blue-400 bg-blue-500/10'
            : 'text-slate-400 bg-slate-500/10';
        return (
          <div key={i} className={`text-[11px] ${color} rounded px-2 py-1`}>
            <WeatherIcon id="sun" size={11} className="inline -mt-px mr-1" />
            {s.label}
            <span className="text-[11px] opacity-60 ml-1">BETA</span>
          </div>
        );
      })}
    </div>
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
    <div className="text-[11px] mb-1.5 pt-1 border-t border-slate-700/40">
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

// ── Forecast mini-timeline (next 12h) ────────────────────────

function ForecastMiniTimeline({ forecast }: { forecast: HourlyForecast[] }) {
  const [open, setOpen] = useState(false);

  // Filter to next 12 hours from now, pick every 2h for compactness
  const hours = useMemo(() => {
    const now = new Date();
    const upcoming = forecast.filter((f) => f.time > now);
    const result: HourlyForecast[] = [];
    for (let i = 0; i < Math.min(12, upcoming.length); i += 2) {
      result.push(upcoming[i]);
    }
    return result; // max 6 slots
  }, [forecast]);

  if (hours.length === 0) return null;

  const fmt = (d: Date) => `${d.getHours()}h`;
  const msToKt = (ms: number) => Math.round(ms * 1.94384);

  return (
    <div className="mt-2 pt-1.5 border-t border-slate-700/40">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-300 transition-colors w-full text-left"
      >
        <WeatherIcon id="clock" size={11} className="text-cyan-500/70 shrink-0" />
        <span className="font-semibold">Prevision 12h</span>
        <span className="text-slate-500 text-[11px] ml-auto">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-1.5 flex gap-0.5 overflow-x-auto">
          {hours.map((h, i) => {
            const kt = msToKt(h.windSpeed);
            const precip = h.precipProbability > 30;
            return (
              <div
                key={i}
                className="flex flex-col items-center min-w-[38px] bg-slate-800/40 rounded px-1 py-1 text-[11px]"
              >
                <span className="text-slate-500 font-mono">{fmt(h.time)}</span>
                <span
                  className="font-bold text-[11px] mt-0.5"
                  style={{ color: windKtColor(kt) }}
                  title={`${kt} kt ${h.windDirection}°`}
                >
                  {kt}
                </span>
                <span
                  className="inline-block text-[11px] leading-none"
                  style={{ transform: `rotate(${(h.windDirection + 180) % 360}deg)` }}
                  title={`Dir: ${Math.round(h.windDirection)}°`}
                >↑</span>
                <span className="text-slate-400 text-[11px]">{h.temperature.toFixed(0)}°</span>
                {precip && (
                  <span className="text-sky-400 text-[11px]" title={`${h.precipProbability}% lluvia`}>
                    {h.precipProbability}%
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Color helpers ────────────────────────────────────────────
/** Wind speed color aligned with verdict thresholds and VERDICT_HEX colors.
 * Extends into violet→dark for extreme winds (30-45+ kt). */
function windKtColor(kt: number): string {
  if (kt < 6) return '#94a3b8';   // calm — slate
  if (kt < 8) return '#38bdf8';   // light — sky
  if (kt < 12) return '#fbbf24';  // sailing — amber
  if (kt < 18) return '#34d399';  // good — emerald
  if (kt < 25) return '#22d3ee';  // strong — cyan
  if (kt < 30) return '#f87171';  // danger — red
  if (kt < 40) return '#a855f7';  // extreme — violet
  if (kt < 50) return '#7c3aed';  // gale — dark violet
  return '#1e1b4b';               // storm — near-black indigo
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

// ── Share button — Web Share API with clipboard fallback ──────────

function ShareButton({ spot, score, verdict, vs }: {
  spot: SailingSpot;
  score?: SpotScore;
  verdict: SpotVerdict;
  vs: typeof VERDICT_STYLE[SpotVerdict];
}) {
  const [copied, setCopied] = useState(false);

  const shareText = useMemo(() => {
    const parts = [`${spot.name}: ${vs.label}`];
    if (score?.wind) {
      parts.push(`${score.wind.avgSpeedKt.toFixed(0)}kt ${score.wind.dominantDir}`);
    }
    if (score?.airTemp != null) {
      parts.push(`${score.airTemp.toFixed(0)}°C`);
    }
    if (score?.waves?.waveHeight != null) {
      parts.push(`olas ${score.waves.waveHeight.toFixed(1)}m`);
    }
    parts.push('— MeteoMapGal');
    return parts.join(' | ');
  }, [spot.name, vs.label, score]);

  const handleShare = async () => {
    const shareData = {
      title: `${spot.name} — MeteoMapGal`,
      text: shareText,
      url: 'https://meteomapgal.navia3d.com',
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {
        // User cancelled — not an error
      }
    } else {
      // Fallback: copy to clipboard
      try {
        await navigator.clipboard.writeText(`${shareText}\n${shareData.url}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Clipboard failed silently
      }
    }
  };

  return (
    <button
      onClick={handleShare}
      className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300 transition-colors rounded px-1.5 py-0.5 hover:bg-slate-800/60"
      title="Compartir condiciones"
    >
      <WeatherIcon id="navigation" size={10} />
      {copied ? 'Copiado' : 'Compartir'}
    </button>
  );
}
