/**
 * The nightly detectors of sensor failures (station health). Pure: a day of readings in, the
 * failures ("strikes") out. What a strike leads to is decided elsewhere (stationHealth.ts: out
 * only after failures on several distinct days, back after two clean weeks).
 *
 * Each rule is meant to fire on a sensor that is broken, not on weather that is unusual, so each
 * one compares the station with its neighbours or with physics, and asks for more than one bad
 * reading in the day: a single bad reading is a leaf or a spider, and the per-reading quality
 * control already drops it. The cases that set them, all seen in this network:
 *  · frozen field: wu_IVIGO83 lost its outdoor unit on 10-ago and resent the same temperature,
 *    humidity, wind and radiation for weeks while its indoor barometer kept moving;
 *  · spikes: Fontecada (mg_10087) in the rain of 29-sep, -16 C and humidity of 3-21 % that came
 *    back within ten minutes;
 *  · humidity stuck at 99-100 % for days while the neighbours dried out (two home stations that
 *    feed the fog evidence);
 *  · rain: the gauge that stays dry while two neighbours within 6 km collect 5 mm or more (19 on
 *    29-sep, most of them home stations without a gauge that send 0: their 0 is not a measurement,
 *    and it would tell the fire watch a strike fell dry), and the counter that jumps 10-80 mm every
 *    few minutes (Nigrán, ~1.700 mm in a day);
 *  · radiation at night (a sensor lit, or a clock hours off) and a pyranometer dark at midday
 *    while the neighbours see the sun (wu_INOIA11, eclipse of 12-ago);
 *  · an anemometer whose mean is exactly zero while it reports real gusts (wu_IMARN3);
 *  · a barometer grossly off its neighbours. Every network stores sea-level pressure, and most home
 *    stations sit 5-10 hPa off because their owner typed a wrong altitude: that leaves the trend,
 *    which is what the app uses, intact, so only an offset beyond PRESSURE_OFFSET_HPA counts
 *    (a Netatmo 107 hPa low on 26-sep; on the dry run a 5 hPa limit flagged ~65 stations a day);
 *  · an outdoor module that measures the house: against a wall, under the eaves or indoors. In the
 *    small hours it reads 4-7 C above every neighbour and 15-35 points drier (the same air, warmed),
 *    while in the afternoon it is near them. On the dry run over 14 nights (1-oct) it singled out
 *    six Netatmo modules at sea level and no official station; the one at Vao is the nearest
 *    thermometer to that spot.
 */
import { haversineDistance } from '../src/services/geoUtils.js';
import { solarElevationDeg } from '../src/services/solarUtils.js';
import { madridHour } from '../src/services/localTime.js';
import { rawRainInWindowMm, rainInWindowMm, MAX_RAIN_RATE_MM_H, type PrecipSample } from '../src/services/precipSemantics.js';
import type { HealthStrike, HealthVariable } from '../src/services/stationHealth.js';

export interface DayRow {
  t: number;
  temperature: number | null;
  humidity: number | null;
  windSpeed: number | null;
  windGust: number | null;
  pressure: number | null;
  precip: number | null;
  solar: number | null;
}

export interface HealthStation {
  id: string;
  lat: number;
  lon: number;
  /** Ground altitude in metres; unknown leaves the warm-night rule silent for this station. */
  alt?: number | null;
  /** Readings of the day, sorted by time. */
  rows: DayRow[];
}

export interface DetectedStrike extends HealthStrike {
  /** The numbers behind it, for whoever reads the log or the table. */
  detail: string;
}

/** Neighbours for the comparisons; closer than TWIN_KM is the same station on another network. */
export const NEIGHBOUR_KM = 10;
export const RAIN_NEIGHBOUR_KM = 6;
export const PRESSURE_NEIGHBOUR_KM = 25;
export const TWIN_KM = 0.3;

export const FROZEN_MIN_HOURS = 12;
/** Radiation only counts with the sun above 10 degrees: in autumn that is about 9 h, never 12. */
export const FROZEN_SOLAR_MIN_HOURS = 6;
export const SPIKE_TEMP_C = 5;
export const SPIKE_HUMIDITY_PCT = 25;
/** Spikes in the day that make a strike: one is a bad reading, not a bad sensor. */
export const SPIKE_MIN_COUNT = 2;
export const HUMIDITY_STUCK_PCT = 99;
export const DRY_GAUGE_NEIGHBOUR_MM = 5;
/** A neighbour's day total above this is its own broken counter, not rain to compare with. */
export const MAX_DAY_RAIN_MM = 250;
export const SOLAR_NIGHT_WM2 = 20;
export const SOLAR_NIGHT_MIN_READINGS = 3;
export const SOLAR_DARK_RATIO = 0.3;
export const WIND_ZERO_SHARE = 0.8;
export const WIND_ZERO_MIN_GUSTS = 5;
export const PRESSURE_OFFSET_HPA = 15;
/** Local hours of the warm-night rule (both included): the sun has been gone for hours. */
export const NIGHT_HOURS: readonly [number, number] = [1, 5];
export const NIGHT_MIN_READINGS = 4;
export const NIGHT_MIN_NEIGHBOURS = 3;
export const NIGHT_WARM_C = 4;
export const NIGHT_DRY_PCT = 10;
/** A station this far above its neighbours can be warm at night for real: above the inversion. */
export const NIGHT_MAX_ABOVE_M = 50;

