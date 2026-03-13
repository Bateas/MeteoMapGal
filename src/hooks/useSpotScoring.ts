/**
 * Hook that computes spot scores from current weather + buoy data.
 * Re-scores when stations, readings, or buoys change.
 * Active for both sectors (Rías + Embalse).
 *
 * For spots with thermalDetection, enriches scores with thermal context
 * (ΔT, thermal probability, wind window, atmosphere, tendency, alerts).
 */
import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useWeatherStore } from '../store/weatherStore';
import { useBuoyStore } from '../store/buoyStore';
import { useSpotStore } from '../store/spotStore';
import { useSectorStore } from '../store/sectorStore';
import { useThermalStore } from '../store/thermalStore';
import { useLightningStore } from './useLightningData';
import { useForecastStore } from './useForecastTimeline';
import { scoreAllSpots, type SpotThermalContext } from '../services/spotScoringEngine';
import { getSpotsForSector } from '../config/spots';
import { msToKnots, degToCardinal8 } from '../services/windUtils';
import { fetchTeleconnections, type TeleconnectionIndex } from '../api/naoClient';

/**
 * Throttle intervals:
 * - Startup phase (first 90s): re-score every 5s as sources arrive in waves
 * - Steady state: re-score max every 30s (readings change infrequently)
 */
const STARTUP_INTERVAL = 5_000;
const STEADY_INTERVAL = 30_000;
const STARTUP_WINDOW = 90_000; // 90s after first mount

export function useSpotScoring() {
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const stations = useWeatherStore((s) => s.stations);
  // Use readingsEpoch as reactive trigger — Map references can fool Zustand's Object.is check
  const readingsEpoch = useWeatherStore((s) => s.readingsEpoch);
  const buoys = useBuoyStore((s) => s.buoys);
  const setScores = useSpotStore((s) => s.setScores);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const lastScoredRef = useRef(0);
  const mountTimeRef = useRef(Date.now());
  const teleconnectionsRef = useRef<TeleconnectionIndex[]>([]);

  // Fetch NAO/AO once on mount (cached 6h in naoClient)
  useEffect(() => {
    fetchTeleconnections()
      .then((data) => { teleconnectionsRef.current = data; })
      .catch(() => { /* graceful — scoring works without teleconnections */ });
  }, []);

  // Thermal stores (for enriching spots with thermalDetection)
  const { dailyContext, atmosphericContext, tendencySignals } = useThermalStore(
    useShallow((s) => ({
      dailyContext: s.dailyContext,
      atmosphericContext: s.atmosphericContext,
      tendencySignals: s.tendencySignals,
    })),
  );
  // Use raw stormAlert from lightning store — NOT deduped alerts.
  // Dedup can merge storm-shadow into storm-main, causing false positives.
  // Only real lightning proximity (warning/danger level) should trigger spot alerts.
  const stormAlert = useLightningStore((s) => s.stormAlert);
  const forecast = useForecastStore((s) => s.hourly);

  useEffect(() => {
    const spots = getSpotsForSector(sectorId);
    if (spots.length === 0) return;
    if (stations.length === 0 && buoys.length === 0) return;

    // Throttle: fast during startup (sources arriving), slow in steady state
    const now = Date.now();
    const isStartup = (now - mountTimeRef.current) < STARTUP_WINDOW;
    const minInterval = isStartup ? STARTUP_INTERVAL : STEADY_INTERVAL;
    if (now - lastScoredRef.current < minInterval) return;

    // Build thermal context if any spot in this sector uses thermalDetection
    const hasThermalSpots = spots.some((s) => s.thermalDetection);
    let thermalData: SpotThermalContext | undefined;

    if (hasThermalSpots) {
      thermalData = buildThermalContext(dailyContext, atmosphericContext, tendencySignals, stormAlert, forecast);
    }

    // Defer scoring to avoid blocking render — read readings fresh from store
    timerRef.current = setTimeout(() => {
      const currentReadings = useWeatherStore.getState().currentReadings;
      const tc = teleconnectionsRef.current.length > 0 ? teleconnectionsRef.current : undefined;
      const scores = scoreAllSpots(spots, stations, currentReadings, buoys, thermalData, tc);
      setScores(scores);
      lastScoredRef.current = Date.now();
    }, 50);

    return () => clearTimeout(timerRef.current);
  }, [sectorId, stations, readingsEpoch, buoys, setScores, dailyContext, atmosphericContext, tendencySignals, stormAlert, forecast]);
}

/**
 * Build SpotThermalContext from thermal/forecast/alert stores.
 * Mirrors the logic previously in DailySailingBriefing → generateSailingBriefing.
 */
