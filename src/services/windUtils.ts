const CARDINALS = [
  'N', 'NNE', 'NE', 'ENE',
  'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW',
  'W', 'WNW', 'NW', 'NNW',
] as const;

export type CardinalDirection = (typeof CARDINALS)[number];

/** Convert degrees (0-360) to cardinal direction */
export function degreesToCardinal(degrees: number): CardinalDirection {
  const index = Math.round(((degrees % 360) + 360) % 360 / 22.5) % 16;
  return CARDINALS[index];
}

/** Get wind arrow rotation in degrees. Wind direction from AEMET is "from" direction,
 *  arrow should point where wind is going TO → add 180° */
export function windArrowRotation(fromDegrees: number): number {
  return (fromDegrees + 180) % 360;
}

/** Compute arrow length based on wind speed (m/s) */
export function windArrowLength(speed: number): number {
  return Math.min(15 + speed * 5, 50);
}

/**
 * Color for wind speed visualization — tuned for inland reservoir conditions.
 * More color resolution in the 3–17 kt range where most sailing action happens.
 * Input: speed in m/s. Thresholds shown in approximate knots.
 */
/**
 * Wind speed → color. Simplified scale aligned with verdict thresholds.
 * 0-6kt = one blue (flojo), 6-9 = green, 9-13 = lime, 13-18 = yellow, 18-23 = orange, 23+ = red.
 * Units: m/s input (1 kt ≈ 0.514 m/s).
 */
export function windSpeedColor(speed: number | null): string {
  if (speed === null || speed < 0.5) return '#64748b'; // slate-500  (calm, <1 kt)
  if (speed < 3.0) return '#38bdf8';   // sky-400    (1-6 kt: flojo — one blue for all light wind)
  if (speed < 4.5) return '#22c55e';   // green-500  (6-9 kt: gentle / navegable entry)
  if (speed < 6.5) return '#84cc16';   // lime-500   (9-13 kt: moderate / navegable — darker than lime-400 for contrast vs green)
  if (speed < 9.0) return '#eab308';   // yellow-500 (13-18 kt: fresh / bueno)
  if (speed < 12)  return '#f97316';   // orange-500 (18-23 kt: strong / fuerte)
  if (speed < 15)  return '#ef4444';   // red-500    (23-30 kt: gale)
  if (speed < 20)  return '#a855f7';   // violet     (30-40 kt: storm)
  if (speed < 25)  return '#7c3aed';   // dark violet (40-50 kt: severe storm)
  return '#1e1b4b';                    // near-black  (50+ kt: hurricane)
}

/**
 * Tailwind text-color class for wind speed — matches windSpeedColor() thresholds.
 * Use in components that need className-based coloring (e.g. BuoyPanel).
 */
export function windSpeedClass(speed: number | null): string {
  if (speed === null || speed < 0.5) return 'text-slate-500';
  if (speed < 3.0) return 'text-sky-400';     // 1-6kt flojo
  if (speed < 4.5) return 'text-green-500';   // 6-9kt
  if (speed < 6.5) return 'text-lime-500';    // 9-13kt
  if (speed < 9.0) return 'text-yellow-500';  // 13-18kt
  if (speed < 12)  return 'text-orange-500';  // 18-23kt
  if (speed < 15)  return 'text-red-500';     // 23-30kt
  if (speed < 20)  return 'text-purple-400';  // 30-40kt
  if (speed < 25)  return 'text-violet-600';  // 40-50kt
  return 'text-indigo-950';                   // 50+kt
}

/** Color for temperature visualization */
export function temperatureColor(temp: number | null): string {
  if (temp === null) return '#6b7280'; // gray-500
  if (temp < 0) return '#1d4ed8';     // blue-700
  if (temp < 5) return '#3b82f6';     // blue-500
  if (temp < 10) return '#06b6d4';    // cyan-500
  if (temp < 15) return '#22c55e';    // green-500
  if (temp < 20) return '#84cc16';    // lime-500
  if (temp < 25) return '#eab308';    // yellow-500
  if (temp < 30) return '#f97316';    // orange-500
  if (temp < 35) return '#ef4444';    // red-500
  return '#991b1b';                   // red-800
}

/** Convert m/s to knots */
export function msToKnots(speed: number): number {
  if (!Number.isFinite(speed)) return 0;
  return speed * 1.94384;
}

/** Format wind speed for display (input m/s, output knots) */
export function formatWindSpeed(speedMs: number | null): string {
  if (speedMs === null) return '--';
  return `${msToKnots(speedMs).toFixed(1)} kt`;
}

/** Format temperature for display */
export function formatTemperature(temp: number | null): string {
  if (temp === null) return '--';
  return `${temp.toFixed(1)}°C`;
}

/** Format humidity for display */
export function formatHumidity(humidity: number | null): string {
  if (humidity === null) return '--';
  return `${Math.round(humidity)}%`;
}

/** Format precipitation for display (mm) */
export function formatPrecipitation(mm: number | null): string {
  if (mm === null) return '--';
  if (mm === 0) return '0 mm';
  return `${mm.toFixed(1)} mm`;
}

/** Color for precipitation visualization */
export function precipitationColor(mm: number | null): string {
  if (mm === null || mm === 0) return '#64748b'; // slate-500
  if (mm < 1) return '#93c5fd';   // blue-300
  if (mm < 5) return '#3b82f6';   // blue-500
  if (mm < 15) return '#2563eb';  // blue-600
  return '#7c3aed';               // violet-600
}

