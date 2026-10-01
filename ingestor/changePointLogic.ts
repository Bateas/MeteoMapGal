/**
 * A sudden change in how a station behaves against its neighbours (station health,
 * rule «cambio brusco»). Pure: night means in, the failures of one night out.
 *
 * Each station is its own reference. For every night (00-06 h, Madrid) its wind is
 * compared with the median of its neighbours as a ratio, and its temperature as a
 * difference. With 30 previous nights as the baseline (median and spread), a night
 * fails when the jump is at least ×2 (wind) or 1.5 °C (temperature) and four times
 * the station's usual spread. A cape station that always reads three times its
 * neighbours is fine: its baseline is three. What fails is the JUMP.
 *
 * When many stations jump the same night (6 or more and at least 3 % of those judged),
 * it is the weather — a front that cools one valley and not the next — and nobody fails.
 *
 * Dry run over 16-ago..1-oct (exp_changepoint_1oct): 7 alarms on 6 stations, all of
 * them real failures — the Netatmo at Sanxenxo (nt_1c4a68), wind 1.4× its neighbours
 * until 27-sep and 15× on the 28th, caught on the 30th, a day before the user saw it
 * on the map; a Wunderground thermometer stuck at 19 °C every night for a month;
 * another 8 °C above its 49 neighbours; a module warm at night; an anemometer whose
 * ratio tripled overnight. Without the weather guard the temperature rule raised 37
 * stations, almost all on the front nights of 20-24 sep.
 */
import { haversineDistance } from '../src/services/geoUtils.js';
import type { DetectedStrike } from './healthDetectors.js';

/** Neighbours: within this distance... */
export const CP_NEIGHBOUR_KM = 12;
/** ...and this difference of ground altitude. */
export const CP_MAX_DALT_M = 150;
/** Neighbours with a value that night, at least. */
export const CP_MIN_NEIGHBOURS = 3;
/** Nights in the baseline, and the fewest that allow a judgement. */
export const CP_BASE_NIGHTS = 30;
export const CP_BASE_MIN_NIGHTS = 15;
/** m/s added to both sides of the wind ratio, so calm nights do not divide by almost zero. */
export const CP_WIND_OFFSET_MS = 0.3;
/** Smallest jump that fails: ×2 in wind (log2 = 1), 1.5 °C in temperature. */
export const CP_WIND_MIN_JUMP_LOG2 = 1;
export const CP_TEMP_MIN_JUMP_C = 1.5;
/** ...and at least this many times the usual spread (MAD scaled to a standard deviation). */
export const CP_K_SPREAD = 4;
/** A night is weather, not sensors, when this many stations jump and this share of those judged. */
export const CP_EVENT_MIN = 6;
export const CP_EVENT_SHARE = 0.03;

export interface CpStation {
  id: string;
  lat: number;
  lon: number;
  /** Ground altitude in metres; stations are only compared with others whose altitude is known too. */
  alt: number | null;
}

/** Mean of the night 00-06 h (Madrid) of one station. `night` = local date, YYYY-MM-DD. */
export interface NightMean {
  stationId: string;
  night: string;
  wind: number | null;
  temp: number | null;
}

type CpVariable = 'wind' | 'temperature';

