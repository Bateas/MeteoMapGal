import type { HourlyForecast } from '../types/forecast';
import type { DailyContext, AtmosphericContext, ZoneAlert, TendencySignal, MicroZoneId } from '../types/thermal';
import type { UnifiedAlert } from './alertService';
import { msToKnots } from './windUtils';

// ── Types ────────────────────────────────────────────────────

export type SailingVerdict = 'go' | 'marginal' | 'nogo' | 'unknown';

export interface WindWindow {
  startHour: number;   // 0-23
  endHour: number;     // 0-23
  avgSpeedKt: number;
  dominantDir: string; // cardinal
  peakSpeedKt: number;
}

export interface SailingBriefing {
  /** Overall sailing verdict */
  verdict: SailingVerdict;
  /** Overall score 0-100 */
  score: number;
  /** One-line summary in Spanish */
  summary: string;
  /** ΔT diurnal range */
  deltaT: number | null;
  /** Thermal probability 0-100 */
  thermalProbability: number;
  /** Best forecast wind window for today */
  windWindow: WindWindow | null;
  /** Current atmospheric snapshot */
  atmosphere: {
    cloudCover: number | null;
    cape: number | null;
    solarRadiation: number | null;
    pblHeight: number | null;
  };
  /** Alert summary */
  alertCount: number;
  hasStormAlert: boolean;
  /** Max zone thermal score */
  maxZoneScore: number;
  /** Best tendency level */
  bestTendency: string;
  /** Forecast rain probability today */
  rainProbability: number | null;
  /** Computed at */
  computedAt: Date;
}

// ── Cardinal helper ──────────────────────────────────────────

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

function degToCardinal8(deg: number): string {
  const idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return CARDINALS[idx];
}

// ── Main briefing generator ──────────────────────────────────

