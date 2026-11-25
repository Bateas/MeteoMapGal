import { useEffect, useCallback, useRef, useTransition } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useWeatherStore } from '../store/weatherStore';
import { useThermalStore } from '../store/thermalStore';
import { detectTendency } from '../services/tendencyDetector';
import {
  fetchDailyContextForEmbalse,
  fetchAtmosphericContextForEmbalse,
  fetchOpenMeteoHistory,
} from '../api/openMeteoClient';
import type { MicroZoneId, TendencySignal } from '../types/thermal';
import type { NormalizedReading } from '../types/station';
import { MICRO_ZONES } from '../config/thermalZones';
import { useVisibilityPolling } from './useVisibilityPolling';
import { useSectorStore } from '../store/sectorStore';

const ATMOSPHERIC_INTERVAL_MS = 15 * 60 * 1000;

/** Read at the moment an answer lands, not when the request left. */
const stillEmbalse = () => useSectorStore.getState().activeSector.id === 'embalse';

/**
 * Keeps the Embalse thermal context of the store up to date: what useSpotScoring reads for the card
 * of Castrelo (ΔT, atmosphere, tendency) and the wind status of Condiciones.
 * Call this once at the AppShell level.
 *
 * Data flow:
 *   1. Station readings + reading history → tendency detector → tendency signals (precursor warnings)
 *   2. Station readings → wind status (consensus, trend, coherence, stability)
 *   3. Open-Meteo daily → ΔT
 *   4. Open-Meteo atmospheric → cloud/radiation/CAPE context
 *   5. Open-Meteo 24h history → backfill for tendency time series
 *
 * The old rule scoring (zone alerts) and the wind status were removed with the V3: their only readers
 * were the Térmico tab and the zone layers of the map, both cut.
 */
export function useThermalAnalysis() {
  // Thermal analysis is Embalse-only — skip all Open-Meteo fetches for other sectors
  const isEmbalse = useSectorStore((s) => s.activeSector.id === 'embalse');

  const { stations, currentReadings, readingHistory } = useWeatherStore(
    useShallow((s) => ({
      stations: s.stations,
      currentReadings: s.currentReadings,
      readingHistory: s.readingHistory,
    }))
  );

  const {
    zones, dailyContext, stationToZone,
    setTendencySignals, setStationToZone, setDailyContext,
    setAtmosphericContext, clearEmbalseContext,
  } = useThermalStore(
    useShallow((s) => ({
      zones: s.zones,
      dailyContext: s.dailyContext,
      stationToZone: s.stationToZone,
      setTendencySignals: s.setTendencySignals,
      setStationToZone: s.setStationToZone,
      setDailyContext: s.setDailyContext,
      setAtmosphericContext: s.setAtmosphericContext,
      clearEmbalseContext: s.clearEmbalseContext,
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

  // ── Out of the Embalse its context goes ──
  // ΔT (Ourense), atmosphere and tendencies describe the reservoir valley. Kept after a
  // switch to the Rías they fed the Rías spots: useSpotScoring built a thermal probability
  // from them (the card read «Térmica 41 % prob» in Cesantes and centro-ría), the engine
  // could boost the wind of the thermal spots by up to x1.5, and the forecast panel showed
  // the Embalse «ΔT hoy». Opening the app straight in the Rías never had them.
  useEffect(() => {
    if (!isEmbalse) clearEmbalseContext();
  }, [isEmbalse, clearEmbalseContext]);

  // ── Fetch daily context (ΔT) on mount — Embalse only ──
  // An answer that lands after the switch to the Rías is dropped (same reason as above).
  useEffect(() => {
    if (!isEmbalse) return;
    fetchDailyContextForEmbalse().then((ctx) => {
      if (!stillEmbalse()) return;
      setDailyContext(ctx);
    }).catch((err) => console.warn('[ThermalAnalysis] Daily context error:', err));
  }, [isEmbalse, setDailyContext]);

  // ── Fetch atmospheric context (cloud/radiation/CAPE) — Embalse only ──
  const fetchAtmospheric = useCallback(() => {
    if (!isEmbalse) return;
    fetchAtmosphericContextForEmbalse().then((ctx) => {
      if (!stillEmbalse()) return;
      setAtmosphericContext(ctx);
    }).catch((err) => console.warn('[ThermalAnalysis] Atmospheric context error:', err));
  }, [isEmbalse, setAtmosphericContext]);

  // Visibility-aware polling — pauses atmospheric fetches when tab is hidden. Off outside the
  // Embalse, so coming back asks again (8 s later) instead of waiting out the 15 minutes
  // with the context cleared.
  useVisibilityPolling(fetchAtmospheric, ATMOSPHERIC_INTERVAL_MS, isEmbalse, 8_000); // Stagger: 8s

  // ── Fetch Open-Meteo 24h history for tendency backfill — Embalse only ──
  // Station-based history may be sparse (only 10min readings since app opened).
  // Open-Meteo provides model data for the last 24h, giving the tendency detector
  // a complete time series to compute temperature rise rates, humidity trends, etc.
  //
  // AbortController guards against the in-flight fetch landing after the user
  // switches away from Embalse mid-fetch (race-condition audit — closes the last
  // hook in the cluster after useForecastTimeline/useSurfMarineData).
  // 6 parallel zone fetches × ~1-2s each = up to ~5s exposure window per cycle.
  useEffect(() => {
    if (!isEmbalse) return;
    const controller = new AbortController();

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

      if (controller.signal.aborted) return; // sector switched mid-fetch — drop stale

      for (const result of results) {
        if (result.status === 'fulfilled') {
          historyMap.set(result.value.id, result.value.readings);
        }
      }

      openMeteoHistoryRef.current = historyMap;
    }

    // Defer 8s so daily context + atmospheric context + timeline can use the Open-Meteo queue first
    const timer = setTimeout(() => {
      fetchHistory();
    }, 8_000);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [isEmbalse]);

  // ── Tendency detection + wind status on every data update — Embalse only ──
  // Wrapped in startTransition to keep map/UI responsive.
  // Fingerprint skips the work when readings haven't changed meaningfully.
  useEffect(() => {
    if (!isEmbalse) return;
    if (stationToZone.size === 0 || currentReadings.size === 0) return;

    // Build fingerprint from key fields (rounded to avoid float noise)
    const parts: string[] = [];
    for (const [id, r] of currentReadings) {
      parts.push(
        `${id}:${r.windSpeed?.toFixed(1) ?? '-'},${r.windDirection?.toFixed(0) ?? '-'},${r.temperature?.toFixed(1) ?? '-'},${r.humidity?.toFixed(0) ?? '-'},${r.solarRadiation?.toFixed(0) ?? '-'}`
      );
    }
    const fingerprint = parts.sort().join('|');

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

    });
  }, [
    isEmbalse, currentReadings, stationToZone, readingHistory, zones, dailyContext,
    setTendencySignals,
    startTransition, stations,
  ]);
}
