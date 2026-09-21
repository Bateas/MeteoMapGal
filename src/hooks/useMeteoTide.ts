/**
 * Meteorological tide for the port a spot already uses for its tide table.
 *
 * Wires together two things the app already had and never crossed: the sea
 * level a REDMAR gauge measures (`buoyStore`) and the astronomical height the
 * IHM predicted for that same port (`tideClient`). The subtraction — and every
 * reason to refuse to answer — lives in `meteoTideService`; this hook only
 * sources the two halves and keeps the fetching honest.
 */

import { useEffect, useMemo, useState } from 'react';
import { RIAS_TIDE_STATIONS, fetchTides48h, fetchTidePredictions } from '../api/tideClient';
import type { BuoyReading } from '../api/buoyClient';
import { useBuoyStore } from '../store/buoyStore';
import { haversineDistance } from '../services/geoUtils';
import { computeMeteoTide, toExtremes } from '../services/meteoTideService';
import type { MeteoTide, TideExtreme } from '../services/meteoTideService';

/** Shared per-day promise cache — see the dedup note inside the effect. */
const tidesByDay = new Map<string, Promise<{
  yesterday: import('../api/tideClient').TidePoint[];
  today: import('../api/tideClient').TidePoint[];
  tomorrow: import('../api/tideClient').TidePoint[];
}>>();

/** Test-only: the per-day cache outlives one test's mocks. */
export function __clearTideCacheForTests(): void {
  tidesByDay.clear();
}

/** Only for `?simsurge`, which is given in centimetres. PORTUS itself
 *  publishes sea level in METRES (its payload says `"unidad":"m"`), and
 *  treating it as centimetres once turned every reading into minus the
 *  astronomical height. */
const CM_PER_M = 100;

/**
 * A gauge further away than this is measuring a different piece of coast.
 * Every ría spot sits well inside it, so the cap only fires on a bad pairing.
 */
export const MAX_GAUGE_DISTANCE_KM = 40;

/**
 * Re-check the reading's age on a clock of our own. Nothing else re-renders
 * this while PORTUS is down, so without the tick a surge computed just before
 * the feed died would sit on screen indefinitely.
 */
const AGE_TICK_MS = 60_000;

export interface TideGauge {
  /** PORTUS/REDMAR station id, as it arrives in `buoyStore.buoys`. */
  buoyStationId: number;
  /** IHM station id for the prediction at that same port. */
  ihmStationId: string;
  lat: number;
  lon: number;
  name: string;
}

/**
 * The only three stations that publish `sea_level`, each paired with the IHM
 * port describing the same water. The pairing is fixed rather than inferred:
 * a residual is only physical when both halves are the same place, so the
 * prediction travels with the GAUGE, never with the spot.
 */
export const SEA_LEVEL_GAUGES: TideGauge[] = [
  { buoyStationId: 3221, ihmStationId: '29', lat: 42.24, lon: -8.73, name: 'Vigo' },
  { buoyStationId: 3223, ihmStationId: '28', lat: 42.41, lon: -8.69, name: 'Marín' },
  { buoyStationId: 3220, ihmStationId: '26', lat: 42.60, lon: -8.77, name: 'Vilagarcía' },
];

/**
 * Nearest gauge to the port the spot already uses for its tide table, among
 * those that are ACTUALLY REPORTING.
 *
 * The liveness check is not defensive padding — it is the whole feature. The
 * Vigo gauge went silent and, because it is the closest one to nearly every
 * Rías spot, the surge line went dark exactly where it mattered while every
 * other part of the app looked healthy. Falling back to the next gauge is
 * physically sound in a way that most fallbacks are not: storm surge is a
 * large-scale field driven by pressure and wind set-up, so the residual
 * measured 18 km away describes the same water. What must NOT travel is the
 * pairing — the substitute gauge brings its OWN astronomical prediction,
 * because subtracting one port's level from another port's table is not
 * surge, it is the difference between two tables.
 *
 * `isLive` is optional so callers that only need the pairing (tests, the
 * unit that maps port to gauge) keep working unchanged.
 */