export function generateSailingBriefing(
  forecast: HourlyForecast[],
  dailyContext: DailyContext | null,
  atmosphericContext: AtmosphericContext | null,
  zoneAlerts: Map<MicroZoneId, ZoneAlert>,
  tendencySignals: Map<MicroZoneId, TendencySignal>,
  alerts: UnifiedAlert[],
): SailingBriefing {
  const now = new Date();

  // ── ΔT score (0-30 points) ─────────────────────────────
  const deltaT = dailyContext?.deltaT ?? null;
  let deltaTScore = 0;
  if (deltaT !== null) {
    if (deltaT >= 20) deltaTScore = 30;
    else if (deltaT >= 16) deltaTScore = 25;
    else if (deltaT >= 12) deltaTScore = 18;
    else if (deltaT >= 8) deltaTScore = 10;
    else deltaTScore = 3;
  }

  // ── Atmosphere score (0-25 points) ─────────────────────
  let atmosphereScore = 0;
  const cloudCover = atmosphericContext?.cloudCover ?? null;
  const cape = atmosphericContext?.cape ?? null;
  const solarRad = atmosphericContext?.solarRadiation ?? null;
  const pblHeight = atmosphericContext?.boundaryLayerHeight ?? null;

  if (cloudCover !== null) {
    if (cloudCover < 20) atmosphereScore += 10;
    else if (cloudCover < 40) atmosphereScore += 7;
    else if (cloudCover < 60) atmosphereScore += 4;
  }
  if (cape !== null) {
    if (cape > 1000) atmosphereScore += 10;
    else if (cape > 500) atmosphereScore += 7;
    else if (cape > 200) atmosphereScore += 4;
  }
  if (pblHeight !== null && pblHeight > 1500) atmosphereScore += 5;

  // ── Forecast wind window (0-25 points) ─────────────────
  const todayHours = forecast.filter((f) => {
    const h = f.time.getHours();
    return f.time.toDateString() === now.toDateString() && h >= 10 && h <= 20 && f.isDay;
  });

  let windWindow: WindWindow | null = null;
  let windScore = 0;

  if (todayHours.length > 0) {
    // Find consecutive hours with decent wind (>3kt)
    const withWind = todayHours.filter((f) => f.windSpeed !== null && msToKnots(f.windSpeed) >= 3);

    if (withWind.length > 0) {
      const speeds = withWind.map((f) => msToKnots(f.windSpeed!));
      const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
      const peakSpeed = Math.max(...speeds);

      // Dominant direction (mode of cardinal directions)
      const dirs = withWind
        .filter((f) => f.windDirection !== null)
        .map((f) => degToCardinal8(f.windDirection!));
      const dirCounts = new Map<string, number>();
      for (const d of dirs) dirCounts.set(d, (dirCounts.get(d) ?? 0) + 1);
      const dominantDir = [...dirCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';

      windWindow = {
        startHour: withWind[0].time.getHours(),
        endHour: withWind[withWind.length - 1].time.getHours(),
        avgSpeedKt: Math.round(avgSpeed * 10) / 10,
        dominantDir,
        peakSpeedKt: Math.round(peakSpeed * 10) / 10,
      };

      // Score based on avg speed for sailing (sweet spot 6-15kt)
      if (avgSpeed >= 6 && avgSpeed <= 15) windScore = 25;
      else if (avgSpeed >= 4) windScore = 18;
      else if (avgSpeed >= 3) windScore = 12;
      else windScore = 5;
    }
  }

  // ── Thermal zone score (0-20 points) ───────────────────
  let maxZoneScore = 0;
  for (const [, alert] of zoneAlerts) {
    if (alert.maxScore > maxZoneScore) maxZoneScore = alert.maxScore;
  }
  const thermalZoneScore = Math.min(maxZoneScore / 5, 20);

  // ── Tendency bonus ─────────────────────────────────────
  let bestTendency = 'none';
  for (const [, signal] of tendencySignals) {
    if (signal.level === 'active') bestTendency = 'active';
    else if (signal.level === 'likely' && bestTendency !== 'active') bestTendency = 'likely';
    else if (signal.level === 'building' && bestTendency === 'none') bestTendency = 'building';
  }

  // ── Alert penalties ────────────────────────────────────
  const hasStormAlert = alerts.some((a) => a.category === 'storm' && a.severity !== 'info');
  const criticalAlerts = alerts.filter((a) => a.severity === 'critical' || a.severity === 'high');
  let alertPenalty = 0;
  if (hasStormAlert) alertPenalty = 40;
  else if (criticalAlerts.length > 0) alertPenalty = 20;

  // ── Rain probability ──────────────────────────────────
  const todayRainProbs = todayHours
    .filter((f) => f.precipProbability !== null)
    .map((f) => f.precipProbability!);
  const rainProbability = todayRainProbs.length > 0
    ? Math.round(Math.max(...todayRainProbs))
    : null;
  if (rainProbability !== null && rainProbability > 60) alertPenalty += 10;

  // ── Final score ────────────────────────────────────────
  const rawScore = deltaTScore + atmosphereScore + windScore + thermalZoneScore;
  const score = Math.max(0, Math.min(100, rawScore - alertPenalty));

  const thermalProbability = Math.min(100, Math.round(
    (deltaTScore / 30) * 40 + (atmosphereScore / 25) * 35 + (thermalZoneScore / 20) * 25,
  ));

  // ── Verdict ────────────────────────────────────────────
  let verdict: SailingVerdict = 'unknown';
  if (hasStormAlert) verdict = 'nogo';
  else if (score >= 55) verdict = 'go';
  else if (score >= 30) verdict = 'marginal';
  else if (forecast.length > 0 || dailyContext) verdict = 'nogo';
  // else stays 'unknown' (no data yet)

  // ── Summary text ───────────────────────────────────────
  const summary = buildSummary(verdict, deltaT, windWindow, bestTendency, hasStormAlert, rainProbability);

  return {
    verdict,
    score,
    summary,
    deltaT,
    thermalProbability,
    windWindow,
    atmosphere: { cloudCover, cape, solarRadiation: solarRad, pblHeight },
    alertCount: alerts.length,
    hasStormAlert,
    maxZoneScore,
    bestTendency,
    rainProbability,
    computedAt: now,
  };
}

// ── Summary text builder ─────────────────────────────────────

function buildSummary(
  verdict: SailingVerdict,
  deltaT: number | null,
  windWindow: WindWindow | null,
  tendency: string,
  stormAlert: boolean,
  rainProb: number | null,
): string {
  if (stormAlert) return 'Alerta de tormenta activa. No recomendable navegar.';

  if (verdict === 'unknown') return 'Esperando datos meteorológicos...';

  const parts: string[] = [];

  if (verdict === 'go') {
    parts.push('Buen día para navegar.');
  } else if (verdict === 'marginal') {
    parts.push('Condiciones marginales.');
  } else {
    parts.push('Condiciones desfavorables hoy.');
  }

  if (windWindow) {
    parts.push(
      `Viento ${windWindow.dominantDir} ~${windWindow.avgSpeedKt.toFixed(0)}kt` +
      ` (${windWindow.startHour}:00–${windWindow.endHour}:00).`,
    );
  } else {
    parts.push('Sin ventana de viento clara.');
  }

  if (deltaT !== null && deltaT >= 16) {
    parts.push(`ΔT ${deltaT.toFixed(0)}°C — buen potencial térmico.`);
  }

  if (tendency === 'active') parts.push('Térmicas activas.');
  else if (tendency === 'likely') parts.push('Térmicas probables.');

  if (rainProb !== null && rainProb > 50) {
    parts.push(`Prob. lluvia ${rainProb}%.`);
  }

  return parts.join(' ');
}
