/**
 * useAirspace — orchestrates ENAIRE data fetching and evaluation.
 *
 * Reads the active sector, fetches UAS zones (24h cache) and NOTAMs
 * (30min cache), evaluates airspace restrictions, and stores results
 * in airspaceStore. Returns the current AirspaceCheck.
 *
 * Only while alphaMode is on. Everything that shows this data — the drone
 * tab, the airspace overlay, the drone alert — is alphaMode-only, but the
 * fetch ran for every visitor: four ENAIRE queries and a NOTAM poll every
 * 30 minutes for a tab almost nobody opens. Turning alphaMode on fetches at
 * once; turning it off keeps what was fetched and stops polling.
 *
 * Zones and NOTAMs are asked separately: if ENAIRE gives one and not the other,
 * the part it gave is still shown and the missing one is marked in
 * airspaceStore.missing, so the tab says «sin dato» instead of «sin restricciones».
 */

import { useEffect, useRef, useCallback } from 'react';
import { useSectorStore } from '../store/sectorStore';
import { useUIStore } from '../store/uiStore';
import { useAirspaceStore } from '../store/airspaceStore';
import { fetchUasZones, fetchActiveNotams, bboxFromCenter } from '../api/enaireClient';
import { evaluateAirspace } from '../services/airspaceService';
import type { AirspaceCheck } from '../services/airspaceService';
import { useVisibilityPolling } from './useVisibilityPolling';

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
  const alphaMode = useUIStore((s) => s.alphaMode);
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const sectorCenter = useSectorStore((s) => s.activeSector.center);
  const sectorRadiusKm = useSectorStore((s) => s.activeSector.radiusKm);
  const check = useAirspaceStore((s) => s.check);

  const setZones = useAirspaceStore((s) => s.setZones);
  const setNotams = useAirspaceStore((s) => s.setNotams);
  const setCheck = useAirspaceStore((s) => s.setCheck);
  const setLoading = useAirspaceStore((s) => s.setLoading);
  const setError = useAirspaceStore((s) => s.setError);
  const setMissing = useAirspaceStore((s) => s.setMissing);
  const reset = useAirspaceStore((s) => s.reset);

  const prevSectorId = useRef(sectorId);

  // Reset on sector change
  useEffect(() => {
    if (prevSectorId.current !== sectorId) {
      reset();
      prevSectorId.current = sectorId;
    }
  }, [sectorId, reset]);

  // Fetch zones + NOTAMs and evaluate. The fetch times and the check are read from the store
  // when it runs, not from the render: as dependencies, every result made a new callback and
  // the effect below ran it again, and with a part ENAIRE keeps failing that never stopped.
  const fetchAndEvaluate = useCallback(async () => {
    const bbox = bboxFromCenter(sectorCenter, sectorRadiusKm);
    const now = Date.now();
    const { lastZoneFetch, lastNotamFetch, check: current } = useAirspaceStore.getState();

    const needZones = now - lastZoneFetch > ZONE_CACHE_TTL;
    const needNotams = now - lastNotamFetch > NOTAM_CACHE_TTL;

    if (!needZones && !needNotams && current) return;

    setLoading(true);
    setError(null);

    try {
      const stored = useAirspaceStore.getState();
      const [zonesR, notamsR] = await Promise.allSettled([
        needZones ? fetchUasZones(bbox) : Promise.resolve(stored.zones),
        needNotams ? fetchActiveNotams(bbox) : Promise.resolve(stored.notams),
      ]);

      const missing = {
        zones: zonesR.status === 'rejected' || (!needZones && stored.missing.zones),
        notams: notamsR.status === 'rejected' || (!needNotams && stored.missing.notams),
      };
      const zones = zonesR.status === 'fulfilled' ? zonesR.value : [];
      const notams = notamsR.status === 'fulfilled' ? notamsR.value : [];

      if (needZones && zonesR.status === 'fulfilled') setZones(zones);
      if (needNotams && notamsR.status === 'fulfilled') setNotams(notams);
      setMissing(missing);
      if (missing.zones || missing.notams) setError('ENAIRE no responde');

      // A failed part counts as empty here; the tab reads `missing` and never calls that «sin restricciones».
      setCheck(evaluateAirspace(sectorCenter, sectorRadiusKm, zones, notams));
    } catch (err) {
      console.warn('[useAirspace] Error:', err);
      setError(err instanceof Error ? err.message : 'Error fetching airspace data');
    } finally {
      setLoading(false);
    }
  }, [sectorCenter, sectorRadiusKm, setZones, setNotams, setCheck, setLoading, setError, setMissing]);

  // Initial fetch on sector change, and as soon as alphaMode turns on
  useEffect(() => {
    if (!alphaMode) return;
    fetchAndEvaluate();
  }, [fetchAndEvaluate, alphaMode]);

  // Visibility-aware NOTAM polling — pauses when tab is hidden
  useVisibilityPolling(fetchAndEvaluate, NOTAM_POLL_INTERVAL, alphaMode, 10_000); // Stagger: 10s

  return check ?? EMPTY_CHECK;
}
