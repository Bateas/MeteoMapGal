import { useMemo, useState } from 'react';
import { useForecastStore } from '../../hooks/useForecastTimeline';
import { useThermalStore } from '../../store/thermalStore';
import { msToKnots, degreesToCardinal, windSpeedColor, isDirectionInRange, angleDifference } from '../../services/windUtils';
import { getSunTimes, formatTime } from '../../services/solarUtils';
import { scoreForecastThermal, thermalColor, thermalBg } from '../../services/forecastScoringUtils';
import type { ThermalScore, ForecastBreakdown } from '../../services/forecastScoringUtils';
import { ForecastTable } from './ForecastTable';
import { WeatherIcon } from '../icons/WeatherIcons';
import type { IconId } from '../icons/WeatherIcons';
import type { HourlyForecast } from '../../types/forecast';
import type { ThermalWindRule } from '../../types/thermal';

// ── Time range selector ──────────────────────────────────
const RANGES = [
  { label: '12h', hours: 12 },
  { label: '24h', hours: 24 },
  { label: '48h', hours: 48 },
] as const;

// ── Wind speed bar max (kt) ──────────────────────────────
const MAX_WIND_KT = 25;

// ── Helpers ──────────────────────────────────────────────

function formatHour(d: Date): string {
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDay(d: Date): string {
  return d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' });
}

function cloudIcon(cover: number | null): IconId | '' {
  if (cover === null) return '';
  if (cover < 15) return 'sun';
  if (cover < 40) return 'cloud-sun';
  if (cover < 70) return 'cloud-sun';
  if (cover < 90) return 'cloud';
  return 'cloud';
}

/** Small inline SVG arrow pointing wind direction (meteorological "to") */
function WindArrow({ dir, size = 14 }: { dir: number | null; size?: number }) {
  if (dir === null) return <span className="text-slate-600">—</span>;
  const rotation = (dir + 180) % 360; // "from" → "to"
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className="inline-block"
      style={{ transform: `rotate(${rotation}deg)` }}
    >
      <path d="M8 2 L12 10 L8 8 L4 10 Z" fill="currentColor" />
    </svg>
  );
}

/** Build a readable tooltip string from thermal score breakdown */
function buildBreakdownTooltip(ts: ThermalScore): string {
  if (!ts.breakdown || ts.score < 20) return ts.mainRule ?? 'Sin señal térmica';
  const b = ts.breakdown;
  const lines: string[] = [];
  if (ts.mainRule) lines.push(ts.mainRule);
  lines.push(`Temp ${b.temperature}/25 · Hora ${b.timeOfDay}/20 · Mes ${b.season}/15`);
  lines.push(`HR ${b.humidity}/10 · Dir ${b.windDirection}/15 · Viento ${b.windSpeed}/15`);
  lines.push(`Base: ${b.baseTotal}`);
  if (b.multipliers.length > 0) {
    lines.push(b.multipliers.map((m) => `${m.label} ×${m.factor.toFixed(2)}`).join(' · '));
  }
  lines.push(`→ Final: ${ts.score}`);
  return lines.join('\n');
}

// Thermal scoring imported from forecastScoringUtils.ts

// ── Forecast row ──────────────────────────────────────────