const HOUR = 3_600_000;

type Field = 'temperature' | 'humidity' | 'windSpeed' | 'pressure' | 'solar';
const FIELD_VARIABLE: Record<Field, HealthVariable> = {
  temperature: 'temperature', humidity: 'humidity', windSpeed: 'wind', pressure: 'pressure', solar: 'solar',
};

const median = (xs: number[]) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

function neighboursOf(stations: HealthStation[]): Map<string, { st: HealthStation; km: number }[]> {
  const out = new Map<string, { st: HealthStation; km: number }[]>();
  for (const a of stations) {
    const list: { st: HealthStation; km: number }[] = [];
    for (const b of stations) {
      if (a === b) continue;
      const km = haversineDistance(a.lat, a.lon, b.lat, b.lon);
      if (km >= TWIN_KM && km <= PRESSURE_NEIGHBOUR_KM) list.push({ st: b, km });
    }
    out.set(a.id, list);
  }
  return out;
}

const values = (rows: DayRow[], f: Field) => rows.map((r) => r[f]).filter((v): v is number => v != null && Number.isFinite(v));

/** One and the same value for FROZEN_MIN_HOURS or more while two neighbours move. */
function frozen(st: HealthStation, near: { st: HealthStation; km: number }[], day: string): DetectedStrike[] {
  const out: DetectedStrike[] = [];
  for (const f of ['temperature', 'humidity', 'windSpeed', 'pressure', 'solar'] as Field[]) {
    let rows = st.rows.filter((r) => r[f] != null);
    if (f === 'solar') rows = rows.filter((r) => solarElevationDeg(r.t, st.lat, st.lon) > 10);
    if (rows.length < 12) continue;
    const span = rows[rows.length - 1].t - rows[0].t;
    const distinct = new Set(rows.map((r) => r[f]));
    if (span < (f === 'solar' ? FROZEN_SOLAR_MIN_HOURS : FROZEN_MIN_HOURS) * HOUR || distinct.size !== 1) continue;
    const v = rows[0][f] as number;
    if (f === 'windSpeed' && v === 0) continue; // a still anemometer has its own rule (stuck at zero)
    const moving = near.filter((n) => n.km <= NEIGHBOUR_KM
      && new Set(n.st.rows.filter((r) => r.t >= rows[0].t && r.t <= rows[rows.length - 1].t).map((r) => r[f]).filter((x) => x != null)).size >= 3);
    if (moving.length < 2) continue;
    out.push({
      day, stationId: st.id, variable: FIELD_VARIABLE[f], rule: 'congelado',
      detail: `${v} durante ${round(span / HOUR)} h; ${moving.length} vecinas se mueven`,
    });
  }
  return out;
}

/** Readings that jump away from both sides of their own series and come back. */
function spikes(st: HealthStation, day: string): DetectedStrike[] {
  const out: DetectedStrike[] = [];
  for (const [f, thr, variable] of [['temperature', SPIKE_TEMP_C, 'temperature'], ['humidity', SPIKE_HUMIDITY_PCT, 'humidity']] as const) {
    const rows = st.rows.filter((r) => r[f] != null);
    let count = 0;
    let worst = 0;
    for (let i = 0; i < rows.length; i++) {
      const t = rows[i].t;
      const before = rows.slice(Math.max(0, i - 3), i).filter((r) => t - r.t <= 40 * 60_000).map((r) => r[f] as number);
      const after = rows.slice(i + 1, i + 4).filter((r) => r.t - t <= 40 * 60_000).map((r) => r[f] as number);
      if (before.length < 2 || after.length < 2) continue;
      const x = rows[i][f] as number;
      const db = x - median(before);
      const da = x - median(after);
      if (Math.abs(db) > thr && Math.abs(da) > thr && Math.sign(db) === Math.sign(da)) {
        count++;
        worst = Math.max(worst, Math.min(Math.abs(db), Math.abs(da)));
      }
    }
    if (count >= SPIKE_MIN_COUNT) {
      out.push({ day, stationId: st.id, variable, rule: 'picos', detail: `${count} picos, el mayor de ${round(worst)} ${f === 'temperature' ? 'C' : '%'}` });
    }
  }
  return out;
}