export function selectGaugeForTideStation(
  tideStationId: string,
  isLive?: (gauge: TideGauge) => boolean,
): TideGauge | null {
  const station = RIAS_TIDE_STATIONS.find((s) => s.id === tideStationId);
  if (!station) return null;

  const candidates = SEA_LEVEL_GAUGES
    .map((gauge) => ({
      gauge,
      km: haversineDistance(station.lat, station.lon, gauge.lat, gauge.lon),
    }))
    .filter((c) => c.km <= MAX_GAUGE_DISTANCE_KM)
    .sort((a, b) => a.km - b.km);

  if (candidates.length === 0) return null;
  if (!isLive) return candidates[0].gauge;

  // Nearest that is reporting; if none is, the nearest one so the caller still
  // gets a pairing and the usual staleness gate decides to stay quiet.
  return candidates.find((c) => isLive(c.gauge))?.gauge ?? candidates[0].gauge;
}

/** What the gauge measured and when, already dug out of the store. */
export interface GaugeLevel {
  /** Metres above the gauge datum, as PORTUS publishes it. */
  m: number;
  at: Date;
}

/**
 * The observed half of the calculation, kept pure so the unit conversion and
 * every missing-data case are testable without React.
 */
export function meteoTideFromGauge(
  observed: GaugeLevel | null,
  extremes: TideExtreme[],
  now: Date = new Date(),
  gaugeName?: string,
): MeteoTide | null {
  if (!observed || extremes.length === 0) return null;
  if (Number.isNaN(observed.at.getTime())) return null;

  const result = computeMeteoTide(observed.m, observed.at, extremes, now);
  if (!result) return null;
  return gaugeName ? { ...result, gaugeName } : result;
}

/** Pull the level out of a store reading, rejecting an unparseable stamp. */
export function gaugeLevelFromReading(reading: BuoyReading | null | undefined): GaugeLevel | null {
  if (!reading || reading.seaLevel == null) return null;
  const at = new Date(reading.timestamp);
  return Number.isNaN(at.getTime()) ? null : { m: reading.seaLevel, at };
}

/**
 * `?simsurge=<cm>` forces the observed level, so the line can be seen on a day
 * when the sea happens to agree with the table. Everything else stays real —
 * the port pairing, the IHM fetch, the interpolation — so what appears on
 * screen is the actual pipeline rather than a mock of it.
 */
function readSimSurgeCm(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('simsurge');
  if (raw == null) return null;
  const cm = Number(raw);
  return Number.isFinite(cm) ? cm : null;
}

/** A measured level older than this is not "now" any more. PORTUS runs ~2 h late. */
const GAUGE_LEVEL_MAX_AGE_MS = 4 * 60 * 60_000;
/** Tolerated clock skew for a reading stamped slightly in the future. */
const GAUGE_LEVEL_SKEW_MS = 10 * 60_000;

export interface GaugeLevelNow {
  gaugeName: string;
  observedM: number;
  at: Date;
}

/**
 * The measured level of the gauge paired with a tide port, WITHOUT the IHM
 * prediction. It exists for the moment the IHM is down: the surge cannot be
 * computed then, but what the water is doing can still be shown.
 */
export function gaugeLevelNow(
  tideStationId: string | undefined,
  buoys: readonly BuoyReading[],
  now: Date = new Date(),
): GaugeLevelNow | null {
  if (!tideStationId) return null;
  const readingOf = (g: TideGauge) => buoys.find((b) => b.stationId === g.buoyStationId);
  const gauge = selectGaugeForTideStation(tideStationId, (g) => gaugeLevelFromReading(readingOf(g)) != null);
  if (!gauge) return null;
  const level = gaugeLevelFromReading(readingOf(gauge));
  if (!level) return null;
  const age = now.getTime() - level.at.getTime();
  if (age > GAUGE_LEVEL_MAX_AGE_MS || age < -GAUGE_LEVEL_SKEW_MS) return null;
  return { gaugeName: gauge.name, observedM: level.m, at: level.at };
}

export function useGaugeLevel(tideStationId: string | undefined): GaugeLevelNow | null {
  const buoys = useBuoyStore((s) => s.buoys);
  return useMemo(() => gaugeLevelNow(tideStationId, buoys), [tideStationId, buoys]);
}

/**
 * Returns null whenever there is nothing trustworthy to say — no gauge nearby,
 * no level reported, a stale reading, or a residual small enough to be noise.
 */
