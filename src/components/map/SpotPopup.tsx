/**
 * Popup for sailing spots — shows scoring summary on marker click.
 * Desktop: MapLibre native popup. Mobile: bottom sheet.
 *
 * Displays: verdict, wind consensus, wave conditions, water temp,
 * matched pattern, score, and summary text.
 * Themed per verdict color to match SpotMarker.
 */
import { memo, useState, useMemo, useEffect, useCallback } from 'react';
import { Popup } from 'react-map-gl/maplibre';
import { useSpotStore } from '../../store/spotStore';
import { useUIStore } from '../../store/uiStore';

import { useSwipeToDismiss } from '../../hooks/useSwipeToDismiss';
import { WeatherIcon } from '../icons/WeatherIcons';
import type { SpotScore, SpotVerdict } from '../../services/spotScoringEngine';
import type { SailingSpot, SpotWebcam, WindPattern } from '../../config/spots';
import type { SailingWindow, SpotWindowResult } from '../../services/sailingWindowService';
import type { ThermalPrecursorResult } from '../../services/thermalPrecursorService';
import type { WebcamVisionResult } from '../../services/webcamVisionService';
import type { HourlyForecast } from '../../types/forecast';
import { detectThermalForecast } from '../../services/thermalForecastDetector';
import { beaufortToColor } from '../../services/webcamVisionService';
import { temperatureColor, degreesToCardinal } from '../../services/windUtils';
import { fetchMarineForecast, type MarineForecastHour } from '../../api/marineClient';
import { fetchMeteoSixForecast, fetchMeteoSixSeaTemp } from '../../api/meteoSixClient';
import { useSectorStore } from '../../store/sectorStore';
import { computeSurfVerdict, swellAlignmentMultiplier, type SurfVerdictResult } from '../spot/surfVerdictEngine';
import { waveBarColor, windKtColor, waveColor, humidityColor, waterTColor, timeAgoEs, dirArrow, azimuthLabel } from '../spot/spotColors';
import { SpotTideSummary } from '../spot/SpotTideSummary';
import { SpotHistoryChart } from '../spot/SpotHistoryChart';
import { ScoringBreakdown, Cell } from '../spot/ScoringBreakdown';
import { WebcamSection } from '../spot/WebcamSection';
import { WindPatterns } from '../spot/WindPatterns';

