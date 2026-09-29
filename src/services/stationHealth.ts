/**
 * Which variables of which stations are out, because their sensor keeps failing.
 *
 * Judged per variable, never per station: on 29-sep Fontecada's thermometer broke in the rain
 * (-16 C, spikes that came back in ten minutes) while its anemometer kept measuring the gale.
 * And judged over several days: one bad reading is a leaf on the pyranometer or a spider in the
 * rain gauge, and the per-reading quality control already drops it. A failure seen on
 * HEALTH_OUT_MIN_DAYS distinct days within HEALTH_WINDOW_DAYS takes the variable out; it comes
 * back by itself after HEALTH_CLEAN_DAYS without a failure. The raw data is always stored: this
 * decides who uses it, not what is kept.
 *
 * The failures ("strikes") come from the nightly detectors of the server; this module only
 * holds the rule, so the server and the map apply the same one.
 */
import type { NormalizedReading } from '../types/station';

export type HealthVariable = 'wind' | 'temperature' | 'humidity' | 'precipitation' | 'solar' | 'pressure';

export interface HealthStrike {
  /** Local day of the failure, YYYY-MM-DD (Galicia). */
  day: string;
  stationId: string;
  variable: HealthVariable;
  /** Which detector saw it. */
  rule: string;
}

export interface HealthVerdict {
  stationId: string;
  variable: HealthVariable;
  /** Distinct days with a failure in the window. */
  strikeDays: number;
  firstDay: string;
  lastDay: string;
  rules: string[];
  out: boolean;
}

export const HEALTH_WINDOW_DAYS = 30;
export const HEALTH_OUT_MIN_DAYS = 3;
export const HEALTH_CLEAN_DAYS = 14;

const DAY_MS = 86_400_000;
const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);

export const healthKey = (stationId: string, variable: HealthVariable) => `${stationId}|${variable}`;

/** Every station-variable with a failure in the window, and whether it is out as of `today`. */
export function judgeHealth(strikes: readonly HealthStrike[], today: string): HealthVerdict[] {
  const now = dayNumber(today);
  const groups = new Map<string, { stationId: string; variable: HealthVariable; days: Set<string>; rules: Set<string> }>();
  for (const s of strikes) {
    const age = now - dayNumber(s.day);
    if (!(age >= 0 && age < HEALTH_WINDOW_DAYS)) continue;
    const key = healthKey(s.stationId, s.variable);
    const g = groups.get(key) ?? { stationId: s.stationId, variable: s.variable, days: new Set<string>(), rules: new Set<string>() };
    g.days.add(s.day);
    g.rules.add(s.rule);
    groups.set(key, g);
  }
  const out: HealthVerdict[] = [];
  for (const g of groups.values()) {
    const days = [...g.days].sort();
    const lastDay = days[days.length - 1];
    out.push({
      stationId: g.stationId,
      variable: g.variable,
      strikeDays: days.length,
      firstDay: days[0],
      lastDay,
      rules: [...g.rules].sort(),
      out: days.length >= HEALTH_OUT_MIN_DAYS && now - dayNumber(lastDay) < HEALTH_CLEAN_DAYS,
    });
  }
  return out.sort((a, b) => b.strikeDays - a.strikeDays || a.stationId.localeCompare(b.stationId));
}

/** The keys (healthKey) of the station-variables that are out. */
export function outKeys(verdicts: readonly HealthVerdict[]): Set<string> {
  return new Set(verdicts.filter((v) => v.out).map((v) => healthKey(v.stationId, v.variable)));
}

/** The reading fields each variable feeds. The dew point comes from temperature and humidity. */
export const HEALTH_FIELDS: Record<HealthVariable, (keyof NormalizedReading)[]> = {
  wind: ['windSpeed', 'windGust', 'windDirection'],
  temperature: ['temperature', 'dewPoint'],
  humidity: ['humidity', 'dewPoint'],
  precipitation: ['precipitation'],
  solar: ['solarRadiation'],
  pressure: ['pressure'],
};

const VARIABLES = Object.keys(HEALTH_FIELDS) as HealthVariable[];

/** The reading without the variables that are out for its station (the same object if none). */
export function withoutOutVariables(reading: NormalizedReading, out: ReadonlySet<string>): NormalizedReading {
  if (out.size === 0) return reading;
  let copy: NormalizedReading | null = null;
  for (const variable of VARIABLES) {
    if (!out.has(healthKey(reading.stationId, variable))) continue;
    copy ??= { ...reading };
    for (const field of HEALTH_FIELDS[variable]) (copy as unknown as Record<string, unknown>)[field] = null;
  }
  return copy ?? reading;
}