interface Judged {
  value: number;
  base: number;
  threshold: number;
  jump: number;
  neighbours: number;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

export function cpNeighbours(stations: readonly CpStation[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const a of stations) {
    const list: string[] = [];
    for (const b of stations) {
      if (a.id === b.id) continue;
      if ((a.alt == null) !== (b.alt == null)) continue;
      if (a.alt != null && b.alt != null && Math.abs(a.alt - b.alt) > CP_MAX_DALT_M) continue;
      if (haversineDistance(a.lat, a.lon, b.lat, b.lon) > CP_NEIGHBOUR_KM) continue;
      list.push(b.id);
    }
    out.set(a.id, list);
  }
  return out;
}

/** The station's value against its neighbours that night: log2 of the wind ratio, or the temperature difference. */
function relative(
  variable: CpVariable,
  own: NightMean | undefined,
  neighbours: readonly (NightMean | undefined)[],
): { value: number; n: number } | null {
  const pick = (m: NightMean | undefined) => (variable === 'wind' ? m?.wind : m?.temp);
  const mine = pick(own);
  if (mine == null) return null;
  const others = neighbours.map(pick).filter((v): v is number => v != null);
  if (others.length < CP_MIN_NEIGHBOURS) return null;
  const ref = median(others);
  const value = variable === 'wind'
    ? Math.log2((mine + CP_WIND_OFFSET_MS) / (ref + CP_WIND_OFFSET_MS))
    : mine - ref;
  return { value, n: others.length };
}

/**
 * The «cambio brusco» failures of the night `night` (local date): one per station and
 * variable whose jump against its own baseline passes both limits, unless that night
 * was a weather event for that variable.
 */
export function changePointStrikes(
  stations: readonly CpStation[],
  means: readonly NightMean[],
  night: string,
): DetectedStrike[] {
  const byStation = new Map<string, Map<string, NightMean>>();
  for (const m of means) {
    const s = byStation.get(m.stationId) ?? new Map<string, NightMean>();
    s.set(m.night, m);
    byStation.set(m.stationId, s);
  }
  const nights = [...new Set(means.map((m) => m.night))].filter((d) => d <= night).sort();
  const known = stations.filter((s) => byStation.has(s.id));
  const near = cpNeighbours(known);

  const out: DetectedStrike[] = [];
  for (const variable of ['wind', 'temperature'] as const) {
    const judged = new Map<string, Judged>();
    let fails = 0;
    for (const st of known) {
      const own = byStation.get(st.id)!;
      const ids = near.get(st.id) ?? [];
      const at = (d: string) => relative(variable, own.get(d), ids.map((o) => byStation.get(o)?.get(d)));
      const today = at(night);
      if (!today) continue;
      const prev: number[] = [];
      for (let i = nights.length - 1; i >= 0 && prev.length < CP_BASE_NIGHTS; i--) {
        if (nights[i] >= night) continue;
        const r = at(nights[i]);
        if (r) prev.push(r.value);
      }
      if (prev.length < CP_BASE_MIN_NIGHTS) continue;
      const base = median(prev);
      const spread = median(prev.map((x) => Math.abs(x - base))) * 1.4826;
      const minJump = variable === 'wind' ? CP_WIND_MIN_JUMP_LOG2 : CP_TEMP_MIN_JUMP_C;
      const threshold = Math.max(minJump, CP_K_SPREAD * spread);
      const jump = today.value - base;
      const entry = { value: today.value, base, threshold, jump, neighbours: today.n };
      judged.set(st.id, entry);
      if (Math.abs(jump) >= threshold) fails++;
    }
    if (fails >= CP_EVENT_MIN && fails / Math.max(1, judged.size) >= CP_EVENT_SHARE) continue;
    for (const [stationId, j] of judged) {
      if (Math.abs(j.jump) < j.threshold) continue;
      const detail = variable === 'wind'
        ? `viento de noche ${(2 ** j.value).toFixed(1)}x la mediana de sus ${j.neighbours} vecinas (lo suyo: ${(2 ** j.base).toFixed(1)}x; salta desde x${(2 ** j.threshold).toFixed(1)})`
        : `temperatura de noche ${j.value >= 0 ? '+' : ''}${j.value.toFixed(1)} C frente a la mediana de sus ${j.neighbours} vecinas (lo suyo: ${j.base >= 0 ? '+' : ''}${j.base.toFixed(1)}; salta desde ${j.threshold.toFixed(1)})`;
      out.push({ day: night, stationId, variable, rule: 'cambio brusco', detail });
    }
  }
  return out;
}
