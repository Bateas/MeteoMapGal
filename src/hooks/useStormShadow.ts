/**
 * useStormShadow — Connects storm shadow detection to the weather/lightning stores.
 *
 * Runs on every reading update when solar-equipped stations are present.
 * Cross-references solar radiation drops with lightning data to detect,
 * locate, and track convective storm cells approaching Castrelo.
 *
 * Output stored in Zustand for consumption by alert system + UI overlays.
 */

import { useEffect, useRef, useMemo } from 'react';
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { useWeatherStore } from '../store/weatherStore';
import { useLightningStore } from './useLightningData';
import { useSectorStore } from '../store/sectorStore';
import {
  buildSolarSnapshots,
  buildWindAnomalies,
  detectStormShadow,
  computeSolarIndex,
  type SolarSnapshot,
  type StormShadow,
  type LightningContext,
  type WindAnomaly,
} from '../services/stormShadowDetector';
import { distanceKm } from '../api/lightningClient';

// ── Store ────────────────────────────────────────────────

interface StormShadowState {
  /** Current solar snapshots (stations with radiation data) */
  snapshots: SolarSnapshot[];
  /** Wind anomalies detected across all stations */
  windAnomalies: WindAnomaly[];
  /** Detected storm shadow (null = no localized shadow) */
  stormShadow: StormShadow | null;
  /** Aggregate solar index 0-100 (-1 = no data) */
  solarIndex: number;
  /** Number of stations contributing solar data */
  solarStationCount: number;

  setSnapshots: (s: SolarSnapshot[]) => void;
  setWindAnomalies: (wa: WindAnomaly[]) => void;
  setStormShadow: (ss: StormShadow | null) => void;
  setSolarIndex: (idx: number) => void;
  setSolarStationCount: (n: number) => void;
}

export const useStormShadowStore = create<StormShadowState>()(
  devtools(
    (set) => ({
      snapshots: [],
      windAnomalies: [],
      stormShadow: null,
      solarIndex: -1,
      solarStationCount: 0,

      setSnapshots: (snapshots) => set({ snapshots }),
      setWindAnomalies: (windAnomalies) => set({ windAnomalies }),
      setStormShadow: (stormShadow) => set({ stormShadow }),
      setSolarIndex: (solarIndex) => set({ solarIndex }),
      setSolarStationCount: (solarStationCount) => set({ solarStationCount }),
    }),
    { name: 'storm-shadow-store' },
  ),
);

// ── Hook ─────────────────────────────────────────────────

export function useStormShadow() {
  const stations = useWeatherStore((s) => s.stations);
  const currentReadings = useWeatherStore((s) => s.currentReadings);
  const readingsEpoch = useWeatherStore((s) => s.readingsEpoch);
  const strikes = useLightningStore((s) => s.strikes);
  const activeSector = useSectorStore((s) => s.activeSector);

  const { setSnapshots, setWindAnomalies, setStormShadow, setSolarIndex, setSolarStationCount } =
    useStormShadowStore(useShallow((s) => ({
      setSnapshots: s.setSnapshots,
      setWindAnomalies: s.setWindAnomalies,
      setStormShadow: s.setStormShadow,
      setSolarIndex: s.setSolarIndex,
      setSolarStationCount: s.setSolarStationCount,
    })));

  // Keep previous readings for drop-rate computation
  const prevReadingsRef = useRef<Map<string, import('../types/station').NormalizedReading>>(new Map());

  // Target point: sector center [lon, lat]
  const targetPoint: [number, number] = useMemo(
    () => activeSector.center,
    [activeSector.center],
  );

  useEffect(() => {
    if (stations.length === 0 || currentReadings.size === 0) return;

    // Check if ANY station has solar radiation data
    let hasSolarData = false;
    for (const [, r] of currentReadings) {
      if (r.solarRadiation !== null) {
        hasSolarData = true;
        break;
      }
    }

    // ── Wind anomalies: ALL stations, not just solar-equipped ──
    // Storms generate their own wind (gust fronts, outflow, direction shifts).
    // This uses all 40 stations as sensors, vastly expanding coverage.
    const windAnoms = buildWindAnomalies(stations, currentReadings, prevReadingsRef.current);
    setWindAnomalies(windAnoms);

    if (!hasSolarData) {
      setSolarStationCount(0);
      setSolarIndex(-1);
      setSnapshots([]);
      setStormShadow(null);
      // Update previous readings even when no solar data (for wind anomaly tracking)
      prevReadingsRef.current = new Map(currentReadings);
      return;
    }

    // Build solar snapshots comparing current vs previous readings
    const snapshots = buildSolarSnapshots(stations, currentReadings, prevReadingsRef.current);

    // Update previous readings for next cycle
    prevReadingsRef.current = new Map(currentReadings);

    setSolarStationCount(snapshots.length);
    setSnapshots(snapshots);

    // Compute aggregate solar index
    const index = computeSolarIndex(snapshots);
    setSolarIndex(index);

    // Build lightning context for cross-reference
    let lightningCtx: LightningContext | undefined;
    if (snapshots.some((s) => s.isShadowed) && strikes.length > 0) {
      // Find shadow centroid
      const shadowed = snapshots.filter((s) => s.isShadowed);
      if (shadowed.length > 0) {
        const centerLon = shadowed.reduce((sum, s) => sum + s.lon, 0) / shadowed.length;
        const centerLat = shadowed.reduce((sum, s) => sum + s.lat, 0) / shadowed.length;

        // Count strikes within 30km of shadow centroid
        const recentWindow = Date.now() - 30 * 60 * 1000;
        const nearStrikes = strikes.filter((s) => {
          if (s.timestamp < recentWindow) return false;
          return distanceKm(s.lat, s.lon, centerLat, centerLon) < 30;
        });

        if (nearStrikes.length > 0) {
          const avgDist =
            nearStrikes.reduce((sum, s) => sum + distanceKm(s.lat, s.lon, centerLat, centerLon), 0) /
            nearStrikes.length;

          // Bearing from shadow center to strike centroid
          const strikeCenterLat = nearStrikes.reduce((s, st) => s + st.lat, 0) / nearStrikes.length;
          const strikeCenterLon = nearStrikes.reduce((s, st) => s + st.lon, 0) / nearStrikes.length;
          const dLon = (strikeCenterLon - centerLon) * Math.PI / 180;
          const y = Math.sin(dLon) * Math.cos(strikeCenterLat * Math.PI / 180);
          const x =
            Math.cos(centerLat * Math.PI / 180) * Math.sin(strikeCenterLat * Math.PI / 180) -
            Math.sin(centerLat * Math.PI / 180) * Math.cos(strikeCenterLat * Math.PI / 180) * Math.cos(dLon);
          const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;

          lightningCtx = {
            strikesNearShadow: nearStrikes.length,
            avgDistanceKm: avgDist,
            strikeBearing: bearing,
          };
        }
      }
    }

    // Run storm shadow detection with ALL three cross-references:
    // solar radiation + lightning + wind anomalies
    const shadow = detectStormShadow(snapshots, targetPoint, lightningCtx, windAnoms);
    setStormShadow(shadow);
  }, [
    readingsEpoch, stations, currentReadings, strikes, targetPoint,
    setSnapshots, setWindAnomalies, setStormShadow, setSolarIndex, setSolarStationCount,
  ]);
}
