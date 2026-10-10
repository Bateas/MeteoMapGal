/**
 * Shared color scales for marine buoy data visualization.
 * Used by BuoySymbolLayer, BuoyPopup, and BuoyPanel to ensure
 * consistent coloring across all views.
 *
 * Wave height scale: WMO Sea State Code + Beaufort correlation.
 * Water temp scale: Galician Atlantic conditions (10–22°C typical range).
 */

// ── Wave height color (Hm0, meters) ────────────────────────
// Returns hex color string for inline styles.
// Scale: calm → slight → moderate → rough → high
export function waveHeightColor(h: number | null): string {
  if (h == null) return '#64748b';  // slate-500 (no data)
  if (h < 0.5) return '#22c55e';   // green — calm (Sea State 0-1)
  if (h < 1.0) return '#a3e635';   // lime — slight (Sea State 2)
  if (h < 2.0) return '#eab308';   // yellow — moderate (Sea State 3)
  if (h < 3.0) return '#f97316';   // orange — rough (Sea State 4)
  return '#ef4444';                // red — high (Sea State 5+)
}

// Tailwind class version for BuoyPanel data cells
export function waveHeightClass(h: number): string {
  if (h < 0.5) return 'text-green-400';
  if (h < 1.0) return 'text-lime-400';
  if (h < 2.0) return 'text-yellow-500';
  if (h < 3.0) return 'text-orange-400';
  return 'text-red-400';
}

// ── Water temperature color (°C) ───────────────────────────
// Galician Atlantic: 10–22°C typical range.
export function waterTempColor(t: number | null): string {
  if (t == null) return '#64748b';  // slate-500 (no data)
  if (t < 12) return '#3b82f6';    // blue — cold
  if (t < 15) return '#06b6d4';    // cyan — cool
  if (t < 18) return '#22c55e';    // green — mild
  if (t < 21) return '#eab308';    // yellow — warm
  return '#f97316';                // orange — very warm
}

// Tailwind class version for BuoyPanel data cells
export function waterTempClass(t: number): string {
  if (t < 12) return 'text-blue-400';
  if (t < 15) return 'text-cyan-400';
  if (t < 18) return 'text-green-400';
  if (t < 21) return 'text-yellow-500';
  return 'text-orange-400';
}

// ── Water temperature qualifier (shared casual vocabulary) ──
// Single source of truth for the fría / fresca / agradable bands, shared by
// the beach-day verdict (beachDayService) and the spot popup water badge.
// Cold water is NORMAL in Galicia — this is an info qualifier, never a penalty.
export function waterTempLabel(t: number): 'fría' | 'fresca' | 'agradable' {
  if (t >= 20) return 'agradable';
  if (t >= 17) return 'fresca';
  return 'fría';
}

// ── WMO Sea State Code (0-9) ──────────────────────────────
// Based on significant wave height (Hm0).
// Spanish labels matching official maritime terminology.

const SEA_STATES = [
  { maxH: 0,    label: 'Calma',           code: 0 },
  { maxH: 0.1,  label: 'Rizada',          code: 1 },
  { maxH: 0.5,  label: 'Marejadilla',     code: 2 },
  { maxH: 1.25, label: 'Marejada',        code: 3 },
  { maxH: 2.5,  label: 'Fuerte marejada', code: 4 },
  { maxH: 4,    label: 'Gruesa',          code: 5 },
  { maxH: 6,    label: 'Muy gruesa',      code: 6 },
  { maxH: 9,    label: 'Arbolada',        code: 7 },
  { maxH: 14,   label: 'Montañosa',       code: 8 },
  { maxH: Infinity, label: 'Enorme',      code: 9 },
] as const;

/** WMO Sea State description from significant wave height (Hm0 in meters) */
export function seaStateLabel(h: number | null): string {
  if (h == null) return '--';
  for (const state of SEA_STATES) {
    if (h <= state.maxH) return state.label;
  }
  return SEA_STATES[SEA_STATES.length - 1].label;
}

/** WMO Sea State code (0-9) from significant wave height */
export function seaStateCode(h: number | null): number | null {
  if (h == null) return null;
  for (const state of SEA_STATES) {
    if (h <= state.maxH) return state.code;
  }
  return 9;
}

// ── Current speed color (m/s) ─────────────────────────────
// Galician rías: 0–0.5 m/s typical range.
export function currentSpeedColor(s: number | null): string {
  if (s == null) return '#64748b';    // slate-500 (no data)
  if (s < 0.05) return '#94a3b8';    // slate-400 — negligible
  if (s < 0.1) return '#2dd4bf';     // teal-400 — gentle
  if (s < 0.2) return '#06b6d4';     // cyan-500 — moderate
  if (s < 0.35) return '#0284c7';    // sky-600 — strong
  return '#7c3aed';                  // violet-600 — very strong
}