// ── Verdict palette — matches windSpeedColor() for coherence ──
const VERDICT_STYLE: Record<SpotVerdict, { color: string; bg: string; label: string }> = {
  calm:    { color: '#94a3b8', bg: 'rgba(100,116,139,0.15)', label: 'CALMA' },
  light:   { color: '#38bdf8', bg: 'rgba(56,189,248,0.12)',  label: 'FLOJO' },
  sailing: { color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   label: 'NAVEGABLE' },
  good:    { color: '#eab308', bg: 'rgba(234,179,8,0.12)',   label: 'BUENO' },
  strong:  { color: '#f97316', bg: 'rgba(249,115,22,0.12)',  label: 'FUERTE' },
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
  const spotForecasts = useSpotStore((s) => s.spotForecasts);
  const setSpotForecast = useSpotStore((s) => s.setSpotForecast);
  const windowResult = sailingWindows.get(spot.id);

  // Spot-specific WRF 1km forecast — fetch on open, cache 30min
  const cached = spotForecasts.get(spot.id);
  const spotForecast = cached?.data ?? [];
  const [spotFcLoading, setSpotFcLoading] = useState(false);

  useEffect(() => {
    const stale = !cached || Date.now() - cached.fetchedAt > 30 * 60_000;
    if (!stale || spotFcLoading) return;
    setSpotFcLoading(true);
    const [lon, lat] = spot.center;
    fetchMeteoSixForecast(lat, lon)
      .then((data) => setSpotForecast(spot.id, data))
      .catch((err) => console.warn(`[SpotForecast] ${spot.id}:`, err))
      .finally(() => setSpotFcLoading(false));
  }, [spot.id, spot.center, cached, spotFcLoading, setSpotForecast]);
  // MOHID sea temp (Rías only — fetch alongside spot forecast)
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const [mohidSeaTemp, setMohidSeaTemp] = useState<number | null>(null);

  useEffect(() => {
    if (sectorId !== 'rias') return;
    const [lon, lat] = spot.center;
    fetchMeteoSixSeaTemp(lat, lon)
      .then((data) => {
        // Find current hour's sea temp
        const now = Date.now();
        const closest = data.reduce<{ time: Date; seaTemp: number | null } | null>((best, d) => {
          if (d.seaTemp == null) return best;
          if (!best) return d;
          return Math.abs(d.time.getTime() - now) < Math.abs(best.time.getTime() - now) ? d : best;
        }, null);
        setMohidSeaTemp(closest?.seaTemp ?? null);
      })
      .catch(() => {});
  }, [spot.id, spot.center, sectorId]);

  const precursor = spot.thermalDetection ? thermalPrecursors.get(spot.id) : undefined;
  const visionResult = webcamVision.get(spot.id);

  const verdict: SpotVerdict = score?.verdict ?? 'unknown';
  const vs = VERDICT_STYLE[verdict];

  // ── Surf verdict: wave-based, overrides wind verdict for surf spots ──
  const [marineForecast, setMarineForecast] = useState<MarineForecastHour[]>([]);
  useEffect(() => {
    if (spot.category !== 'surf') return;
    let cancelled = false;
    fetchMarineForecast(spot.center[1], spot.center[0]).then((data) => {
      if (!cancelled) {
        setMarineForecast(data);
        // Write current wave data to store so SpotMarker can read it
        const now = data[0];
        if (now) {
          const wh = now.swellHeight ?? now.waveHeight ?? 0;
          useSpotStore.getState().setSurfWave(spot.id, {
            waveHeight: wh,
            swellHeight: now.swellHeight,
            period: now.swellPeriod ?? now.wavePeriod ?? 0,
          });
        }
      }
    });
    return () => { cancelled = true; };
  }, [spot.id, spot.category, spot.center]);

  const surfInfo = useMemo(() => {
    if (spot.category !== 'surf' || marineForecast.length === 0) return null;
    const now = marineForecast[0];
    if (!now) return null;
    // Per-spot coastal correction × swell direction alignment
    const baseFactor = spot.coastalFactor ?? 0.85;
    const swellDir = now.swellDirection ?? now.waveDirection ?? null;
    const alignment = swellDir != null && spot.beachOrientation != null
      ? swellAlignmentMultiplier(swellDir, spot.beachOrientation)
      : 1.0; // no swell direction data → use base factor only
    const factor = baseFactor * alignment;
    const rawWh = now.swellHeight ?? now.waveHeight ?? 0;
    const wh = rawWh * factor;
    const tp = now.swellPeriod ?? now.wavePeriod ?? 0;
    const windDir = score?.wind?.dirDeg ?? null;
    const isOffshore = windDir != null && spot.offshoreWindDir
      ? spot.offshoreWindDir.some((d) => Math.abs(((windDir - d + 540) % 360) - 180) < 45)
      : false;
    const isOnshore = windDir != null && spot.beachOrientation != null
      ? Math.abs(((windDir - spot.beachOrientation + 540) % 360) - 180) < 50
      : false;
    // Swell direction alignment check for period bonus
    const swellAligned = swellDir != null && spot.swellDirections
      ? spot.swellDirections.some((d) => Math.abs(((swellDir - d + 540) % 360) - 180) < 45)
      : true; // no swell data → assume aligned (conservative)
    return computeSurfVerdict(wh, tp, isOffshore, isOnshore, swellAligned);
  }, [marineForecast, score?.wind?.dirDeg, spot]);

  // Write surf verdict to store so SpotMarker reads the FINAL verdict (with all modifiers)
  useEffect(() => {
    if (!surfInfo || spot.category !== 'surf') return;
    const cache = useSpotStore.getState().surfWaveCache.get(spot.id);
    if (cache && (cache.verdictLabel !== surfInfo.label || cache.verdictColor !== surfInfo.color)) {
      useSpotStore.getState().setSurfWave(spot.id, { ...cache, verdictLabel: surfInfo.label, verdictColor: surfInfo.color });
    }
  }, [surfInfo, spot.id, spot.category]);

  // Use surf verdict for display if available, otherwise fall back to wind verdict
  const displayVerdict = surfInfo ?? { label: vs.label, color: vs.color, bg: vs.bg, summary: '' };

  const popupContent = (
    <div className={`break-words ${isMobile ? 'min-w-[240px] max-w-[320px]' : 'min-w-[260px] max-w-[350px] max-h-[70vh] overflow-y-auto overflow-x-hidden'}`}>
      {/* ── Header ── */}
      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-700/60">
        <div
          className={`${isMobile ? 'w-10 h-10' : 'w-8 h-8'} rounded-full flex items-center justify-center shrink-0`}
          style={{ background: displayVerdict.bg, border: `2px solid ${displayVerdict.color}` }}
        >
          <WeatherIcon id={spot.icon} size={isMobile ? 20 : 16} className="text-slate-200" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-1.5 flex-wrap">
            <span className={`${isMobile ? 'text-base' : 'text-sm'} font-bold text-slate-100 leading-tight`}>{spot.name}</span>
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
            <span className={`text-[11px] font-bold tracking-wider ${
              spot.category === 'surf'
                ? 'text-cyan-300 bg-cyan-500/20 border-cyan-500/30'
                : 'text-amber-300 bg-amber-500/20 border-amber-500/30'
            } px-1.5 py-0.5 rounded-full border shrink-0 leading-none`}>
              {spot.category === 'surf' ? 'SURF BETA' : 'BETA'}
            </span>
          </div>
          <div className="text-[12px] text-slate-300 break-words">{spot.description}</div>
        </div>
      </div>

      {/* ── Surf conditions reference (surf spots only) ── */}
      {spot.category === 'surf' && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] mb-2 p-1.5 rounded bg-cyan-950/30 border border-cyan-800/30">
          {spot.beachOrientation != null && (
            <div><span className="text-slate-500">Playa</span> <span className="text-cyan-300 font-bold">{degreesToCardinal(spot.beachOrientation)}</span></div>
          )}
          {spot.tidePreference && (
            <div><span className="text-slate-500">Marea</span> <span className="text-cyan-300 font-bold">{
              spot.tidePreference === 'all' ? 'Todas' :
              spot.tidePreference === 'mid-high' ? 'Media-alta' :
              spot.tidePreference === 'mid' ? 'Media' :
              spot.tidePreference === 'low' ? 'Baja' : 'Alta'
            }</span></div>
          )}
          {spot.offshoreWindDir && (
            <div><span className="text-slate-500">Offshore</span> <span className="text-cyan-300 font-bold">{spot.offshoreWindDir.map(d => degreesToCardinal(d)).join('/')}</span></div>
          )}
          {spot.swellDirections && (
            <div><span className="text-slate-500">Swell</span> <span className="text-cyan-300 font-bold">{spot.swellDirections.map(d => degreesToCardinal(d)).join('/')}</span></div>
          )}
        </div>
      )}

      {/* ── Tide warning for surf spots — before verdict since it affects session quality ── */}
      {spot.category === 'surf' && spot.tideStationId && (
        <SpotTideSummary tideStationId={spot.tideStationId} tidePreference={spot.tidePreference} />
      )}

      {/* ── Verdict badge — surf uses wave-based verdict, sailing uses wind ── */}
      <div className="flex items-center gap-2 mb-2">
        <span
          className="px-2.5 py-1 rounded-full text-[13px] font-extrabold tracking-wide"
          style={{ background: displayVerdict.bg, color: displayVerdict.color, border: `1px solid ${displayVerdict.color}40` }}
        >
          {displayVerdict.label}
        </span>
        {spot.category !== 'surf' && score && (
          <span className="text-xs text-slate-400 font-mono">
            {score.score}/100
          </span>
        )}
      </div>
      {/* Surf verdict summary — plain language */}
      {displayVerdict.summary && (
        <div className="text-[11px] text-slate-300 mb-2 leading-tight break-words" style={{ color: displayVerdict.color }}>
          {displayVerdict.summary}
        </div>
      )}

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

      {/* ── Wave conditions (coastal spots — NOT surf, which uses marine forecast) ── */}
      {spot.category !== 'surf' && score?.waves && score.waves.waveHeight != null && spot.waveRelevance !== 'none' && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs mb-2 pt-1 border-t border-slate-700/40">
          <Cell label="Oleaje" value={`${score.waves.waveHeight.toFixed(1)} m`} color={waveColor(score.waves.waveHeight)} />
          {score.waves.wavePeriod != null && (
            <Cell label="Período" value={`${score.waves.wavePeriod.toFixed(0)} s`} />
          )}
        </div>
      )}

      {/* ── 24h Wave forecast (surf spots only) ── */}
      {spot.category === 'surf' && (
        <WaveForecastMini lat={spot.center[1]} lon={spot.center[0]} />
      )}

      {/* ── Temperatures & conditions — primary always visible, secondary collapsible ── */}
      {(score?.airTemp != null || score?.waterTemp != null || mohidSeaTemp != null || score?.humidity != null) && (
        <TemperatureSection score={score} mohidSeaTemp={score?.waterTemp == null ? mohidSeaTemp : null} />
      )}

      {/* ── Humidity precursor signal (bruma pattern) ── */}
      {score?.humiditySignal && (
        <div className="text-[11px] text-sky-400 bg-sky-500/10 rounded px-2 py-1 mb-2">
          {score.humiditySignal}
        </div>
      )}

      {/* ── Thermal forecast early warning (BETA) — uses spot-specific WRF 1km ── */}
      {spot.thermalDetection && spotForecast.length > 0 && (
        <ThermalForecastBadge forecast={spotForecast} />
      )}

      {/* ── Tide summary (Rías sailing spots — surf spots show tide above verdict) ── */}
      {spot.tideStationId && spot.category !== 'surf' && <SpotTideSummary tideStationId={spot.tideStationId} />}

      {/* ── Thermal context (if applicable) ── */}
      {score?.thermal && score.thermal.thermalProbability > 0 && (
        <div className="text-[11px] text-blue-300/70 mb-1">
          <WeatherIcon id="sun" size={12} className="inline -mt-px" /> Térmica {score.thermal.thermalProbability}% prob
          {score.thermal.windWindow && ` · ${score.thermal.windWindow.startHour}h–${score.thermal.windWindow.endHour}h`}
        </div>
      )}

      {/* Thermal boost indicator removed — redundant with "Térmica X% prob" already shown above */}

      {/* ── Scoring confidence ── */}
      {score && score.scoringConfidence === 'low' && (
        <div className="text-[11px] text-amber-400/90 italic mb-1">
          <WeatherIcon id="alert-triangle" size={11} className="inline -mt-px" /> Baja confianza: solo {score.wind?.stationCount ?? 0} fuente(s) de viento cercana(s)
        </div>
      )}

      {/* ── Summary (wind-based — hide for surf spots which have their own wave summary) ── */}
      {spot.category !== 'surf' && score?.summary && (
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

      {/* ── Scoring breakdown (collapsible) — wind-based, hide for surf ── */}
      {spot.category !== 'surf' && score && score.verdict !== 'unknown' && <ScoringBreakdown score={score} spot={spot} />}

      {/* ── Sailing windows (collapsible) — hide for surf spots ── */}
      {spot.category !== 'surf' && windowResult && <SailingWindowsSection result={windowResult} />}

      {/* ── Forecast mini-timeline (12h) — per-spot WRF 1km, hide for surf ── */}
      {spot.category !== 'surf' && spotForecast.length > 0 && <ForecastMiniTimeline forecast={spotForecast} />}
      {spot.category !== 'surf' && spotFcLoading && spotForecast.length === 0 && (
        <div className="text-[11px] text-slate-500 mt-1">Cargando prevision WRF 1km...</div>
      )}

      {/* ── Thermal precursor early warning (collapsible) ── */}
      {precursor && precursor.level !== 'none' && <ThermalPrecursorSection precursor={precursor} />}

      {/* ── Webcam Vision — weather analysis from LLM ── */}
      {visionResult && (visionResult.beaufort >= 0 || visionResult.weather.weatherDescription) && (
        <WebcamVisionBadge result={visionResult} />
      )}

      {/* ── Webcams (collapsible) ── */}
      {spot.webcams && spot.webcams.length > 0 && <WebcamSection webcams={spot.webcams} />}

      {/* ── Spot wind history 24h (wind spots only — surf uses wave forecast) ── */}
      {spot.category !== 'surf' && <SpotHistoryChart spotId={spot.id} />}

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
      maxWidth="380px"
    >
      {popupContent}
    </Popup>
  );
});