/** Saturated all day while the neighbours dried out. */
function humidityStuck(st: HealthStation, near: { st: HealthStation; km: number }[], day: string): DetectedStrike[] {
  const hum = values(st.rows, 'humidity');
  if (hum.length < 20 || hum.some((h) => h < HUMIDITY_STUCK_PCT)) return [];
  const dry = near.filter((n) => n.km <= NEIGHBOUR_KM && median(values(n.st.rows, 'humidity')) < 90);
  if (dry.length < 2) return [];
  return [{ day, stationId: st.id, variable: 'humidity', rule: 'humedad clavada', detail: `>= ${HUMIDITY_STUCK_PCT} % todo el dia; ${dry.length} vecinas por debajo de 90 %` }];
}

function precipSamples(st: HealthStation): PrecipSample[] {
  return st.rows.filter((r) => r.precip != null).map((r) => ({ t: r.t, mm: r.precip as number }));
}

/** The dry gauge among wet neighbours, and the counter that jumps. */
function rain(st: HealthStation, near: { st: HealthStation; km: number }[], day: string, dayEndMs: number): DetectedStrike[] {
  const out: DetectedStrike[] = [];
  const samples = precipSamples(st);
  if (samples.length < 12) return out;
  let broken = 0;
  for (let end = samples[0].t + HOUR; end <= dayEndMs; end += HOUR) {
    const mm = rawRainInWindowMm(st.id, samples, end, 60);
    if (mm != null && mm > MAX_RAIN_RATE_MM_H) broken = Math.max(broken, mm);
  }
  if (broken > 0) out.push({ day, stationId: st.id, variable: 'precipitation', rule: 'contador roto', detail: `${round(broken)} mm en una hora` });
  const own = rainInWindowMm(st.id, samples, dayEndMs, 1440);
  if (own === 0) {
    const wet = near
      .filter((n) => n.km <= RAIN_NEIGHBOUR_KM)
      .map((n) => ({ id: n.st.id, mm: rainInWindowMm(n.st.id, precipSamples(n.st), dayEndMs, 1440) }))
      .filter((n): n is { id: string; mm: number } => n.mm != null && n.mm >= DRY_GAUGE_NEIGHBOUR_MM && n.mm <= MAX_DAY_RAIN_MM);
    if (wet.length >= 2) {
      out.push({
        day, stationId: st.id, variable: 'precipitation', rule: 'pluviometro seco',
        detail: `0 mm; ${wet.length} vecinas a <= ${RAIN_NEIGHBOUR_KM} km con ${wet.map((w) => round(w.mm)).join(', ')} mm`,
      });
    }
  }
  return out;
}

/** Light at night, and a sensor in the dark at midday while the neighbours see the sun. */
function solar(st: HealthStation, near: { st: HealthStation; km: number }[], day: string): DetectedStrike[] {
  const out: DetectedStrike[] = [];
  const lit = st.rows.filter((r) => r.solar != null && r.solar > SOLAR_NIGHT_WM2 && solarElevationDeg(r.t, st.lat, st.lon) < -3);
  if (lit.length >= SOLAR_NIGHT_MIN_READINGS) {
    out.push({ day, stationId: st.id, variable: 'solar', rule: 'sol de noche', detail: `${lit.length} lecturas por encima de ${SOLAR_NIGHT_WM2} W/m2 con el sol bajo el horizonte` });
  }
  const noon = st.rows.filter((r) => r.solar != null && solarElevationDeg(r.t, st.lat, st.lon) > 30);
  if (noon.length >= 6) {
    const from = noon[0].t;
    const to = noon[noon.length - 1].t;
    const theirs = near
      .filter((n) => n.km <= NEIGHBOUR_KM)
      .map((n) => median(n.st.rows.filter((r) => r.solar != null && r.t >= from && r.t <= to).map((r) => r.solar as number)))
      .filter((m) => Number.isFinite(m));
    const mine = median(noon.map((r) => r.solar as number));
    if (theirs.length >= 2 && median(theirs) > 300 && mine < SOLAR_DARK_RATIO * median(theirs)) {
      out.push({ day, stationId: st.id, variable: 'solar', rule: 'a oscuras', detail: `mediana ${Math.round(mine)} W/m2 frente a ${Math.round(median(theirs))} de ${theirs.length} vecinas` });
    }
  }
  return out;
}

/** A mean of exactly zero with real gusts: the cups do not report their speed. */
function windWithoutMean(st: HealthStation, day: string): DetectedStrike[] {
  const rows = st.rows.filter((r) => r.windSpeed != null);
  if (rows.length < 12) return [];
  const zeros = rows.filter((r) => r.windSpeed === 0).length;
  const gusts = rows.filter((r) => (r.windGust ?? 0) > 5).length;
  if (zeros / rows.length < WIND_ZERO_SHARE || gusts < WIND_ZERO_MIN_GUSTS) return [];
  return [{ day, stationId: st.id, variable: 'wind', rule: 'media a cero con rachas', detail: `${Math.round((100 * zeros) / rows.length)} % de medias a 0 con ${gusts} rachas de mas de 10 kt` }];
}

