import { useEffect, useCallback, useRef, useTransition } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useWeatherStore } from '../store/weatherStore';
import { useThermalStore } from '../store/thermalStore';
import { scoreAllRules, computeZoneAlerts } from '../services/thermalScoringEngine';
import { detectPropagation } from '../services/windPropagationDetector';
import { detectTendency } from '../services/tendencyDetector';
import { analyzeZoneHumidity } from '../services/humidityWindAnalyzer';
import type { HumidityAssessment } from '../services/humidityWindAnalyzer';
import {
  fetchForecastForZones,
  fetchDailyContextForEmbalse,
  fetchAtmosphericContextForEmbalse,
  fetchOpenMeteoHistory,
} from '../api/openMeteoClient';
import type { MicroZoneId, ForecastAlert, TendencySignal, AtmosphericContext } from '../types/thermal';
import type { NormalizedReading } from '../types/station';
import { scoreRule } from '../services/thermalScoringEngine';
import { estimateCloudCover } from '../services/stormShadowDetector';
import { MICRO_ZONES } from '../config/thermalZones';

const FORECAST_INTERVAL_MS = 30 * 60 * 1000;
const ATMOSPHERIC_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Connects weather data → scoring engine → tendency detector → thermal store.
 * Call this once at the AppShell level.
 *
 * Data flow:
 *   1. Station readings → zone grouping → rule scoring → zone alerts
 *   2. Reading history → tendency detector → tendency signals (precursor warnings)
 *   3. Open-Meteo forecast → forecast scoring → forecast alerts
 *   4. Open-Meteo atmospheric → cloud/radiation/CAPE context
 *   5. Open-Meteo 24h history → backfill for tendency time series
 */