// ── Helper: data cell ────────────────────────────────────────
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

// WindPatterns extracted to ../spot/WindPatterns.tsx
// WebcamSection extracted to ../spot/WebcamSection.tsx

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

      {/* Conditions grid — description from LLM omitted (English, not useful for user) */}
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

      <div className="text-[10px] text-slate-600 mt-1">
        Confianza: {result.confidence === 'high' ? 'alta' : result.confidence === 'medium' ? 'media' : 'baja'}
      </div>
    </div>
  );
}

// WebcamSection moved to ../spot/WebcamSection.tsx

// ── Wind trend + sparkline for spots ─────────────────────────

const SPARK_W = 80;
const SPARK_H = 24;

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
    <div className="flex items-center gap-1.5 ml-0.5">
      <svg width={SPARK_W} height={SPARK_H} className="flex-shrink-0 opacity-70" aria-label="Viento últimas 2h">
        <path fill="none" stroke="#38bdf8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d={path} />
      </svg>
      <span className="text-[9px] text-slate-500">2h</span>
    </div>
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
          <div key={i} className={`text-[11px] ${color} rounded px-2 py-1 break-words`}>
            <WeatherIcon id="sun" size={11} className="inline -mt-px mr-1" />
            {s.label}<span className="text-[10px] opacity-60 ml-0.5">BETA</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Spot tide summary ─────────────────────────────────────────

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
        <>
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
        <button
          onClick={() => {
            useUIStore.getState().setForecastPanelOpen(true, spot.id);
          }}
          className="mt-1.5 w-full text-center text-[11px] text-sky-400 hover:text-sky-300 transition-colors py-1 rounded bg-sky-500/10 hover:bg-sky-500/15 font-medium"
        >
          Ver prevision detallada 48h
        </button>
        </>
      )}
    </div>
  );
}

