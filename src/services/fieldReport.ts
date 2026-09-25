/**
 * Field reports: someone at the water says whether the wind matches what the app shows.
 *
 * They are labels for checking the app, never a map layer: an unconfirmed report on the map
 * would teach people that "nothing ever happens" once it expired. Only FACTS are asked, never a
 * verdict: wind vs the figure shown, what the water looks like, and where the wind comes from.
 *
 * Shared by the popup (what it sends) and the API (what it accepts), so both agree on the shape.
 */
import type { SpotVerdict } from './spotScoringEngine';

export type WindVsApp = -1 | 0 | 1;          // less / same / more wind than the app shows
/** What the water looks like: mirror / moved without foam / some foam / foam everywhere.
 *  Plain words on purpose: "rizada" (the sea-state term) was read differently by a sailor. */
export type WaterState = 0 | 1 | 2 | 3;
/** Direction the wind comes FROM, to the nearest of 8 points (moored boats point into it). */
export const DIR_POINTS = [0, 45, 90, 135, 180, 225, 270, 315] as const;
export type DirSeen = (typeof DIR_POINTS)[number];

export interface FieldReport {
  spotId: string;
  windVsApp: WindVsApp;
  waterState: WaterState | null;
  dirSeen: DirSeen | null;
  appWindKt: number | null;                  // the figure the reporter was comparing against
  appVerdict: SpotVerdict | null;
  appVersion: string | null;
  observerCode: string | null;               // personal link code, if any (checked server-side)
}

const VERDICTS = new Set<SpotVerdict>(['calm', 'light', 'sailing', 'good', 'strong', 'unknown']);
export const OBSERVER_CODE_RE = /^[a-z0-9]{6,32}$/;

/** Minutes a device waits before reporting the same spot again. */
export const REPORT_COOLDOWN_MIN = 30;

export type ParseResult = { ok: true; report: FieldReport } | { ok: false; error: string };

/** Strict parse of an untrusted body. Unknown observer codes are dropped here only if malformed;
 *  whether a well-formed code belongs to a real observer is the server's call. */
export function parseFieldReport(body: unknown, isValidSpot: (id: string) => boolean): ParseResult {
  if (body == null || typeof body !== 'object') return { ok: false, error: 'body' };
  const b = body as Record<string, unknown>;
  const { spotId, windVsApp, waterState, dirSeen, appWindKt, appVerdict, appVersion, observerCode } = b;

  if (typeof spotId !== 'string' || !isValidSpot(spotId)) return { ok: false, error: 'spotId' };
  if (windVsApp !== -1 && windVsApp !== 0 && windVsApp !== 1) return { ok: false, error: 'windVsApp' };
  if (waterState != null && waterState !== 0 && waterState !== 1 && waterState !== 2 && waterState !== 3) return { ok: false, error: 'waterState' };
  if (dirSeen != null && !(DIR_POINTS as readonly unknown[]).includes(dirSeen)) return { ok: false, error: 'dirSeen' };
  if (appWindKt != null && (typeof appWindKt !== 'number' || !Number.isFinite(appWindKt) || appWindKt < 0 || appWindKt > 80)) {
    return { ok: false, error: 'appWindKt' };
  }
  if (appVerdict != null && (typeof appVerdict !== 'string' || !VERDICTS.has(appVerdict as SpotVerdict))) {
    return { ok: false, error: 'appVerdict' };
  }
  if (appVersion != null && (typeof appVersion !== 'string' || !/^[0-9.]{1,20}$/.test(appVersion))) {
    return { ok: false, error: 'appVersion' };
  }
  const code = typeof observerCode === 'string' && OBSERVER_CODE_RE.test(observerCode) ? observerCode : null;

  return {
    ok: true,
    report: {
      spotId,
      windVsApp,
      waterState: (waterState ?? null) as WaterState | null,
      dirSeen: (dirSeen ?? null) as DirSeen | null,
      appWindKt: appWindKt == null ? null : Math.round((appWindKt as number) * 10) / 10,
      appVerdict: (appVerdict ?? null) as SpotVerdict | null,
      appVersion: (appVersion ?? null) as string | null,
      observerCode: code,
    },
  };
}
