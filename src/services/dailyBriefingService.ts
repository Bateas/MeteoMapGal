import type { HourlyForecast } from '../types/forecast';
import type { NormalizedReading } from '../types/station';
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

export interface WindConsensus {
  /** Number of stations reporting consistent wind direction */
  stationCount: number;
  /** Average wind speed across consensus stations (kt) */
  avgSpeedKt: number;
  /** Dominant wind direction (cardinal) */
  dominantDir: string;
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
  /** Real-time station wind consensus */
  windConsensus: WindConsensus | null;
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

// ── Real-time wind consensus ─────────────────────────────────

/**
 * Compute wind consensus from real-time station readings.
 * Groups stations reporting wind in the same ±45° sector.
 * Returns the largest group with avg speed ≥ 2kt (real wind).
 */
function computeWindConsensus(
  currentReadings: Map<string, NormalizedReading>,
): WindConsensus | null {
  // Collect all stations with valid wind data (≥2kt to exclude calm/noise)
  const windStations: { dir: number; speedKt: number }[] = [];

  for (const [, reading] of currentReadings) {
    if (
      reading.windSpeed !== null &&
      reading.windDirection !== null &&
      msToKnots(reading.windSpeed) >= 2
    ) {
      windStations.push({
        dir: reading.windDirection,
        speedKt: msToKnots(reading.windSpeed),
      });
    }
  }

  if (windStations.length < 2) return null;

  // For each possible 90° sector centered on a cardinal (8 sectors),
  // count how many stations fall within ±45°
  let bestGroup: typeof windStations = [];
  let bestCardinal = 'N';

  for (let sectorCenter = 0; sectorCenter < 360; sectorCenter += 45) {
    const group = windStations.filter((ws) => {
      const diff = Math.abs(((ws.dir - sectorCenter) + 180) % 360 - 180);
      return diff <= 45;
    });

    if (group.length > bestGroup.length) {
      bestGroup = group;
      bestCardinal = degToCardinal8(sectorCenter);
    }
  }

  if (bestGroup.length < 2) return null;

  const avgSpeed = bestGroup.reduce((sum, ws) => sum + ws.speedKt, 0) / bestGroup.length;

  // Return consensus if average is at least 2kt (real wind detected)
  if (avgSpeed < 2) return null;

  return {
    stationCount: bestGroup.length,
    avgSpeedKt: Math.round(avgSpeed * 10) / 10,
    dominantDir: bestCardinal,
  };
}

// ── Main briefing generator ──────────────────────────────────

/**
 * Scoring weights (100 total):
 *   Consensus real-time:  0-40 pts  (DOMINANT — actual wind happening now)
 *   Forecast wind:        0-20 pts  (predicted wind window)
 *   ΔT diurnal:           0-15 pts  (thermal potential bonus)
 *   Atmosphere:            0-15 pts  (clouds, CAPE, PBL — thermal bonus)
 *   Thermal zone:          0-10 pts  (zone activity bonus)
 *
 * Verdict thresholds:
 *   GO:       score ≥ 45  (achievable with good real wind alone)
 *   MARGINAL: score 20-44 (light wind or pending conditions)
 *   NOGO:     score < 20  (calm or storm)
 *
 * Philosophy: If stations report >5kt sustained wind, that's a sailing day
 * regardless of thermals. Thermals are a BONUS that make it excellent.
 */
export function generateSailingBriefing(
  forecast: HourlyForecast[],
  dailyContext: DailyContext | null,
  atmosphericContext: AtmosphericContext | null,
  zoneAlerts: Map<MicroZoneId, ZoneAlert>,
  tendencySignals: Map<MicroZoneId, TendencySignal>,
  alerts: UnifiedAlert[],
  currentReadings?: Map<string, NormalizedReading>,
): SailingBriefing {
  const now = new Date();

  // ── ΔT score (0-15 pts) ──────────────────────────────────
  const deltaT = dailyContext?.deltaT ?? null;
  let deltaTScore = 0;
  if (deltaT !== null) {
    if (deltaT >= 20) deltaTScore = 15;
    else if (deltaT >= 16) deltaTScore = 12;
    else if (deltaT >= 12) deltaTScore = 8;
    else if (deltaT >= 8) deltaTScore = 4;
    else deltaTScore = 2;
  }

  // ── Atmosphere score (0-15 pts) ──────────────────────────
  let atmosphereScore = 0;
  const cloudCover = atmosphericContext?.cloudCover ?? null;
  const cape = atmosphericContext?.cape ?? null;
  const solarRad = atmosphericContext?.solarRadiation ?? null;
  const pblHeight = atmosphericContext?.boundaryLayerHeight ?? null;

  if (cloudCover !== null) {
    if (cloudCover < 20) atmosphereScore += 6;
    else if (cloudCover < 40) atmosphereScore += 4;
    else if (cloudCover < 60) atmosphereScore += 2;
  }
  if (cape !== null) {
    if (cape > 1000) atmosphereScore += 6;
    else if (cape > 500) atmosphereScore += 4;
    else if (cape > 200) atmosphereScore += 2;
  }
  if (pblHeight !== null && pblHeight > 1500) atmosphereScore += 3;

  // ── Forecast wind window (0-20 pts) ──────────────────────
  const todayHours = forecast.filter((f) => {
    const h = f.time.getHours();
    return f.time.toDateString() === now.toDateString() && h >= 10 && h <= 20 && f.isDay;
  });

  let windWindow: WindWindow | null = null;
  let windForecastScore = 0;

  if (todayHours.length > 0) {
    const withWind = todayHours.filter((f) => f.windSpeed !== null && msToKnots(f.windSpeed) >= 3);

    if (withWind.length > 0) {
      const speeds = withWind.map((f) => msToKnots(f.windSpeed!));
      const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
      const peakSpeed = Math.max(...speeds);

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
      if (avgSpeed >= 6 && avgSpeed <= 15) windForecastScore = 20;
      else if (avgSpeed >= 4) windForecastScore = 15;
      else if (avgSpeed >= 3) windForecastScore = 10;
      else windForecastScore = 4;
    }
  }

  // ── Thermal zone score (0-10 pts) ────────────────────────
  let maxZoneScore = 0;
  for (const [, alert] of zoneAlerts) {
    if (alert.maxScore > maxZoneScore) maxZoneScore = alert.maxScore;
  }
  const thermalZoneScore = Math.min(maxZoneScore / 10, 10);

  // ── Real-time wind consensus (0-40 pts, DOMINANT) ────────
  const windConsensus = currentReadings ? computeWindConsensus(currentReadings) : null;
  let consensusScore = 0;

  if (windConsensus) {
    const spd = windConsensus.avgSpeedKt;
    const cnt = windConsensus.stationCount;

    // Speed-based scoring (main factor)
    if (spd >= 8 && cnt >= 5) consensusScore = 38;
    else if (spd >= 8) consensusScore = 32;
    else if (spd >= 6 && cnt >= 3) consensusScore = 28;
    else if (spd >= 6) consensusScore = 22;
    else if (spd >= 5 && cnt >= 3) consensusScore = 20;
    else if (spd >= 5) consensusScore = 16;
    else if (spd >= 4) consensusScore = 12;
    else if (spd >= 3) consensusScore = 6;
    else consensusScore = 3;

    // Bonus for many stations confirming (very consistent)
    if (cnt >= 10) consensusScore += 2;
  }
  consensusScore = Math.min(consensusScore, 40);

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

  // ── Final score (max 100) ──────────────────────────────
  // Consensus(40) + Forecast(20) + ΔT(15) + Atmosphere(15) + Zone(10)
  const rawScore = consensusScore + windForecastScore + deltaTScore + atmosphereScore + thermalZoneScore;
  const score = Math.max(0, Math.min(100, rawScore - alertPenalty));

  const thermalProbability = Math.min(100, Math.round(
    (deltaTScore / 15) * 40 + (atmosphereScore / 15) * 35 + (thermalZoneScore / 10) * 25,
  ));

  // ── Verdict ────────────────────────────────────────────
  let verdict: SailingVerdict = 'unknown';
  if (hasStormAlert) verdict = 'nogo';
  else if (score >= 45) verdict = 'go';
  else if (score >= 20) verdict = 'marginal';
  else if (forecast.length > 0 || dailyContext || (currentReadings && currentReadings.size > 0)) verdict = 'nogo';
  // else stays 'unknown' (no data yet)

  // ── Summary text ───────────────────────────────────────
  const summary = buildSummary(verdict, score, deltaT, windWindow, windConsensus, bestTendency, hasStormAlert, rainProbability);

  return {
    verdict,
    score,
    summary,
    deltaT,
    thermalProbability,
    windWindow,
    windConsensus,
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
  score: number,
  deltaT: number | null,
  windWindow: WindWindow | null,
  consensus: WindConsensus | null,
  tendency: string,
  stormAlert: boolean,
  rainProb: number | null,
): string {
  if (stormAlert) return 'Alerta de tormenta activa. No recomendable navegar.';

  if (verdict === 'unknown') return 'Esperando datos meteorológicos...';

  const parts: string[] = [];

  if (verdict === 'go') {
    if (score >= 75) {
      parts.push('Condiciones excelentes.');
    } else {
      parts.push('Buen día para navegar.');
    }
  } else if (verdict === 'marginal') {
    parts.push('Condiciones justas.');
  } else {
    parts.push('Sin condiciones favorables.');
  }

  // Real-time consensus first (most actionable)
  if (consensus) {
    parts.push(
      `Viento real ${consensus.dominantDir} ~${consensus.avgSpeedKt.toFixed(0)}kt · ${consensus.stationCount} estaciones.`,
    );
  }

  // Forecast window
  if (windWindow && !consensus) {
    parts.push(
      `Previsión ${windWindow.dominantDir} ~${windWindow.avgSpeedKt.toFixed(0)}kt` +
      ` (${windWindow.startHour}:00–${windWindow.endHour}:00).`,
    );
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
