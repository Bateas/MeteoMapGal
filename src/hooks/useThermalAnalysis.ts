import { useEffect, useCallback, useRef } from 'react';
import { useWeatherStore } from '../store/weatherStore';
import { useThermalStore } from '../store/thermalStore';
import { scoreAllRules, computeZoneAlerts } from '../services/thermalScoringEngine';
import { detectPropagation } from '../services/windPropagationDetector';
import { fetchForecastForZones } from '../api/openMeteoClient';
import type { MicroZoneId, ForecastAlert } from '../types/thermal';
import type { NormalizedReading } from '../types/station';
import { scoreRule } from '../services/thermalScoringEngine';

const FORECAST_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Connects weather data → scoring engine → thermal store.
 * Call this once at the AppShell level.
 */
export function useThermalAnalysis() {
  const stations = useWeatherStore((s) => s.stations);
  const currentReadings = useWeatherStore((s) => s.currentReadings);
  const readingHistory = useWeatherStore((s) => s.readingHistory);
  const lastFetchTime = useWeatherStore((s) => s.lastFetchTime);

  const zones = useThermalStore((s) => s.zones);
  const rules = useThermalStore((s) => s.rules);
  const setRuleScores = useThermalStore((s) => s.setRuleScores);
  const setZoneAlerts = useThermalStore((s) => s.setZoneAlerts);
  const setPropagationEvents = useThermalStore((s) => s.setPropagationEvents);
  const setStationToZone = useThermalStore((s) => s.setStationToZone);
  const stationToZone = useThermalStore((s) => s.stationToZone);
  const setZoneForecast = useThermalStore((s) => s.setZoneForecast);
  const setForecastAlerts = useThermalStore((s) => s.setForecastAlerts);

  const forecastTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // ── Re-score on every data update ──────────────────────
  useEffect(() => {
    if (stationToZone.size === 0 || currentReadings.size === 0) return;

    // Group current readings by zone
    const zoneReadings = new Map<MicroZoneId, NormalizedReading[]>();
    for (const [stationId, reading] of currentReadings) {
      const zoneId = stationToZone.get(stationId);
      if (!zoneId) continue;
      const list = zoneReadings.get(zoneId) || [];
      list.push(reading);
      zoneReadings.set(zoneId, list);
    }

    // Score all rules
    const scores = scoreAllRules(rules, zoneReadings);
    setRuleScores(scores);

    // Compute zone alerts
    const alerts = computeZoneAlerts(scores);
    setZoneAlerts(alerts);

    // Detect propagation
    const events = detectPropagation(zones, readingHistory, stationToZone);
    setPropagationEvents(events);
  }, [
    currentReadings, stationToZone, rules, readingHistory, zones,
    setRuleScores, setZoneAlerts, setPropagationEvents,
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
            windDirection: point.windDirection,
            precipitation: null,
          };

          for (const rule of rules) {
            if (!rule.enabled || rule.expectedWind.zone !== zoneId) continue;
            const result = scoreRule(rule, [fakeReading], point.timestamp);
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
  }, [zones, rules, setZoneForecast, setForecastAlerts]);

  // Fetch forecast on mount and every 30 minutes
  useEffect(() => {
    fetchForecast();

    forecastTimerRef.current = setInterval(fetchForecast, FORECAST_INTERVAL_MS);
    return () => {
      if (forecastTimerRef.current) clearInterval(forecastTimerRef.current);
    };
  }, [fetchForecast]);

  // Also refresh forecast when lastFetchTime changes (data update)
  useEffect(() => {
    if (lastFetchTime) {
      // Don't re-fetch forecast every 10min, only re-score
      // Forecast re-fetch is on its own 30min timer
    }
  }, [lastFetchTime]);
}