export function useMeteoTide(tideStationId: string | undefined): MeteoTide | null {
  const buoys = useBuoyStore((s) => s.buoys);

  const gauge = useMemo(
    () => (tideStationId
      ? selectGaugeForTideStation(
          tideStationId,
          // "Live" means the gauge is present in the feed WITH a level. A gauge
          // that has gone silent is simply skipped, which is why this is keyed
          // on the reading rather than on a hardcoded list.
          (g) => gaugeLevelFromReading(buoys.find((b) => b.stationId === g.buoyStationId)) != null,
        )
      : null),
    [tideStationId, buoys],
  );

  const simSurgeCm = useMemo(readSimSurgeCm, []);

  const observed = useMemo(() => {
    if (!gauge) return null;
    // A simulated surge is by definition happening now, so it carries its own
    // timestamp — otherwise a stale gauge would silence the debug aid too.
    if (simSurgeCm != null) return { m: simSurgeCm / CM_PER_M, at: new Date() };
    return gaugeLevelFromReading(buoys.find((b) => b.stationId === gauge.buoyStationId));
  }, [buoys, gauge, simSurgeCm]);

  const [extremes, setExtremes] = useState<TideExtreme[]>([]);
  const hasReading = observed != null;

  // Only ask IHM for a prediction once a gauge is actually reporting a level:
  // with nothing to subtract from it the request would buy nothing.
  //
  // Deduplication lives in a module-level promise cache, NOT in a ref. The
  // ref version lost the data permanently: an unmount while the fetch was in
  // flight (StrictMode double-mount in dev, or closing and reopening the
  // popup in prod) left the ref marked "already fetched" while the cancelled
  // flag threw the resolved result away — every later mount that day early-
  // returned on the ref and extremes stayed empty forever. Sharing the
  // promise means a remount just awaits the same request and still gets the
  // data, with zero extra network.
  useEffect(() => {
    if (!gauge || !hasReading) return;

    const today = new Date();
    const key = `${gauge.ihmStationId}|${today.toDateString()}`;
    let cancelled = false;

    let inFlight = tidesByDay.get(key);
    if (!inFlight) {
      const prevDay = new Date(today);
      prevDay.setDate(prevDay.getDate() - 1);
      // Yesterday matters more than it looks: on a day whose first extreme
      // falls at, say, 06:00, every instant between midnight and 06:00 can
      // only be bracketed by yesterday's LAST extreme — without it the line
      // goes silent for hours each night, storm surge or not. A failure on
      // the yesterday leg degrades to an empty list instead of killing the
      // pair: worse coverage beats no line at all.
      inFlight = Promise.all([
        fetchTidePredictions(gauge.ihmStationId, prevDay).catch(() => []),
        fetchTides48h(gauge.ihmStationId),
      ]).then(([yesterday, both]) => ({ yesterday, ...both }));
      // A failed fetch must not poison the cache for the rest of the day.
      inFlight.catch(() => {
        if (tidesByDay.get(key) === inFlight) tidesByDay.delete(key);
      });
      tidesByDay.set(key, inFlight);
    }

    inFlight
      .then(({ yesterday: yesterdayPoints, today: todayPoints, tomorrow: tomorrowPoints }) => {
        if (cancelled) return;
        const prevDay = new Date(today);
        prevDay.setDate(prevDay.getDate() - 1);
        const nextDay = new Date(today);
        nextDay.setDate(nextDay.getDate() + 1);
        // Three consecutive days so any instant of today is bracketed:
        // yesterday's last extreme covers the stretch before today's first,
        // tomorrow's first covers the stretch after today's last.
        setExtremes([
          ...toExtremes(yesterdayPoints, prevDay),
          ...toExtremes(todayPoints, today),
          ...toExtremes(tomorrowPoints, nextDay),
        ]);
      })
      .catch(() => {
        if (!cancelled) setExtremes([]);
      });

    return () => { cancelled = true; };
  }, [gauge, hasReading]);

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!hasReading) return;
    const id = setInterval(() => setNowMs(Date.now()), AGE_TICK_MS);
    return () => clearInterval(id);
  }, [hasReading]);

  return useMemo(
    () => meteoTideFromGauge(observed, extremes, new Date(nowMs), gauge?.name),
    [observed, extremes, nowMs, gauge?.name],
  );
}
