/**
 * AemetVisibilityHalo — works out where the official visibility sensors say there is fog. It draws nothing:
 * FogOverlay paints these points with its own, one look (see fogField).
 *
 * Reactive philosophy:
 * - Only when ≥1 of the official visibility sensors reports vis < 2km
 *   (data-confirmed fog, not modeled).
 * - Each patch is anchored to that station's actual altitude. Points more
 *   than 50m above the station are skipped — niebla is a cold-air-pool
 *   phenomenon, never on hilltops (user requirement).
 * - Coastal stations (≤50m altitude) extend over water; interior
 *   stations don't (no advective component to fall back on).
 */

import { memo, useEffect, useState, useMemo, useRef } from 'react';
import { loadElevationSampler, type ElevationAt } from '../../api/demElevation';
import { useWeatherStore } from '../../store/weatherStore';
import {
  haloRadiusKm,
  densityForCell,
  haloBbox,
  HALO_VIS_THRESHOLD_KM,
} from '../../services/visibilityHaloService';
import {
  isVisibilityFresh,
  VISIBILITY_STALE_CHECK_INTERVAL_MS,
} from '../../services/visibilityFreshness';
import { fogLattice, fogPoint, useFogFieldStore, type FogPoint } from './fogField';

type FogStation = { id: string; name: string; lat: number; lon: number; vis: number };

/**
 * Ground altitude comes from the DEM tiles read directly (demElevation), never
 * from MapLibre terrain (terrain made every pointer move and every marker read
 * pixels back from the GPU). Sea reads as bathymetry: at or below 0 m it is
 * handed to the service as water (null), so its "water only for coastal
 * stations" rule applies — terrain never answered null, so it never did.
 * A tile that could not be loaded is unknown and is not painted.
 */
export function buildHaloPoints(elevAt: ElevationAt, stations: FogStation[]): FogPoint[] {
  const points: FogPoint[] = [];
  for (const s of stations) {
    const radius = haloRadiusKm(s.vis);
    if (radius <= 0) continue;
    const stationRaw = elevAt(s.lon, s.lat);
    if (stationRaw === null) continue;
    const stationElev = Math.max(0, stationRaw);

    for (const { lng, lat } of fogLattice(haloBbox(s.lat, s.lon, radius))) {
      // Equirectangular distance (good enough at <10km)
      const dLat = (lat - s.lat) * 111;
      const dLon = (lng - s.lon) * 111 * Math.cos((s.lat * Math.PI) / 180);
      const dKm = Math.hypot(dLat, dLon);
      if (dKm > radius) continue;

      const cellRaw = elevAt(lng, lat);
      if (cellRaw === null) continue;
      const cellElev = cellRaw <= 0 ? null : cellRaw;
      const density = densityForCell(dKm, radius, cellElev, stationElev, s.vis);
      if (density === 0) continue;

      points.push(fogPoint(lng, lat, density));
    }
  }
  return points;
}

function AemetVisibilityHaloInner() {
  const visibilityReadings = useWeatherStore((s) => s.visibilityReadings);
  const setSensorPoints = useFogFieldStore((s) => s.setSensorPoints);
  /** Build sequence: a slower older build must not overwrite a newer one. */
  const buildSeqRef = useRef(0);

  // Age is time-dependent but the store only pushes on a successful AEMET
  // poll — while AEMET is down nothing re-renders this component, so fog
  // built from the last reading would sit on the map forever. Tick so the
  // age check runs on its own clock and the fog can fade out by itself.
  const [freshnessTick, setFreshnessTick] = useState(0);
  useEffect(() => {
    const i = setInterval(
      () => setFreshnessTick((t) => t + 1),
      VISIBILITY_STALE_CHECK_INTERVAL_MS,
    );
    return () => clearInterval(i);
  }, []);

  // Filter visibilityReadings → list of stations with vis<threshold.
  // Stale readings are skipped: this claims "AEMET is measuring fog HERE,
  // right now", which a frozen value from a dead poll cannot back.
  const fogStations = useMemo(() => {
    const out: FogStation[] = [];
    const now = Date.now();
    for (const v of visibilityReadings.values()) {
      if (!isVisibilityFresh(v, now)) continue;
      if (v.visibility < HALO_VIS_THRESHOLD_KM) {
        out.push({ id: v.stationId, name: v.name, lat: v.lat, lon: v.lon, vis: v.visibility });
      }
    }
    return out;
    // freshnessTick intentionally re-runs the age check over time
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibilityReadings, freshnessTick]);

  // Rebuild when readings change. Tied to length + visibility values
  // so we don't spam re-renders on no-op map prop changes.
  const fogStationsKey = fogStations
    .map((s) => `${s.id}:${s.vis.toFixed(2)}`)
    .sort()
    .join('|');

  useEffect(() => {
    const seq = ++buildSeqRef.current;
    if (fogStations.length === 0) {
      setSensorPoints([]);
      return;
    }
    // Only the DEM tiles around the reporting stations (cached across builds).
    void loadElevationSampler(
      fogStations.map((s) => haloBbox(s.lat, s.lon, haloRadiusKm(s.vis))),
    ).then((elevAt) => {
      if (seq !== buildSeqRef.current) return; // a newer build is on its way
      setSensorPoints(buildHaloPoints(elevAt, fogStations));
    });
    // fogStationsKey gates the rebuild; the closure carries the stations
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fogStationsKey, setSensorPoints]);

  useEffect(() => () => setSensorPoints([]), [setSensorPoints]);

  return null;
}

export const AemetVisibilityHalo = memo(AemetVisibilityHaloInner);
