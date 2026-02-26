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

/** Color for wind speed visualization */
export function windSpeedColor(speed: number | null): string {
  if (speed === null || speed < 0.5) return '#94a3b8'; // slate-400 (calm)
  if (speed < 2) return '#60a5fa';   // blue-400
  if (speed < 5) return '#34d399';   // emerald-400
  if (speed < 8) return '#fbbf24';   // amber-400
  if (speed < 12) return '#f97316';  // orange-500
  return '#ef4444';                  // red-500
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