export function useThermalAnalysis() {
  const { stations, currentReadings, readingHistory } = useWeatherStore(
    useShallow((s) => ({
      stations: s.stations,
      currentReadings: s.currentReadings,
      readingHistory: s.readingHistory,
    }))
  );

  const {
    zones, rules, dailyContext, stationToZone, atmosphericContext,
    setRuleScores, setZoneAlerts, setTendencySignals, setPropagationEvents,
    setStationToZone, setZoneForecast, setForecastAlerts, setDailyContext,
    setAtmosphericContext, setHumidityAssessments,
  } = useThermalStore(
    useShallow((s) => ({
      zones: s.zones,
      rules: s.rules,
      dailyContext: s.dailyContext,
      stationToZone: s.stationToZone,
      atmosphericContext: s.atmosphericContext,
      setRuleScores: s.setRuleScores,
      setZoneAlerts: s.setZoneAlerts,
      setTendencySignals: s.setTendencySignals,
      setPropagationEvents: s.setPropagationEvents,
      setStationToZone: s.setStationToZone,
      setZoneForecast: s.setZoneForecast,
      setForecastAlerts: s.setForecastAlerts,
      setDailyContext: s.setDailyContext,
      setAtmosphericContext: s.setAtmosphericContext,
      setHumidityAssessments: s.setHumidityAssessments,
    }))
  );

  const [, startTransition] = useTransition();

  const openMeteoHistoryRef = useRef<Map<MicroZoneId, NormalizedReading[]>>(new Map());
  const lastScoringFingerprintRef = useRef<string>('');

  // ── Build station → zone mapping when stations change ──
  useEffect(() => {
    if (stations.length === 0) return;

    const mapping = new Map<string, MicroZoneId>();
    for (const station of stations) {
      const nameLower = station.name.toLowerCase();
      for (const zone of zones) {
        if (zone.stationPatterns.some((p) => nameLower.includes(p.toLowerCase()))) {
          mapping.set(station.id, zone.id);
          break;
        }
      }
    }

    setStationToZone(mapping);
  }, [stations, zones, setStationToZone]);

  // ── Fetch daily context (ΔT) on mount ──────────────────
  useEffect(() => {
    fetchDailyContextForEmbalse().then((ctx) => {
      setDailyContext(ctx);
    }).catch((err) => console.warn('[ThermalAnalysis] Daily context error:', err));
  }, [setDailyContext]);

  // ── Fetch atmospheric context (cloud/radiation/CAPE) ────
  const fetchAtmospheric = useCallback(() => {
    fetchAtmosphericContextForEmbalse().then((ctx) => {
      setAtmosphericContext(ctx);
    }).catch((err) => console.warn('[ThermalAnalysis] Atmospheric context error:', err));
  }, [setAtmosphericContext]);

  // Ref keeps latest callback so interval never needs re-creation
  const fetchAtmosphericRef = useRef(fetchAtmospheric);
  fetchAtmosphericRef.current = fetchAtmospheric;

  useEffect(() => {
    fetchAtmosphericRef.current();
    const id = setInterval(() => fetchAtmosphericRef.current(), ATMOSPHERIC_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Fetch Open-Meteo 24h history for tendency backfill ──
  // Station-based history may be sparse (only 10min readings since app opened).
  // Open-Meteo provides model data for the last 24h, giving the tendency detector
  // a complete time series to compute temperature rise rates, humidity trends, etc.
  useEffect(() => {
    async function fetchHistory() {
      const historyMap = new Map<MicroZoneId, NormalizedReading[]>();

      const results = await Promise.allSettled(
        MICRO_ZONES.map(async (zone) => {
          const readings = await fetchOpenMeteoHistory(
            zone.center.lat, zone.center.lon,
            `openmeteo_${zone.id}`,
            6 // last 6 hours — enough for tendency detection
          );
          return { id: zone.id, readings };
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          historyMap.set(result.value.id, result.value.readings);
        }
      }

      openMeteoHistoryRef.current = historyMap;
    }

    fetchHistory();
  }, []);

  // ── Re-score + tendency detection on every data update ──
  // Wrapped in startTransition to keep map/UI responsive during heavy scoring.
  // Fingerprint skips re-scoring when readings haven't changed meaningfully.
  useEffect(() => {
    if (stationToZone.size === 0 || currentReadings.size === 0) return;

    // Build fingerprint from key fields (rounded to avoid float noise)
    const parts: string[] = [];
    for (const [id, r] of currentReadings) {
      parts.push(
        `${id}:${r.windSpeed?.toFixed(1) ?? '-'},${r.windDirection?.toFixed(0) ?? '-'},${r.temperature?.toFixed(1) ?? '-'},${r.humidity?.toFixed(0) ?? '-'},${r.solarRadiation?.toFixed(0) ?? '-'}`
      );
    }
    // Include atmospheric context in fingerprint since it affects scoring
    const atmKey = atmosphericContext
      ? `atm:${atmosphericContext.cloudCover?.toFixed(0)},${atmosphericContext.solarRadiation?.toFixed(0)},${atmosphericContext.boundaryLayerHeight?.toFixed(0)},${atmosphericContext.liftedIndex?.toFixed(0)},${atmosphericContext.convectiveInhibition?.toFixed(0)}`
      : '';
    const fingerprint = parts.sort().join('|') + atmKey;

    if (fingerprint === lastScoringFingerprintRef.current) return;
    lastScoringFingerprintRef.current = fingerprint;

    startTransition(() => {
      const now = new Date();

      // Group current readings by zone
      const zoneReadings = new Map<MicroZoneId, NormalizedReading[]>();
      for (const [stationId, reading] of currentReadings) {
        const zoneId = stationToZone.get(stationId);
        if (!zoneId) continue;
        const list = zoneReadings.get(zoneId) || [];
        list.push(reading);
        zoneReadings.set(zoneId, list);
      }

      // ── Enrich atmospheric context with REAL solar radiation ──
      // When stations have measured solarRadiation (from MeteoGalicia/WU sensors),
      // use that instead of Open-Meteo forecast model data. Real data is more
      // accurate for thermal scoring and critical for storm shadow detection.
      let effectiveAtmospheric = atmosphericContext;
      const allSolarReadings: number[] = [];
      for (const [, reading] of currentReadings) {
        if (reading.solarRadiation !== null && reading.solarRadiation >= 0) {
          allSolarReadings.push(reading.solarRadiation);
        }
      }
      if (allSolarReadings.length > 0) {
        const avgSolar = allSolarReadings.reduce((a, b) => a + b, 0) / allSolarReadings.length;
        const realCloudCover = estimateCloudCover(avgSolar);
        effectiveAtmospheric = {
          cloudCover: realCloudCover,
          solarRadiation: avgSolar,
          // Keep model-derived params from Open-Meteo (no station sensors for these)
          cape: atmosphericContext?.cape ?? null,
          boundaryLayerHeight: atmosphericContext?.boundaryLayerHeight ?? null,
          liftedIndex: atmosphericContext?.liftedIndex ?? null,
          convectiveInhibition: atmosphericContext?.convectiveInhibition ?? null,
          fetchedAt: new Date(),
        } satisfies AtmosphericContext;
      }

      // Score all rules (with ΔT context + atmospheric context if available)
      const scores = scoreAllRules(rules, zoneReadings, now, dailyContext ?? undefined, effectiveAtmospheric);
      setRuleScores(scores);

      // Compute zone alerts
      const alerts = computeZoneAlerts(scores);
      setZoneAlerts(alerts);

      // Detect propagation
      const events = detectPropagation(zones, readingHistory, stationToZone);
      setPropagationEvents(events);

      // ── Tendency detection for each zone ──────────────────
      const tendencies = new Map<MicroZoneId, TendencySignal>();
      for (const zone of zones) {
        const currentZoneReadings = zoneReadings.get(zone.id) || [];

        // Build history arrays for the zone:
        // 1. Station-based history (from weatherStore.readingHistory)
        const stationHistories: NormalizedReading[][] = [];
        for (const [stationId, stationHistory] of readingHistory) {
          if (stationToZone.get(stationId) === zone.id) {
            stationHistories.push(stationHistory);
          }
        }

        // 2. Open-Meteo backfill history (model data, always available)
        const openMeteoHistory = openMeteoHistoryRef.current.get(zone.id);
        if (openMeteoHistory && openMeteoHistory.length > 0) {
          stationHistories.push(openMeteoHistory);
        }

        const signal = detectTendency(
          zone.id,
          currentZoneReadings,
          stationHistories,
          dailyContext,
          now
        );
        tendencies.set(zone.id, signal);
      }
      setTendencySignals(tendencies);

      // ── Humidity cross-validation for each zone ─────────
      const humidityResults = new Map<MicroZoneId, HumidityAssessment>();
      for (const zone of zones) {
        const zoneR = zoneReadings.get(zone.id) || [];
        if (zoneR.length === 0) continue;

        // Get zone average temperature for context
        const temps = zoneR.filter((r) => r.temperature != null).map((r) => r.temperature!);
        const avgTemp = temps.length > 0 ? temps.reduce((a, b) => a + b, 0) / temps.length : null;

        const assessment = analyzeZoneHumidity(zoneR, effectiveAtmospheric, avgTemp);
        humidityResults.set(zone.id, assessment);
      }
      setHumidityAssessments(humidityResults);
    });
  }, [
    currentReadings, stationToZone, rules, readingHistory, zones, dailyContext, atmosphericContext,
    setRuleScores, setZoneAlerts, setPropagationEvents, setTendencySignals, setHumidityAssessments,
    startTransition,
  ]);

  // ── Forecast fetching ──────────────────────────────────
  const fetchForecast = useCallback(async () => {
    try {
      const forecast = await fetchForecastForZones(zones);
      setZoneForecast(forecast);

      // Score forecast points to generate forecast alerts
      const alerts: ForecastAlert[] = [];
      for (const [zoneId, points] of forecast) {
        for (const point of points) {
          // Create a fake reading to score against rules
          const fakeReading: NormalizedReading = {
            stationId: `forecast_${zoneId}`,
            timestamp: point.timestamp,
            temperature: point.temperature,
            humidity: point.humidity,
            windSpeed: point.windSpeed,
            windGust: null,
            windDirection: point.windDirection,
            precipitation: null,
            solarRadiation: null,
          };

          for (const rule of rules) {
            if (!rule.enabled || rule.expectedWind.zone !== zoneId) continue;
            const result = scoreRule(rule, [fakeReading], point.timestamp, dailyContext ?? undefined);
            if (result.score >= 50) {
              alerts.push({
                ruleId: rule.id,
                zoneId,
                expectedTime: point.timestamp,
                score: result.score,
              });
            }
          }
        }
      }

      // Deduplicate: keep highest score per rule per hour
      const dedupMap = new Map<string, ForecastAlert>();
      for (const alert of alerts) {
        const hourKey = `${alert.ruleId}_${alert.zoneId}_${alert.expectedTime.getHours()}`;
        const existing = dedupMap.get(hourKey);
        if (!existing || alert.score > existing.score) {
          dedupMap.set(hourKey, alert);
        }
      }

      setForecastAlerts(Array.from(dedupMap.values()));
    } catch (err) {
      console.warn('[ThermalAnalysis] Forecast error:', err);
    }
  }, [zones, rules, dailyContext, setZoneForecast, setForecastAlerts]);

  // Ref keeps latest callback so interval never needs re-creation
  const fetchForecastRef = useRef(fetchForecast);
  fetchForecastRef.current = fetchForecast;

  // Fetch forecast on mount and every 30 minutes
  useEffect(() => {
    fetchForecastRef.current();
    const id = setInterval(() => fetchForecastRef.current(), FORECAST_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

}