function ForecastRow({
  point,
  showDate,
  thermalScore,
}: {
  point: HourlyForecast;
  showDate: boolean;
  thermalScore: ThermalScore;
}) {
  const kt = point.windSpeed !== null ? msToKnots(point.windSpeed) : null;
  const barWidth = kt !== null ? Math.min((kt / MAX_WIND_KT) * 100, 100) : 0;
  const barColor = point.windSpeed !== null ? windSpeedColor(point.windSpeed) : '#475569';
  const cardinal = point.windDirection !== null ? degreesToCardinal(point.windDirection) : '';
  const precip = point.precipitation ?? 0;
  const precipProb = point.precipProbability ?? 0;

  return (
    <div
      className={`grid grid-cols-[52px_28px_1fr_42px_36px_36px_24px_28px] gap-1 items-center px-2 py-[3px] text-xs
        ${!point.isDay ? 'bg-slate-800/40' : ''}
        ${showDate ? 'border-t border-slate-600' : 'border-t border-slate-800/50'}
        hover:bg-slate-700/30 transition-colors`}
      style={{ background: thermalScore.score >= 20 ? thermalBg(thermalScore.score) : undefined }}
    >
      {/* Time */}
      <div className="text-slate-400 tabular-nums">
        {showDate && (
          <span className="text-slate-500 text-[10px] block leading-tight">
            {formatDay(point.time)}
          </span>
        )}
        {formatHour(point.time)}
      </div>

      {/* Wind arrow + cardinal */}
      <div className="flex items-center gap-0.5 text-slate-300" title={`${cardinal} ${point.windDirection ?? '—'}°`}>
        <WindArrow dir={point.windDirection} />
      </div>

      {/* Wind speed bar */}
      <div className="relative h-4 bg-slate-800 rounded overflow-hidden">
        <div
          className="absolute top-0 left-0 h-full rounded"
          style={{ width: `${barWidth}%`, backgroundColor: barColor }}
        />
        {kt !== null && kt >= 1 && (
          <span className="absolute inset-0 flex items-center px-1.5 text-[10px] font-semibold text-white drop-shadow-sm">
            {kt.toFixed(0)} kt
          </span>
        )}
      </div>

      {/* Temperature */}
      <div className="text-right tabular-nums">
        {point.temperature !== null ? (
          <span className={point.temperature >= 30 ? 'text-orange-400' : point.temperature <= 5 ? 'text-cyan-400' : 'text-slate-200'}>
            {point.temperature.toFixed(0)}°
          </span>
        ) : '—'}
      </div>

      {/* Humidity */}
      <div className="text-right tabular-nums text-slate-400">
        {point.humidity !== null ? `${point.humidity.toFixed(0)}%` : '—'}
      </div>

      {/* Precipitation */}
      <div className="text-right tabular-nums">
        {precip > 0.1 ? (
          <span className="text-sky-400">{precip.toFixed(1)}</span>
        ) : precipProb > 30 ? (
          <span className="text-sky-700 text-[10px]">{precipProb}%</span>
        ) : (
          <span className="text-slate-700">·</span>
        )}
      </div>

      {/* Cloud icon */}
      <div className="text-center text-[11px]" title={`Nubes: ${point.cloudCover ?? '—'}%`}>
        {cloudIcon(point.cloudCover) && <WeatherIcon id={cloudIcon(point.cloudCover) as IconId} size={14} />}
      </div>

      {/* Thermal score indicator — hover shows full breakdown */}
      <div
        className="text-center cursor-default"
        title={buildBreakdownTooltip(thermalScore)}
      >
        {thermalScore.score >= 20 ? (
          <span
            className={`text-[10px] font-bold tabular-nums ${
              thermalScore.isNavigable ? 'animate-pulse' : ''
            }`}
            style={{ color: thermalColor(thermalScore.score) }}
          >
            {thermalScore.score}
          </span>
        ) : (
          <span className="text-slate-700">·</span>
        )}
      </div>
    </div>
  );
}

// ── Thermal window detection ─────────────────────────────

interface ThermalWindow {
  startTime: Date;
  endTime: Date;
  peakScore: number;
  peakTime: Date;
  avgScore: number;
  ruleName: string | null;
}

function findThermalWindows(
  data: HourlyForecast[],
  rules: ThermalWindRule[],
  deltaT: number | null,
): ThermalWindow[] {
  const windows: ThermalWindow[] = [];
  let currentWindow: {
    start: Date;
    end: Date;
    scores: number[];
    peakScore: number;
    peakTime: Date;
    ruleName: string | null;
  } | null = null;

  const future = data.filter((p) => p.time.getTime() > Date.now());

  for (const point of future) {
    const ts = scoreForecastThermal(point, rules, deltaT);

    if (ts.score >= 35) {
      if (!currentWindow) {
        currentWindow = {
          start: point.time,
          end: point.time,
          scores: [ts.score],
          peakScore: ts.score,
          peakTime: point.time,
          ruleName: ts.mainRule,
        };
      } else {
        currentWindow.end = point.time;
        currentWindow.scores.push(ts.score);
        if (ts.score > currentWindow.peakScore) {
          currentWindow.peakScore = ts.score;
          currentWindow.peakTime = point.time;
          currentWindow.ruleName = ts.mainRule;
        }
      }
    } else if (currentWindow) {
      if (currentWindow.scores.length >= 2) {
        windows.push({
          startTime: currentWindow.start,
          endTime: currentWindow.end,
          peakScore: currentWindow.peakScore,
          peakTime: currentWindow.peakTime,
          avgScore: Math.round(currentWindow.scores.reduce((a, b) => a + b, 0) / currentWindow.scores.length),
          ruleName: currentWindow.ruleName,
        });
      }
      currentWindow = null;
    }
  }

  if (currentWindow && currentWindow.scores.length >= 2) {
    windows.push({
      startTime: currentWindow.start,
      endTime: currentWindow.end,
      peakScore: currentWindow.peakScore,
      peakTime: currentWindow.peakTime,
      avgScore: Math.round(currentWindow.scores.reduce((a, b) => a + b, 0) / currentWindow.scores.length),
      ruleName: currentWindow.ruleName,
    });
  }

  return windows;
}

