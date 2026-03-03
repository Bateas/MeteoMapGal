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
export function windSpeedColor(speed: number | null): string {
  if (speed === null || speed < 0.5) return '#64748b'; // slate-500  (calm, <1 kt)
  if (speed < 1.5) return '#93c5fd';   // blue-300   (~1-3 kt: breath)
  if (speed < 3.0) return '#22d3ee';   // cyan-400   (~3-6 kt: light)
  if (speed < 4.5) return '#22c55e';   // green-500  (~6-9 kt: gentle)
  if (speed < 6.5) return '#a3e635';   // lime-400   (~9-13 kt: moderate)
  if (speed < 8.5) return '#eab308';   // yellow-500 (~13-17 kt: fresh)
  if (speed < 12)  return '#f97316';   // orange-500 (~17-23 kt: strong)
  return '#ef4444';                    // red-500    (>23 kt: gale+)
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
export function formatSolarRadiation(wm2: number | null): string {
  if (wm2 === null) return '--';
  return `${Math.round(wm2)} W/m²`;
}

/** Color for solar radiation visualization:
 *  0: night/dark, <200: cloudy, 200-500: partial, 500-800: good, >800: intense */
export function solarRadiationColor(wm2: number | null): string {
  if (wm2 === null) return '#64748b';   // slate-500
  if (wm2 <= 0) return '#475569';       // slate-600 (night)
  if (wm2 < 200) return '#94a3b8';      // slate-400 (cloudy/low)
  if (wm2 < 500) return '#fbbf24';      // amber-400 (partial sun)
  if (wm2 < 800) return '#f59e0b';      // amber-500 (good sun)
  return '#f97316';                      // orange-500 (intense)
}

/** Sun icon based on radiation level */
export function solarRadiationIcon(wm2: number | null): string {
  if (wm2 === null) return '—';
  if (wm2 <= 0) return '🌙';           // night
  if (wm2 < 100) return '☁️';           // heavy cloud
  if (wm2 < 300) return '🌥️';          // partly cloudy
  if (wm2 < 600) return '⛅';           // partial sun
  return '☀️';                           // clear/strong sun
}

// ── Thermal wind utilities ───────────────────────────────

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