function buildThermalContext(
  dailyContext: ReturnType<typeof useThermalStore.getState>['dailyContext'],
  atmosphericContext: ReturnType<typeof useThermalStore.getState>['atmosphericContext'],
  tendencySignals: ReturnType<typeof useThermalStore.getState>['tendencySignals'],
  stormAlert: ReturnType<typeof useLightningStore.getState>['stormAlert'],
  forecast: ReturnType<typeof useForecastStore.getState>['hourly'],
): SpotThermalContext {
  const deltaT = dailyContext?.deltaT ?? null;

  // Thermal probability — simplified from dailyBriefingService
  // Uses ΔT (40%) + atmosphere (35%) + tendency (25%) as proxy
  let thermalProbability = 0;
  if (deltaT !== null) {
    const deltaTScore = deltaT >= 20 ? 15 : deltaT >= 16 ? 12 : deltaT >= 12 ? 8 : deltaT >= 8 ? 4 : 0;
    const atmosphereScore = computeAtmosphereScore(atmosphericContext);
    const tendencyScore = computeTendencyScore(tendencySignals);
    thermalProbability = Math.min(100, Math.round(
      (deltaTScore / 15) * 40 + (atmosphereScore / 15) * 35 + (tendencyScore / 10) * 25,
    ));
  }

  // Single pass over forecast: extract today's daytime hours and rain probabilities
  const now = new Date();
  const todayStr = now.toDateString();
  const todayDayHours: typeof forecast = [];
  let maxRainProb = -1;

  for (const f of forecast) {
    if (f.time.toDateString() !== todayStr) continue;
    if (f.precipProbability !== null && f.precipProbability > maxRainProb) {
      maxRainProb = f.precipProbability;
    }
    const h = f.time.getHours();
    if (h >= 10 && h <= 20 && f.isDay) todayDayHours.push(f);
  }

  const rainProbability = maxRainProb >= 0 ? Math.round(maxRainProb) : null;

  let windWindow: SpotThermalContext['windWindow'] = null;
  if (todayDayHours.length > 0) {
    const withWind = todayDayHours.filter((f) => f.windSpeed !== null && msToKnots(f.windSpeed) >= 3);
    if (withWind.length > 0) {
      const speeds = withWind.map((f) => msToKnots(f.windSpeed!));
      const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
      const dirCounts = new Map<string, number>();
      for (const f of withWind) {
        if (f.windDirection !== null) {
          const d = degToCardinal8(f.windDirection);
          dirCounts.set(d, (dirCounts.get(d) ?? 0) + 1);
        }
      }
      const dominantDir = [...dirCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';

      windWindow = {
        startHour: withWind[0].time.getHours(),
        endHour: withWind[withWind.length - 1].time.getHours(),
        avgSpeedKt: Math.round(avgSpeed * 10) / 10,
        dominantDir,
      };
    }
  }

  // Atmosphere
  const cloudCover = atmosphericContext?.cloudCover ?? null;
  const cape = atmosphericContext?.cape ?? null;

  // Best tendency
  let bestTendency = 'none';
  for (const signal of tendencySignals.values()) {
    if (signal.level === 'active') bestTendency = 'active';
    else if (signal.level === 'likely' && bestTendency !== 'active') bestTendency = 'likely';
    else if (signal.level === 'building' && bestTendency === 'none') bestTendency = 'building';
  }

  // Storm alert — ONLY lightning-confirmed proximity threats.
  // Uses raw stormAlert from lightning store (NOT deduped alerts from alertStore).
  // 'warning' = lightning within 25km, 'danger' = lightning within 5km.
  // Excludes 'watch' (25-50km — distant, not actionable for spots) and
  // storm-shadow (cloud density / solar drops — not confirmed electrical activity).
  const hasStormAlert = stormAlert.level === 'warning' || stormAlert.level === 'danger';

  return {
    deltaT,
    thermalProbability,
    windWindow,
    atmosphere: { cloudCover, cape },
    bestTendency,
    hasStormAlert,
    rainProbability,
  };
}

/** Atmosphere score 0-15 (mirrors dailyBriefingService logic) */
function computeAtmosphereScore(ctx: ReturnType<typeof useThermalStore.getState>['atmosphericContext']): number {
  if (!ctx) return 0;
  let score = 0;
  if (ctx.cloudCover !== null) {
    if (ctx.cloudCover < 30) score += 5;
    else if (ctx.cloudCover < 50) score += 3;
    else if (ctx.cloudCover < 70) score += 1;
  }
  if (ctx.cape !== null) {
    if (ctx.cape >= 300) score += 5;
    else if (ctx.cape >= 100) score += 3;
    else if (ctx.cape >= 50) score += 1;
  }
  if (ctx.solarRadiation !== null) {
    if (ctx.solarRadiation >= 600) score += 5;
    else if (ctx.solarRadiation >= 300) score += 3;
    else if (ctx.solarRadiation >= 100) score += 1;
  }
  return Math.min(15, score);
}

/** Tendency score 0-10 (best tendency level across zones) */
function computeTendencyScore(tendencySignals: Map<string, { level: string }>): number {
  let best = 0;
  for (const signal of tendencySignals.values()) {
    if (signal.level === 'active') return 10;
    if (signal.level === 'likely' && best < 7) best = 7;
    if (signal.level === 'building' && best < 4) best = 4;
  }
  return best;
}