// ── Solar radiation utilities ────────────────────────────

/** Format solar radiation (W/m²) for display */
export function formatSolarRadiation(wm2: number | null | undefined): string {
  if (wm2 == null) return '--';
  return `${Math.round(wm2)} W/m²`;
}

/** Color for solar radiation visualization:
 *  0: night/dark, <200: cloudy, 200-500: partial, 500-800: good, >800: intense */
export function solarRadiationColor(wm2: number | null | undefined): string {
  if (wm2 == null) return '#64748b';   // slate-500
  if (wm2 <= 0) return '#475569';       // slate-600 (night)
  if (wm2 < 200) return '#94a3b8';      // slate-400 (cloudy/low)
  if (wm2 < 500) return '#fbbf24';      // amber-400 (partial sun)
  if (wm2 < 800) return '#f59e0b';      // amber-500 (good sun)
  return '#f97316';                      // orange-500 (intense)
}

/** Sun icon ID based on radiation level (returns IconId for WeatherIcon component) */
export function solarRadiationIcon(wm2: number | null | undefined): import('../components/icons/WeatherIcons').IconId | null {
  if (wm2 == null) return null;
  if (wm2 <= 0) return 'moon';           // night
  if (wm2 < 100) return 'cloud';         // heavy cloud
  if (wm2 < 300) return 'cloud-sun';     // partly cloudy
  if (wm2 < 600) return 'cloud-sun';     // partial sun
  return 'sun';                           // clear/strong sun
}

// ── Pressure & dew point utilities ──────────────────────

/** Format atmospheric pressure for display (hPa) */
export function formatPressure(hPa: number | null | undefined): string {
  if (hPa == null) return '--';
  return `${hPa.toFixed(1)} hPa`;
}

/** Color for pressure visualization:
 *  Low (<1000) → purple/storm. Normal (1010-1020) → neutral. High (>1025) → blue/stable. */
export function pressureColor(hPa: number | null | undefined): string {
  if (hPa == null) return '#64748b';     // slate-500
  if (hPa < 1000) return '#a855f7';       // purple-500 (very low — storm)
  if (hPa < 1010) return '#f59e0b';       // amber-500 (low — unsettled)
  if (hPa < 1020) return '#94a3b8';       // slate-400 (normal)
  if (hPa < 1030) return '#38bdf8';       // sky-400 (high — stable)
  return '#3b82f6';                        // blue-500 (very high — blocking)
}

/** Format dew point temperature for display (°C) */
export function formatDewPoint(td: number | null | undefined): string {
  if (td == null) return '--';
  return `${td.toFixed(1)}°C`;
}

/** Color for dew point / spread visualization:
 *  Close to T (small spread) → blue/fog risk. Far from T → green/dry. */
export function dewPointSpreadColor(spread: number | null | undefined): string {
  if (spread == null) return '#64748b';   // slate-500
  if (spread < 2) return '#3b82f6';        // blue-500 (fog imminent)
  if (spread < 5) return '#06b6d4';        // cyan-500 (damp)
  if (spread < 10) return '#22c55e';       // green-500 (comfortable)
  return '#f59e0b';                        // amber-500 (very dry)
}

/** Color for humidity visualization:
 *  Very high (>90%) → blue. High (>70%) → green. Moderate → amber. Low → orange. */
export function humidityColor(hr: number | null | undefined): string {
  if (hr == null) return '#64748b';       // slate-500
  if (hr > 90) return '#3b82f6';          // blue-500 (saturated)
  if (hr > 70) return '#22c55e';          // green-500 (high)
  if (hr > 50) return '#eab308';          // yellow-500 (moderate)
  return '#f97316';                       // orange-500 (dry)
}

// ── Direction utilities ──────────────────────────────────

const CARDINALS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** Convert degrees (0-360) to 8-point cardinal (N, NE, E, SE, S, SW, W, NW) */
export function degToCardinal8(deg: number): string {
  const idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return CARDINALS_8[idx];
}

/**
 * Angular difference between two directions (0-180°).
 * Accounts for wraparound (e.g. 350° vs 10° = 20°).
 */
export function angleDifference(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Circular mean of wind directions using sin/cos decomposition.
 * Returns null if input is empty or all values are null.
 */
export function averageWindDirection(directions: (number | null)[]): number | null {
  const valid = directions.filter((d): d is number => d !== null);
  if (valid.length === 0) return null;

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  let sinSum = 0;
  let cosSum = 0;

  for (const dir of valid) {
    sinSum += Math.sin(toRad(dir));
    cosSum += Math.cos(toRad(dir));
  }

  const avgRad = Math.atan2(sinSum / valid.length, cosSum / valid.length);
  const avgDeg = ((avgRad * 180) / Math.PI + 360) % 360;
  return avgDeg;
}

/**
 * Check if a direction falls within a range, handling 0/360 wraparound.
 * Range { from: 315, to: 45 } means 315°→0°→45° (through north).
 */
export function isDirectionInRange(
  direction: number,
  range: { from: number; to: number }
): boolean {
  const dir = ((direction % 360) + 360) % 360;
  const { from, to } = range;

  if (from <= to) {
    // Normal range (e.g., 90 to 270)
    return dir >= from && dir <= to;
  }
  // Wraparound range (e.g., 315 to 45 → through north)
  return dir >= from || dir <= to;
}
