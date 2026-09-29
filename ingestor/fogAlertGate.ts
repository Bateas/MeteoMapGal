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
export const FOG_NEAR_KM = 10;
export const FOG_MAX_WIND_KT = 15;
export const FOG_MAX_SPREAD_C = 2;

export interface NearbyWeather {
  distKm: number;
  /** Mean wind (kt), or null */
  windKt: number | null;
  /** Temperature minus dew point (°C), or null */
  spreadC: number | null;
  /** Rain over the last hour (mm), with each network's own semantics; null = unknown */
  rainMm60: number | null;
}

export function fogCorroborated(nearby: NearbyWeather[]): { ok: boolean; reason: string } {
  const near = nearby.filter((n) => n.distKm <= FOG_NEAR_KM);
  if (near.length === 0) return { ok: false, reason: 'sin estaciones cercanas con las que comprobarla' };
  if (near.some((n) => (n.rainMm60 ?? 0) > 0)) return { ok: false, reason: 'llueve cerca: es lluvia, no niebla' };
  const maxWind = Math.max(0, ...near.map((n) => n.windKt ?? 0));
  if (maxWind >= FOG_MAX_WIND_KT) return { ok: false, reason: `viento de ${Math.round(maxWind)} kt cerca: la niebla no se sostiene` };
  if (!near.some((n) => n.spreadC != null && n.spreadC <= FOG_MAX_SPREAD_C)) {
    return { ok: false, reason: 'el aire cercano no esta saturado' };
  }
  return { ok: true, reason: 'aire saturado, sin lluvia y con viento flojo' };
}