// ── Day diagnosis analysis ───────────────────────────────

interface DayDiagnosis {
  // Pressure
  pressureTrend: 'rising' | 'falling' | 'stable';
  pressureChange: number; // hPa over next 6h
  currentPressure: number | null;
  // Solar
  peakRadiation: number | null;
  peakRadiationTime: Date | null;
  // CAPE
  maxCape: number | null;
  maxCapeTime: Date | null;
  // Humidity
  minHumidity: number | null;
  minHumidityTime: Date | null;
  // Wind consistency
  directionConsistency: number; // 0-100% (how stable is wind direction)
  // Sailing windows
  sailingWindows: { start: Date; end: Date; avgKt: number; quality: string }[];
  // Rain alert
  rainAlert: { start: Date; end: Date; totalMm: number } | null;
  // Historical pattern match
  patternMatch: string;
  patternScore: number; // 0-100
}

function analyzeDayDiagnosis(
  data: HourlyForecast[],
  deltaT: number | null,
): DayDiagnosis {
  const now = new Date();
  const future = data.filter((p) => p.time.getTime() > now.getTime());
  const next6h = future.filter((p) => p.time.getTime() <= now.getTime() + 6 * 3600000);
  const daylight = future.filter((p) => p.isDay);

  // ── Pressure trend ──
  let pressureTrend: 'rising' | 'falling' | 'stable' = 'stable';
  let pressureChange = 0;
  let currentPressure: number | null = null;
  if (next6h.length >= 2) {
    const pressures = next6h.filter((p) => p.pressure != null);
    if (pressures.length >= 2) {
      currentPressure = pressures[0].pressure;
      const last = pressures[pressures.length - 1].pressure!;
      const first = pressures[0].pressure!;
      pressureChange = last - first;
      if (pressureChange > 1.5) pressureTrend = 'rising';
      else if (pressureChange < -1.5) pressureTrend = 'falling';
    }
  }

  // ── Solar radiation peak ──
  let peakRadiation: number | null = null;
  let peakRadiationTime: Date | null = null;
  for (const p of daylight) {
    if (p.solarRadiation != null && (peakRadiation === null || p.solarRadiation > peakRadiation)) {
      peakRadiation = p.solarRadiation;
      peakRadiationTime = p.time;
    }
  }

  // ── CAPE max ──
  let maxCape: number | null = null;
  let maxCapeTime: Date | null = null;
  for (const p of future) {
    if (p.cape != null && (maxCape === null || p.cape > maxCape)) {
      maxCape = p.cape;
      maxCapeTime = p.time;
    }
  }

  // ── Min humidity ──
  let minHumidity: number | null = null;
  let minHumidityTime: Date | null = null;
  for (const p of daylight) {
    if (p.humidity != null && (minHumidity === null || p.humidity < minHumidity)) {
      minHumidity = p.humidity;
      minHumidityTime = p.time;
    }
  }

  // ── Direction consistency (afternoon) ──
  const afternoon = daylight.filter((p) => p.time.getHours() >= 13 && p.time.getHours() <= 20);
  let directionConsistency = 0;
  if (afternoon.length >= 3) {
    const dirs = afternoon.filter((p) => p.windDirection != null).map((p) => p.windDirection!);
    if (dirs.length >= 2) {
      let totalDiff = 0;
      for (let i = 1; i < dirs.length; i++) {
        totalDiff += angleDifference(dirs[i], dirs[i - 1]);
      }
      const avgDiff = totalDiff / (dirs.length - 1);
      directionConsistency = Math.max(0, Math.min(100, Math.round(100 - avgDiff * 2)));
    }
  }

  // ── Sailing windows (5-15 kt, low precip, reasonable gusts) ──
  const sailingWindows: DayDiagnosis['sailingWindows']= [];
  let currentSW: { start: Date; end: Date; speeds: number[] } | null = null;

  for (const p of future) {
    const kt = p.windSpeed != null ? msToKnots(p.windSpeed) : 0;
    const precip = p.precipitation ?? 0;
    const isSailable = kt >= 4 && kt <= 25 && precip < 1;

    if (isSailable) {
      if (!currentSW) {
        currentSW = { start: p.time, end: p.time, speeds: [kt] };
      } else {
        currentSW.end = p.time;
        currentSW.speeds.push(kt);
      }
    } else if (currentSW) {
      if (currentSW.speeds.length >= 2) {
        const avg = currentSW.speeds.reduce((a, b) => a + b, 0) / currentSW.speeds.length;
        sailingWindows.push({
          start: currentSW.start,
          end: currentSW.end,
          avgKt: avg,
          quality: avg >= 10 ? 'bueno' : avg >= 6 ? 'moderado' : 'ligero',
        });
      }
      currentSW = null;
    }
  }
  if (currentSW && currentSW.speeds.length >= 2) {
    const avg = currentSW.speeds.reduce((a, b) => a + b, 0) / currentSW.speeds.length;
    sailingWindows.push({
      start: currentSW.start, end: currentSW.end, avgKt: avg,
      quality: avg >= 10 ? 'bueno' : avg >= 6 ? 'moderado' : 'ligero',
    });
  }

  // ── Rain alert ──
  // Detect periods of significant rain in next 12h
  let rainAlert: DayDiagnosis['rainAlert'] = null;
  const next12h = future.filter((p) => p.time.getTime() <= now.getTime() + 12 * 3600000);
  const rainHours = next12h.filter((p) => (p.precipitation ?? 0) >= 0.5);
  if (rainHours.length >= 2) {
    const totalMm = rainHours.reduce((sum, p) => sum + (p.precipitation ?? 0), 0);
    rainAlert = {
      start: rainHours[0].time,
      end: rainHours[rainHours.length - 1].time,
      totalMm,
    };
  }

  // ── Historical pattern match ──
  // Compare today's profile to AEMET historical thermal days:
  // Best: Tmax>30, HR<65%, ΔT>20, August, SW wind
  let patternScore = 0;
  let patternNotes: string[] = [];

  if (deltaT !== null) {
    if (deltaT >= 20) { patternScore += 30; patternNotes.push('ΔT alto'); }
    else if (deltaT >= 16) { patternScore += 20; patternNotes.push('ΔT moderado'); }
    else if (deltaT >= 12) { patternScore += 10; patternNotes.push('ΔT bajo'); }
    else { patternNotes.push('ΔT insuficiente'); }
  }

  if (minHumidity !== null) {
    if (minHumidity <= 50) { patternScore += 25; patternNotes.push('HR baja'); }
    else if (minHumidity <= 65) { patternScore += 15; patternNotes.push('HR moderada'); }
    else if (minHumidity <= 75) { patternScore += 5; }
    else { patternNotes.push('HR excesiva'); }
  }

  if (peakRadiation !== null && peakRadiation >= 700) {
    patternScore += 15;
    patternNotes.push('buena radiación');
  } else if (peakRadiation !== null && peakRadiation >= 400) {
    patternScore += 8;
  }

  if (maxCape !== null && maxCape >= 300) {
    patternScore += 10;
    patternNotes.push('convección activa');
  }

  if (pressureTrend === 'rising') {
    patternScore += 10;
    patternNotes.push('presión subiendo');
  } else if (pressureTrend === 'falling') {
    patternScore -= 5;
  }

  if (directionConsistency >= 70) {
    patternScore += 10;
    patternNotes.push('viento estable');
  }

  patternScore = Math.min(100, Math.max(0, patternScore));
  const patternMatch = patternNotes.length > 0 ? patternNotes.join(' + ') : 'sin datos suficientes';

  return {
    pressureTrend, pressureChange, currentPressure,
    peakRadiation, peakRadiationTime,
    maxCape, maxCapeTime,
    minHumidity, minHumidityTime,
    directionConsistency,
    sailingWindows,
    rainAlert,
    patternMatch, patternScore,
  };
}

