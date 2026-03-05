/**
 * useAirspace — orchestrates ENAIRE data fetching and evaluation.
 *
 * Reads the active sector, fetches UAS zones (24h cache) and NOTAMs
 * (30min cache), evaluates airspace restrictions, and stores results
 * in airspaceStore. Returns the current AirspaceCheck.
 */

import { useEffect, useRef } from 'react';
import { useSectorStore } from '../store/sectorStore';
import { useAirspaceStore } from '../store/airspaceStore';
import { fetchUasZones, fetchActiveNotams, bboxFromCenter } from '../api/enaireClient';
import { evaluateAirspace } from '../services/airspaceService';
import type { AirspaceCheck } from '../services/airspaceService';

const ZONE_CACHE_TTL = 24 * 60 * 60 * 1000;  // 24h
const NOTAM_CACHE_TTL = 30 * 60 * 1000;       // 30min
const NOTAM_POLL_INTERVAL = 30 * 60 * 1000;   // 30min

const EMPTY_CHECK: AirspaceCheck = {
  restricted: false,
  severity: 'none',
  zones: [],
  notams: [],
};

export function useAirspace(): AirspaceCheck {
  const activeSector = useSectorStore((s) => s.activeSector);
  const check = useAirspaceStore((s) => s.check);
  const lastZoneFetch = useAirspaceStore((s) => s.lastZoneFetch);
  const lastNotamFetch = useAirspaceStore((s) => s.lastNotamFetch);

  const setZones = useAirspaceStore((s) => s.setZones);
  const setNotams = useAirspaceStore((s) => s.setNotams);
  const setCheck = useAirspaceStore((s) => s.setCheck);
  const setLoading = useAirspaceStore((s) => s.setLoading);
  const setError = useAirspaceStore((s) => s.setError);
  const reset = useAirspaceStore((s) => s.reset);

  const prevSectorId = useRef(activeSector.id);

  // Reset on sector change
  useEffect(() => {
    if (prevSectorId.current !== activeSector.id) {
      reset();
      prevSectorId.current = activeSector.id;
    }
  }, [activeSector.id, reset]);

  // Fetch zones + NOTAMs and evaluate
  useEffect(() => {
    let cancelled = false;

    async function fetchAndEvaluate() {
      const bbox = bboxFromCenter(activeSector.center, activeSector.radiusKm);
      const now = Date.now();

      const needZones = now - lastZoneFetch > ZONE_CACHE_TTL;
      const needNotams = now - lastNotamFetch > NOTAM_CACHE_TTL;

      if (!needZones && !needNotams && check) return;

      setLoading(true);
      setError(null);

      try {
        const [zones, notams] = await Promise.all([
          needZones ? fetchUasZones(bbox) : Promise.resolve(useAirspaceStore.getState().zones),
          needNotams ? fetchActiveNotams(bbox) : Promise.resolve(useAirspaceStore.getState().notams),
        ]);

        if (cancelled) return;

        if (needZones) setZones(zones);
        if (needNotams) setNotams(notams);

        const result = evaluateAirspace(
          activeSector.center,
          activeSector.radiusKm,
          zones,
          notams,
        );

        setCheck(result);
      } catch (err) {
        if (!cancelled) {
          console.warn('[useAirspace] Error:', err);
          setError(err instanceof Error ? err.message : 'Error fetching airspace data');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchAndEvaluate();

    // Poll NOTAMs every 30 min
    const interval = setInterval(fetchAndEvaluate, NOTAM_POLL_INTERVAL);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeSector.id, activeSector.center, activeSector.radiusKm, lastZoneFetch, lastNotamFetch, check, setZones, setNotams, setCheck, setLoading, setError]);

  return check ?? EMPTY_CHECK;
}
