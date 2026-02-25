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

/** Format wind speed for display */
export function formatWindSpeed(speed: number | null): string {
  if (speed === null) return '--';
  return `${speed.toFixed(1)} m/s`;
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
