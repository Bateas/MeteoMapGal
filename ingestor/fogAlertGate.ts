/**
 * Whether a webcam's "fog" is worth a Telegram message: the camera alone never is.
 *
 * On 29-sep, in the middle of a front with rain at dozens of stations and 35-47 kt gusts at the
 * exposed ones, one camera's vision model called the rain and low cloud over the ría "fog" and
 * the server sent «niebla real detectada — visibilidad pobre». The map had been given the
 * project's rule long ago (two independent signals, never one camera); this path had not.
 *
 * The physics of fog, checked at the stations within FOG_NEAR_KM of the camera:
 *  · no rain measured in the last hour (rain is what the model most often mistakes for fog);
 *  · no station with a mean of FOG_MAX_WIND_KT or more (fog does not hold in strong wind; the
 *    most exposed station is the one that tells, the sheltered ones read low in any weather);
 *  · saturated air at one of them at least: temperature minus dew point <= FOG_MAX_SPREAD_C.
 * With no nearby station reporting, nothing is sent: a camera with nothing to check it against
 * is exactly the single signal the rule forbids.
 */
import { haversineDistance } from '../src/services/geoUtils.js';
import { isWindBlacklisted } from '../src/services/spotScoringEngine.js';
import { rainInWindowMm, type PrecipSample } from '../src/services/precipSemantics.js';

export const FOG_NEAR_KM = 10;
export const FOG_MAX_WIND_KT = 15;
export const FOG_MAX_SPREAD_C = 2;
/** Rain under this in the last hour, with saturated air and light wind, is the drizzle of the fog itself
 *  (orballo: 0.1-0.3 mm/h on 11-oct), not rain. */
export const FOG_DRIZZLE_MAX_MM = 0.5;

export interface NearbyWeather {
  distKm: number;
  /** Mean wind (kt), or null */
  windKt: number | null;
  /** Temperature minus dew point (°C), or null */
  spreadC: number | null;
  /** Rain over the last hour (mm), with each network's own semantics; null = unknown */
  rainMm60: number | null;
}

/** One row of readings JOIN stations around a camera, as webcamAnalyzer reads them. */
export interface NearbyRow {
  station_id: string;
  latitude: number;
  longitude: number;
  time: Date | string;
  wind_speed: number | null;
  temperature: number | null;
  dew_point: number | null;
  precip: number | null;
}

/** How far back the rows around a camera go (the query in webcamAnalyzer asks for the same). */
export const FOG_ROWS_WINDOW_MIN = 90;

/**
 * The stations within FOG_NEAR_KM of a camera, from their rows of the last FOG_ROWS_WINDOW_MIN:
 * latest mean wind and temperature/dew-point spread, and the rain of the last hour with each
 * network's own semantics (precipSemantics). Pure, so the exam day of 29-sep runs exactly this.
 */
export function nearbyFromRows(rows: NearbyRow[], lat: number, lon: number, nowMs: number): NearbyWeather[] {
  const by = new Map<string, NearbyRow[]>();
  for (const row of rows) {
    const t = new Date(row.time).getTime();
    if (!(t <= nowMs && nowMs - t < FOG_ROWS_WINDOW_MIN * 60_000)) continue;
    (by.get(row.station_id) ?? by.set(row.station_id, []).get(row.station_id)!).push(row);
  }
  const out: NearbyWeather[] = [];
  for (const [id, list] of by) {
    list.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    const last = list[list.length - 1];
    const distKm = haversineDistance(lat, lon, Number(last.latitude), Number(last.longitude));
    if (distKm > FOG_NEAR_KM) continue;
    const samples: PrecipSample[] = list
      .filter((x) => x.precip != null)
      .map((x) => ({ t: new Date(x.time).getTime(), mm: Number(x.precip) }));
    out.push({
      distKm,
      windKt: last.wind_speed == null || isWindBlacklisted(id) ? null : Number(last.wind_speed) * 1.94384,
      spreadC: last.temperature == null || last.dew_point == null ? null : Number(last.temperature) - Number(last.dew_point),
      rainMm60: samples.length > 0 ? rainInWindowMm(id, samples, nowMs, 60) : null,
    });
  }
  return out;
}

/**
 * Whether the vision model should LOOK at a camera: the same physics as fogCorroborated, except that the
 * drizzle of the fog itself does not close it (only rain from FOG_DRIZZLE_MAX_MM in the hour does).
 * On 11-oct the fog's own drizzle (0.1-0.3 mm) kept every camera from looking all afternoon. Measured over
 * August-September, when the model looked at every image: under such drizzle it read fog in 1.7 % of the
 * images, against 1.2 % with this gate open and 1.9 % in rain, so the drizzle does not fool it. Sending a
 * fog message still takes fogCorroborated (no rain at all).
 */
export function fogWorthALook(nearby: NearbyWeather[]): { ok: boolean; reason: string } {
  const near = nearby.filter((n) => n.distKm <= FOG_NEAR_KM);
  if (near.length === 0) return { ok: false, reason: 'sin estaciones cercanas con las que comprobarla' };
  const maxRain = Math.max(0, ...near.map((n) => n.rainMm60 ?? 0));
  if (maxRain >= FOG_DRIZZLE_MAX_MM) return { ok: false, reason: 'llueve cerca: es lluvia, no niebla' };
  const maxWind = Math.max(0, ...near.map((n) => n.windKt ?? 0));
  if (maxWind >= FOG_MAX_WIND_KT) return { ok: false, reason: `viento de ${Math.round(maxWind)} kt cerca: la niebla no se sostiene` };
  if (!near.some((n) => n.spreadC != null && n.spreadC <= FOG_MAX_SPREAD_C)) {
    return { ok: false, reason: 'el aire cercano no esta saturado' };
  }
  return { ok: true, reason: maxRain > 0 ? 'aire saturado con orballo y viento flojo' : 'aire saturado, sin lluvia y con viento flojo' };
}

export function fogCorroborated(nearby: NearbyWeather[]): { ok: boolean; reason: string } {
  const near = nearby.filter((n) => n.distKm <= FOG_NEAR_KM);
  if (near.length === 0) return { ok: false, reason: 'sin estaciones cercanas con las que comprobarla' };
  const wettest = Math.max(0, ...near.map((n) => n.rainMm60 ?? 0));
  if (wettest >= FOG_DRIZZLE_MAX_MM) return { ok: false, reason: 'llueve cerca: es lluvia, no niebla' };
  // Drizzle can be the fog's own (11-oct); the message still waits for dry gauges, but the log says what it is.
  if (wettest > 0) return { ok: false, reason: 'orballo cerca: puede ser de la propia niebla, pero sin aviso mientras moje' };
  const maxWind = Math.max(0, ...near.map((n) => n.windKt ?? 0));
  if (maxWind >= FOG_MAX_WIND_KT) return { ok: false, reason: `viento de ${Math.round(maxWind)} kt cerca: la niebla no se sostiene` };
  if (!near.some((n) => n.spreadC != null && n.spreadC <= FOG_MAX_SPREAD_C)) {
    return { ok: false, reason: 'el aire cercano no esta saturado' };
  }
  return { ok: true, reason: 'aire saturado, sin lluvia y con viento flojo' };
}