/** A barometer off its neighbours: all networks store sea-level pressure. */
function pressureOffset(st: HealthStation, near: { st: HealthStation; km: number }[], day: string): DetectedStrike[] {
  const mine = median(values(st.rows, 'pressure'));
  if (!Number.isFinite(mine)) return [];
  const theirs = near.map((n) => median(values(n.st.rows, 'pressure'))).filter((m) => Number.isFinite(m));
  if (theirs.length < 3) return [];
  const off = mine - median(theirs);
  if (Math.abs(off) <= PRESSURE_OFFSET_HPA) return [];
  return [{ day, stationId: st.id, variable: 'pressure', rule: 'presion desfasada', detail: `${round(off)} hPa frente a ${theirs.length} vecinas` }];
}

interface NightMean { t: number; rh: number }

/** Mean temperature and humidity of each station over the local NIGHT_HOURS, null with too few
 *  readings. The local hour is looked up once per UTC hour (Madrid's offset is whole hours). */
function nightMeans(stations: HealthStation[]): Map<string, NightMean | null> {
  const hourOf = new Map<number, number>();
  const localHour = (t: number) => {
    const k = Math.floor(t / HOUR);
    let h = hourOf.get(k);
    if (h === undefined) {
      h = madridHour(k * HOUR);
      hourOf.set(k, h);
    }
    return h;
  };
  const out = new Map<string, NightMean | null>();
  for (const st of stations) {
    const rows = st.rows.filter((r) => r.temperature != null && r.humidity != null
      && localHour(r.t) >= NIGHT_HOURS[0] && localHour(r.t) <= NIGHT_HOURS[1]);
    out.set(st.id, rows.length < NIGHT_MIN_READINGS ? null : {
      t: rows.reduce((a, r) => a + (r.temperature as number), 0) / rows.length,
      rh: rows.reduce((a, r) => a + (r.humidity as number), 0) / rows.length,
    });
  }
  return out;
}

/** Warmer than every neighbour in the small hours and drier: the same air, warmed by a house.
 *  Air off the sea would be warmer and MOISTER, and a station well above its neighbours can be
 *  warm for real above the night inversion (the MeteoGalicia hill stations are, most nights), so
 *  both stay out. Temperature and humidity go together: the humidity is relative to the warm air. */
function warmNight(
  st: HealthStation, near: { st: HealthStation; km: number }[], day: string, means: Map<string, NightMean | null>,
): DetectedStrike[] {
  const mine = means.get(st.id);
  if (!mine || st.alt == null || !Number.isFinite(st.alt)) return [];
  const theirs = near
    .filter((n) => n.km <= NEIGHBOUR_KM)
    .map((n) => ({ m: means.get(n.st.id), alt: n.st.alt }))
    .filter((n): n is { m: NightMean; alt: number | null | undefined } => n.m != null);
  if (theirs.length < NIGHT_MIN_NEIGHBOURS) return [];
  const alts = theirs.map((n) => n.alt).filter((a): a is number => a != null && Number.isFinite(a));
  if (alts.length === 0 || st.alt > median(alts) + NIGHT_MAX_ABOVE_M) return [];
  const temps = theirs.map((n) => n.m.t);
  const dT = mine.t - median(temps);
  const dRh = mine.rh - median(theirs.map((n) => n.m.rh));
  if (dT <= NIGHT_WARM_C || mine.t <= Math.max(...temps) || dRh >= -NIGHT_DRY_PCT) return [];
  const detail = `+${round(dT)} C y ${Math.round(dRh)} % de humedad frente a ${theirs.length} vecinas (${NIGHT_HOURS[0]}-${NIGHT_HOURS[1]} h)`;
  return (['temperature', 'humidity'] as const).map((variable) => ({ day, stationId: st.id, variable, rule: 'calor de noche', detail }));
}

/** Every failure of the day. `dayEndMs` = end of the local day. */
export function detectStrikes(stations: HealthStation[], day: string, dayEndMs: number): DetectedStrike[] {
  const near = neighboursOf(stations);
  const night = nightMeans(stations);
  const out: DetectedStrike[] = [];
  for (const st of stations) {
    const n = near.get(st.id) ?? [];
    out.push(
      ...frozen(st, n, day), ...spikes(st, day), ...humidityStuck(st, n, day), ...rain(st, n, day, dayEndMs),
      ...solar(st, n, day), ...windWithoutMean(st, day), ...pressureOffset(st, n, day), ...warmNight(st, n, day, night),
    );
  }
  return out;
}