// Tailwind class version for BuoyPanel data cells
export function currentSpeedClass(s: number): string {
  if (s < 0.05) return 'text-slate-400';
  if (s < 0.1) return 'text-teal-400';
  if (s < 0.2) return 'text-cyan-400';
  if (s < 0.35) return 'text-sky-500';
  // violet-500 was 4.0:1 on the dark sidebar; violet-400 reaches 6.1:1.
  return 'text-violet-400';
}

// ── Freshness gate ─────────────────────────────────────────
/** Max age (minutes) for a buoy reading to drive a CURRENT verdict/alert.
 *  More generous than STALE_THRESHOLD_MIN (30) for stations: PORTUS REDEXT/
 *  CETMAR buoys publish every 30-60min + ~30-90min lag, so 2h keeps the
 *  legitimate latest reading while rejecting the 3-6h stale ones the fetcher
 *  still serves (which, at the x1.5 over-water exposure boost, could otherwise
 *  hold a stale wind verdict or fire a false SST-driven fog alert). */
export const BUOY_STALE_MAX_MIN = 120;

/**
 * PORTUS stations that are the SAME anemometer as a MeteoGalicia land station.
 * Verified 28-sep over three days: same minute, correlation 1.000, same
 * direction, 0.04 m/s of rounding. They are not over water — Ons is an island
 * mast and Cabo Udra a cape — so in a wind consensus they would count that
 * instrument twice, the second time with the x1.5 over-water boost the land
 * original never gets. Their wind stays out of every consensus; the
 * MeteoGalicia station speaks for the site wherever it is in range.
 * (Hidden today by the PORTUS clock: their rows look two hours old. Replay of
 * 14-28 sep with the clock fixed: they alone added +0.4 to +0.8 kt to the
 * inner-ría spots.)
 */
export const LAND_STATION_BUOY_COPIES: ReadonlyMap<number, string> = new Map([
  [4272, 'mg_10126'],   // Ons
  [4273, 'mg_10905'],   // Cabo Udra
]);

export function isLandStationCopy(buoyId: number): boolean {
  return LAND_STATION_BUOY_COPIES.has(buoyId);
}

/**
 * Wind sensors in the buoy feed that are NOT over open water: the three REDMAR tide
 * gauges sit inside harbours (Vilagarcía 3220, Vigo 3221, Marín 3223) and 4271 is the
 * Lourizán land station. They stay in the wind consensus as ordinary stations, without
 * the x1.5 over-water boost. Field-truth exam of 10-oct (117 truths): within range
 * 46 -> 49 %, mean error 1.11 -> 1.09 kt, bias +0.13 -> +0.04 kt; Lourido 47 -> 53 %.
 */
export const SHELTERED_BUOY_WIND: ReadonlySet<number> = new Set([3220, 3221, 3223, 4271]);

export function isOpenWaterWind(buoyId: number): boolean {
  return !SHELTERED_BUOY_WIND.has(buoyId);
}

/** Max age (minutes) for WAVE data specifically.
 *
 *  Wind is a minutes-scale field, so the 2h gate above is right for it. Swell
 *  is not: significant wave height and period evolve over hours, and a reading
 *  from two or three hours ago still describes the sea you are looking at.
 *
 *  Measured cause for a wider window: the PORTUS buoys publish every 30-60min
 *  and add 30-90min of lag, so they arrive 120-140min old — right on top of the
 *  2h line. Cabo Silleiro is the ONLY buoy in the network carrying wave data,
 *  so it was crossing the gate back and forth and silently taking the wave part
 *  of the verdict with it. 4h clears that structural lag with margin while
 *  still rejecting a buoy that has genuinely missed several publications (the
 *  fetcher itself serves up to 6h). */
export const BUOY_WAVE_MAX_MIN = 240;

/** Max age (minutes) for WATER temperature and salinity.
 *
 *  Like swell, the water mass changes over hours, not minutes, so the same 4h
 *  window applies. What it guards against is not a slightly old reading but a
 *  buoy that has stopped publishing: PORTUS keeps serving its last reading
 *  indefinitely, so without this a buoy that went silent yesterday keeps
 *  describing the water "now" in the popup and in the ticker. */
export const BUOY_WATER_MAX_MIN = BUOY_WAVE_MAX_MIN;

/** True if a buoy reading is recent enough to drive a current verdict/alert.
 *  A missing or unparseable timestamp is treated as stale (excluded). Shared by
 *  spotScoringEngine (wind/humidity/theta-V) and maritimeFogService (SST delta).
 *  `now` is injectable for deterministic tests. */
export function isBuoyFresh(
  buoy: { timestamp?: Date | string | number | null },
  maxAgeMin: number = BUOY_STALE_MAX_MIN,
  now: number = Date.now(),
): boolean {
  if (!buoy.timestamp) return false;
  const ageMin = (now - new Date(buoy.timestamp).getTime()) / 60_000;
  return Number.isFinite(ageMin) && ageMin <= maxAgeMin;
}