// ── 24h Wave Forecast Mini ───────────────────────────────────

/** Compact 24h wave forecast bar chart for surf spots.
 * Fetches Open-Meteo Marine hourly and shows wave height + swell + period. */
function WaveForecastMini({ lat, lon }: { lat: number; lon: number }) {
  const [hours, setHours] = useState<MarineForecastHour[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMarineForecast(lat, lon).then((data) => {
      if (!cancelled) {
        setHours(data);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [lat, lon]);

  if (loading) {
    return (
      <div className="text-[10px] text-slate-500 py-1 mb-2 border-t border-slate-700/40 pt-1.5">
        Cargando prevision olas...
      </div>
    );
  }

  if (hours.length < 6) return null;

  const maxWave = Math.max(...hours.map((h) => h.waveHeight ?? 0), 0.5);
  const now = new Date();

  // Find best window: highest swell with good period
  let bestIdx = 0;
  let bestScore = 0;
  for (let i = 0; i < hours.length; i++) {
    const h = hours[i];
    const s = (h.swellHeight ?? h.waveHeight ?? 0) * (h.swellPeriod ?? h.wavePeriod ?? 5) / 5;
    if (s > bestScore) { bestScore = s; bestIdx = i; }
  }

  // Summary text
  const currentWave = hours[0]?.waveHeight ?? 0;
  const maxForecast = Math.max(...hours.map((h) => h.waveHeight ?? 0));
  const trend = maxForecast > currentWave + 0.3 ? 'subiendo' : maxForecast < currentWave - 0.3 ? 'bajando' : 'estable';
  const bestHour = hours[bestIdx];
  const bestTime = bestHour?.time.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const avgPeriod = hours.reduce((sum, h) => sum + (h.swellPeriod ?? h.wavePeriod ?? 0), 0) / hours.length;
  const periodQuality = avgPeriod >= 10 ? 'largo (buena calidad)' : avgPeriod >= 7 ? 'medio' : 'corto (mar de viento)';

  return (
    <div className="mb-2 pt-1.5 border-t border-slate-700/40">
      <div className="flex items-center gap-1 mb-1">
        <WeatherIcon id="waves" size={11} className="text-cyan-400" />
        <span className="text-[11px] font-bold text-cyan-300">Olas 24h</span>
        <span className="text-[10px] text-slate-500 ml-auto">Periodo {periodQuality}</span>
      </div>

      {/* Bar chart — total wave height bars + swell line overlay */}
      <div className="flex items-end gap-px h-8 mb-1 relative" title="Altura de ola por hora">
        {hours.map((h, i) => {
          const wh = h.waveHeight ?? 0;
          const sw = h.swellHeight ?? 0;
          const pct = Math.max(4, (wh / maxWave) * 100);
          const swPct = maxWave > 0 ? Math.max(0, (sw / maxWave) * 100) : 0;
          const isBest = i === bestIdx;
          const hourLabel = h.time.getHours();
          const isPast = h.time < now;
          return (
            <div
              key={i}
              className="flex-1 rounded-t-sm relative"
              style={{
                height: `${pct}%`,
                backgroundColor: isPast ? 'rgba(100,116,139,0.3)' : waveBarColor(wh),
                opacity: isPast ? 0.5 : 1,
                border: isBest ? '1px solid #22d3ee' : 'none',
              }}
              title={`${hourLabel}h: ${wh.toFixed(1)}m total${sw > 0 ? ` (swell ${sw.toFixed(1)}m)` : ''}${h.swellPeriod ? ` Tp ${h.swellPeriod.toFixed(0)}s` : ''}`}
            >
              {/* Swell portion indicator — darker bottom section */}
              {sw > 0 && sw < wh && !isPast && (
                <div
                  className="absolute bottom-0 left-0 right-0 rounded-t-sm"
                  style={{ height: `${Math.min(100, swPct / pct * 100)}%`, backgroundColor: 'rgba(14,165,233,0.4)' }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Time labels (every 6h) */}
      <div className="flex justify-between text-[9px] text-slate-600 mb-1">
        {hours.filter((_, i) => i % 6 === 0).map((h, i) => (
          <span key={i}>{h.time.getHours()}h</span>
        ))}
      </div>

      {/* Period indicator at key hours */}
      <div className="flex justify-between text-[8px] text-slate-600 mb-1">
        {hours.filter((_, i) => i % 6 === 0).map((h, i) => {
          const tp = h.swellPeriod ?? h.wavePeriod ?? 0;
          return tp > 0 ? <span key={i} style={{ color: tp >= 10 ? '#22d3ee' : tp >= 7 ? '#94a3b8' : '#f97316' }}>{tp.toFixed(0)}s</span> : <span key={i} />;
        })}
      </div>

      {/* Summary line */}
      <div className="text-[10px] text-slate-400 leading-tight">
        Olas {trend}: {currentWave.toFixed(1)}m ahora {'\u2192'} max {maxForecast.toFixed(1)}m a las {bestTime}
      </div>
    </div>
  );
}

// ── Temperature section — primary visible, secondary collapsible ──

function TemperatureSection({ score, mohidSeaTemp }: { score: SpotScore; mohidSeaTemp?: number | null }) {
  const [showMore, setShowMore] = useState(false);
  const hasSecondary = score.dewPoint != null || score.windChill != null || score.heatIndex != null;
  const waterTemp = score.waterTemp ?? mohidSeaTemp;

  return (
    <div className="mb-2 pt-1 border-t border-slate-700/40">
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {score.airTemp != null && (
          <Cell label="Aire" value={`${score.airTemp.toFixed(1)}°C`} color={temperatureColor(score.airTemp)} />
        )}
        {waterTemp != null && (
          <Cell
            label={score.waterTemp != null ? 'Agua' : 'Agua (MOHID)'}
            value={`${waterTemp.toFixed(1)}°C`}
            color={waterTColor(waterTemp)}
          />
        )}
        {score.humidity != null && (
          <Cell label="Humedad" value={`${score.humidity.toFixed(0)}%`} color={humidityColor(score.humidity)} />
        )}
      </div>
      {hasSecondary && (
        <>
          <button
            onClick={() => setShowMore((o) => !o)}
            className="text-[10px] text-slate-500 hover:text-slate-400 mt-1 transition-colors"
          >
            {showMore ? 'Menos datos ▲' : 'Más datos ▼'}
          </button>
          {showMore && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs mt-1">
              {score.dewPoint != null && <Cell label="Punto rocío" value={`${score.dewPoint.toFixed(1)}°C`} />}
              {score.windChill != null && <Cell label="Sensación térmica" value={`${score.windChill.toFixed(1)}°C`} color={temperatureColor(score.windChill)} />}
              {score.heatIndex != null && <Cell label="Índice calor" value={`${score.heatIndex.toFixed(1)}°C`} color={score.heatIndex > 35 ? '#ef4444' : score.heatIndex > 32 ? '#fb923c' : '#facc15'} />}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Spot History 24h — inline chart from ingestor spot_scores (wind spots only) ──

// SpotHistoryChart + SpotWindChart extracted to ../spot/SpotHistoryChart.tsx

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