function DiagnosisPanel({ diag, deltaT }: { diag: DayDiagnosis; deltaT: number | null }) {
  const sun = useMemo(() => getSunTimes(), []);
  const pressureIcon = diag.pressureTrend === 'rising' ? '\u2197' : diag.pressureTrend === 'falling' ? '\u2198' : '\u2192';
  const pressureColor = diag.pressureTrend === 'rising' ? '#22c55e' : diag.pressureTrend === 'falling' ? '#ef4444' : '#64748b';

  const capeText = diag.maxCape !== null
    ? diag.maxCape < 100 ? 'estable' : diag.maxCape < 500 ? 'convección leve' : diag.maxCape < 1000 ? 'convección moderada' : 'convección fuerte'
    : null;

  return (
    <div className="mb-2 rounded border border-slate-700 bg-slate-800/50 overflow-hidden">
      <div className="px-2 py-1 bg-slate-700/50 text-[10px] font-bold text-slate-300 uppercase tracking-wider flex items-center justify-between">
        <span>Diagn&oacute;stico del d&iacute;a</span>
        <span className="text-slate-500 font-mono normal-case">
          {formatTime(sun.thermalStart)}–{formatTime(sun.thermalEnd)} ventana t&eacute;rmica
        </span>
      </div>

      <div className="grid grid-cols-3 gap-x-3 gap-y-1 p-2 text-[11px]">
        {/* Pressure */}
        <div>
          <span className="text-slate-500 text-[10px]">Presi&oacute;n</span>
          <div className="flex items-center gap-1">
            <span style={{ color: pressureColor }} className="font-bold">{pressureIcon}</span>
            {diag.currentPressure !== null && (
              <span className="text-slate-300 font-mono">{diag.currentPressure.toFixed(0)} hPa</span>
            )}
            {diag.pressureChange !== 0 && (
              <span className="text-slate-500 text-[10px]">
                ({diag.pressureChange > 0 ? '+' : ''}{diag.pressureChange.toFixed(1)})
              </span>
            )}
          </div>
        </div>

        {/* HR min */}
        <div>
          <span className="text-slate-500 text-[10px]">HR m&iacute;nima</span>
          <div>
            {diag.minHumidity !== null ? (
              <span className={diag.minHumidity <= 55 ? 'text-amber-400' : diag.minHumidity <= 70 ? 'text-slate-300' : 'text-sky-400'}>
                {diag.minHumidity.toFixed(0)}%
                {diag.minHumidityTime && (
                  <span className="text-slate-500 ml-1 text-[10px]">{formatHour(diag.minHumidityTime)}</span>
                )}
              </span>
            ) : (
              <span className="text-slate-600">—</span>
            )}
          </div>
        </div>

        {/* Solar radiation */}
        <div>
          <span className="text-slate-500 text-[10px]">Radiaci&oacute;n pico</span>
          <div>
            {diag.peakRadiation !== null ? (
              <span className={diag.peakRadiation >= 700 ? 'text-yellow-400' : diag.peakRadiation >= 400 ? 'text-slate-300' : 'text-slate-500'}>
                {diag.peakRadiation.toFixed(0)} W/m&sup2;
              </span>
            ) : (
              <span className="text-slate-600">—</span>
            )}
          </div>
        </div>

        {/* CAPE */}
        <div>
          <span className="text-slate-500 text-[10px]">CAPE</span>
          <div>
            {diag.maxCape !== null ? (
              <span className={diag.maxCape >= 500 ? 'text-orange-400' : diag.maxCape >= 100 ? 'text-slate-300' : 'text-slate-500'}>
                {diag.maxCape.toFixed(0)} J/kg
                <span className="text-slate-500 ml-1 text-[10px]">{capeText}</span>
              </span>
            ) : (
              <span className="text-slate-600">—</span>
            )}
          </div>
        </div>

        {/* Direction consistency */}
        <div>
          <span className="text-slate-500 text-[10px]">Estabilidad dir.</span>
          <div>
            <span className={diag.directionConsistency >= 70 ? 'text-green-400' : diag.directionConsistency >= 40 ? 'text-yellow-400' : 'text-red-400'}>
              {diag.directionConsistency}%
              <span className="text-slate-500 ml-1 text-[10px]">
                {diag.directionConsistency >= 70 ? 'estable' : diag.directionConsistency >= 40 ? 'variable' : 'ca&oacute;tico'}
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* Pattern match bar */}
      <div className="px-2 py-1.5 border-t border-slate-700/50 flex items-center gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-slate-500">Patr&oacute;n hist&oacute;rico:</span>
            <span className="text-slate-400">{diag.patternMatch}</span>
          </div>
          <div className="mt-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${diag.patternScore}%`,
                background: diag.patternScore >= 60 ? '#22c55e' : diag.patternScore >= 35 ? '#f59e0b' : '#64748b',
              }}
            />
          </div>
        </div>
        <span
          className="text-sm font-bold tabular-nums"
          style={{ color: diag.patternScore >= 60 ? '#22c55e' : diag.patternScore >= 35 ? '#f59e0b' : '#64748b' }}
        >
          {diag.patternScore}%
        </span>
      </div>

      {/* Rain alert — blue for light, amber for moderate, red only for heavy/storm */}
      {diag.rainAlert && (() => {
        const mm = diag.rainAlert.totalMm;
        const rainLevel = mm >= 15 ? 'heavy' : mm >= 5 ? 'moderate' : 'light';
        const colors = {
          light:    { border: 'border-sky-800/50',    bg: 'bg-sky-950/30',    icon: '#38bdf8', label: '#38bdf8', time: '#7dd3fc', amount: '#38bdf880' },
          moderate: { border: 'border-amber-800/50',  bg: 'bg-amber-950/30',  icon: '#f59e0b', label: '#f59e0b', time: '#fcd34d', amount: '#f59e0b80' },
          heavy:    { border: 'border-red-900/50',    bg: 'bg-red-950/30',    icon: '#ef4444', label: '#ef4444', time: '#fca5a5', amount: '#ef444480' },
        }[rainLevel];
        return (
          <div className={`px-2 py-1.5 border-t ${colors.border} ${colors.bg} flex items-center gap-2`}>
            <span style={{ color: colors.icon }} className="text-sm"><WeatherIcon id="cloud-rain" size={14} /></span>
            <div className="text-[10px]">
              <span style={{ color: colors.label }} className="font-bold">Lluvia prevista</span>
              <span style={{ color: colors.time }} className="ml-1.5">
                {formatHour(diag.rainAlert.start)}–{formatHour(diag.rainAlert.end)}
              </span>
              <span style={{ color: colors.amount }} className="ml-1.5 font-mono">
                {diag.rainAlert.totalMm.toFixed(1)} mm
              </span>
            </div>
          </div>
        );
      })()}

      {/* Sailing windows */}
      {diag.sailingWindows.length > 0 && (
        <div className="px-2 py-1.5 border-t border-slate-700/50">
          <div className="text-[10px] text-slate-500 mb-1">Ventanas navegables</div>
          <div className="flex flex-wrap gap-1">
            {diag.sailingWindows.slice(0, 4).map((w, i) => (
              <span
                key={i}
                className="px-1.5 py-0.5 rounded text-[10px] font-mono"
                style={{
                  background: w.quality === 'bueno' ? 'rgba(34,197,94,0.12)' : w.quality === 'moderado' ? 'rgba(250,204,21,0.1)' : 'rgba(100,116,139,0.1)',
                  color: w.quality === 'bueno' ? '#22c55e' : w.quality === 'moderado' ? '#facc15' : '#94a3b8',
                  border: `1px solid ${w.quality === 'bueno' ? 'rgba(34,197,94,0.25)' : w.quality === 'moderado' ? 'rgba(250,204,21,0.2)' : 'rgba(100,116,139,0.15)'}`,
                }}
              >
                {formatHour(w.start)}–{formatHour(w.end)}{' '}
                <span className="font-semibold">{w.avgKt.toFixed(0)} kt</span>{' '}
                {w.quality === 'bueno' && '\u2713'}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Day separator with sunrise/sunset ────────────────────

function DaySeparator({ date }: { date: Date }) {
  const sun = useMemo(() => getSunTimes(date), [date]);
  const isToday = date.toDateString() === new Date().toDateString();
  const dayLabel = isToday
    ? 'Hoy'
    : date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 bg-slate-700/40 border-t border-b border-slate-600/60">
      <span className="text-[11px] font-bold text-slate-200 capitalize">{dayLabel}</span>
      <span className="flex-1 h-px bg-slate-600/50" />
      <span className="text-[10px] text-amber-400/80 flex items-center gap-0.5" title="Amanecer">
        <WeatherIcon id="sun" size={10} /> {formatTime(sun.sunrise)}
      </span>
      <span className="text-[10px] text-orange-400/80 flex items-center gap-0.5" title="Atardecer">
        <WeatherIcon id="moon" size={10} /> {formatTime(sun.sunset)}
      </span>
      <span className="text-[10px] text-slate-500 font-mono" title="Horas de luz">
        {Math.floor(sun.dayLengthMin / 60)}h{Math.round(sun.dayLengthMin % 60).toString().padStart(2, '0')}
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────

export function ForecastTimeline() {
  const hourly = useForecastStore((s) => s.hourly);
  const fetchedAt = useForecastStore((s) => s.fetchedAt);
  const isLoading = useForecastStore((s) => s.isLoading);
  const error = useForecastStore((s) => s.error);
  const [range, setRange] = useState(24);
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');

  const rules = useThermalStore((s) => s.rules);
  const dailyContext = useThermalStore((s) => s.dailyContext);
  const deltaT = dailyContext?.deltaT ?? null;

  // Filter data by selected time range
  const visibleData = useMemo(() => {
    if (hourly.length === 0) return [];
    const now = new Date();
    const cutoff = new Date(now.getTime() + range * 60 * 60 * 1000);
    const startCutoff = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    return hourly.filter(
      (p) => p.time >= startCutoff && p.time <= cutoff,
    );
  }, [hourly, range]);

  // Score thermal for each point
  const thermalScores = useMemo(() => {
    return visibleData.map((point) => scoreForecastThermal(point, rules, deltaT));
  }, [visibleData, rules, deltaT]);

  // Find thermal windows in the full dataset
  const thermalWindows = useMemo(() => {
    return findThermalWindows(hourly, rules, deltaT);
  }, [hourly, rules, deltaT]);

  // Day diagnosis
  const diagnosis = useMemo(() => {
    if (hourly.length === 0) return null;
    return analyzeDayDiagnosis(hourly, deltaT);
  }, [hourly, deltaT]);

  // Find the "now" index for highlighting
  const nowIndex = useMemo(() => {
    const now = Date.now();
    let closest = 0;
    let minDelta = Infinity;
    for (let i = 0; i < visibleData.length; i++) {
      const delta = Math.abs(visibleData[i].time.getTime() - now);
      if (delta < minDelta) {
        minDelta = delta;
        closest = i;
      }
    }
    return closest;
  }, [visibleData]);

  // Sailing conditions summary
  const sailingSummary = useMemo(() => {
    if (visibleData.length === 0) return null;
    const future = visibleData.filter((p) => p.time.getTime() > Date.now());
    if (future.length === 0) return null;

    let bestKt = 0;
    let bestTime: Date | null = null;
    let rainHours = 0;

    for (const p of future) {
      const kt = p.windSpeed !== null ? msToKnots(p.windSpeed) : 0;
      if (kt > bestKt) {
        bestKt = kt;
        bestTime = p.time;
      }
      if ((p.precipitation ?? 0) > 0.5) rainHours++;
    }

    return { bestKt, bestTime, rainHours, totalHours: future.length };
  }, [visibleData]);

  if (error && hourly.length === 0) {
    return (
      <div className="text-red-400 text-xs p-2 bg-red-950/30 rounded">
        Error: {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-200">
            Previsión Embalse
          </h3>
          {isLoading && (
            <div className="w-3 h-3 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex gap-0.5 bg-slate-800 rounded p-0.5">
            <button
              onClick={() => setViewMode('chart')}
              className={`px-1.5 py-0.5 text-[9px] font-semibold rounded transition-colors ${
                viewMode === 'chart'
                  ? 'bg-slate-600 text-white'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
              title="Vista lista"
            >
              Lista
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`px-1.5 py-0.5 text-[9px] font-semibold rounded transition-colors ${
                viewMode === 'table'
                  ? 'bg-slate-600 text-white'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
              title="Vista tabla Windguru"
            >
              Tabla
            </button>
          </div>

          {/* Time range buttons */}
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button
                key={r.hours}
                onClick={() => setRange(r.hours)}
                className={`px-2 py-0.5 text-[10px] font-semibold rounded transition-colors ${
                  range === r.hours
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Thermal windows forecast */}
      {thermalWindows.length > 0 && (
        <div className="mb-2 space-y-1">
          {thermalWindows.slice(0, 3).map((w, i) => (
            <div
              key={i}
              className="px-2 py-1.5 rounded text-[11px] flex items-center gap-2"
              style={{
                background: thermalBg(w.peakScore),
                border: `1px solid ${thermalColor(w.peakScore)}30`,
              }}
            >
              <span style={{ color: thermalColor(w.peakScore) }} className="font-bold tabular-nums">
                {w.peakScore}%
              </span>
              <div className="text-slate-300 flex-1">
                <span className="font-medium text-white">
                  {formatHour(w.startTime)}–{formatHour(w.endTime)}
                </span>
                {w.startTime.getDate() !== new Date().getDate() && (
                  <span className="text-slate-500 ml-1">
                    ({formatDay(w.startTime)})
                  </span>
                )}
                <span className="text-slate-500 ml-2 text-[10px]">
                  {w.ruleName?.replace('Térmico ', '').replace('Precursor: ', '')}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Day diagnosis */}
      {diagnosis && <DiagnosisPanel diag={diagnosis} deltaT={deltaT} />}

      {/* Sailing summary */}
      {sailingSummary && sailingSummary.bestKt > 0 && (
        <div className="mb-2 px-2 py-1.5 bg-slate-800/60 rounded text-[11px] text-slate-300 flex items-center gap-2">
          <span><WeatherIcon id="sailboat" size={12} /></span>
          <div>
            Mejor viento:{' '}
            <span className="text-white font-semibold">{sailingSummary.bestKt.toFixed(0)} kt</span>
            {sailingSummary.bestTime && (
              <span> a las {formatHour(sailingSummary.bestTime)}</span>
            )}
            {sailingSummary.rainHours > 0 && (
              <span className="text-sky-400 ml-2 inline-flex items-center gap-0.5">
                <WeatherIcon id="cloud-rain" size={12} /> {sailingSummary.rainHours}h lluvia
              </span>
            )}
          </div>
        </div>
      )}

      {/* ΔT context */}
      {deltaT !== null && (
        <div className="mb-1 px-2 text-[10px] text-slate-500">
          ΔT hoy: <span className={deltaT >= 16 ? 'text-amber-400' : deltaT < 8 ? 'text-blue-400' : 'text-slate-400'}>{deltaT.toFixed(1)}°C</span>
          {deltaT >= 20 && <span className="inline-flex ml-0.5 text-amber-400"><WeatherIcon id="flame" size={12} /></span>}
          {deltaT < 8 && <span className="inline-flex ml-0.5 text-blue-400"><WeatherIcon id="snowflake" size={12} /></span>}
        </div>
      )}

      {/* Table view */}
      {viewMode === 'table' ? (
        <div className="flex-1 overflow-hidden min-h-0">
          <ForecastTable data={visibleData} />
        </div>
      ) : (
        <>
          {/* Column header */}
          <div className="grid grid-cols-[52px_28px_1fr_42px_36px_36px_24px_28px] gap-1 px-2 py-1 text-[10px] text-slate-500 uppercase tracking-wider border-b border-slate-700">
            <span>Hora</span>
            <span>Dir</span>
            <span>Viento</span>
            <span className="text-right">°C</span>
            <span className="text-right">HR</span>
            <span className="text-right">mm</span>
            <span className="text-center"><WeatherIcon id="cloud" size={12} /></span>
            <span className="text-center" title="Score térmico estimado"><WeatherIcon id="thermometer" size={12} /></span>
          </div>

          {/* Timeline rows */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {visibleData.length === 0 && !isLoading && (
              <div className="text-slate-500 text-xs text-center py-8">
                {error ? `Error: ${error}` : 'Cargando previsión…'}
              </div>
            )}

            {visibleData.map((point, i) => {
              const prevDay = i > 0 ? visibleData[i - 1].time.getDate() : -1;
              const isNewDay = i === 0 || point.time.getDate() !== prevDay;

              return (
                <div
                  key={point.time.getTime()}
                  className={i === nowIndex ? 'relative' : ''}
                >
                  {i === nowIndex && (
                    <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-blue-500 z-10" />
                  )}
                  {/* Day separator with sunrise/sunset */}
                  {isNewDay && <DaySeparator date={point.time} />}
                  <ForecastRow
                    point={point}
                    showDate={false}
                    thermalScore={thermalScores[i] ?? { score: 0, mainRule: null, isNavigable: false, isPrecursor: false }}
                  />
            </div>
          );
        })}
          </div>
        </>
      )}

      {/* Footer */}
      {fetchedAt && (
        <div className="text-[10px] text-slate-600 text-center py-1 border-t border-slate-800">
          Open-Meteo + scoring térmico · Actualizado {formatHour(fetchedAt)}
        </div>
      )}
    </div>
  );
}
