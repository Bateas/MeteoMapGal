/**
 * Field reports: someone at the water says whether the wind matches what the app shows.
 *
 * They are labels for checking the app, never a map layer: an unconfirmed report on the map
 * would teach people that "nothing ever happens" once it expired. Only FACTS are asked, never a
 * verdict: wind vs the figure shown, what the water looks like, and where the wind comes from.
 * The spot's popup shows what was said in the last two hours, grouped and anonymous, next to the
 * question; it never changes the verdict.
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

/** Knots seen on the water, in ranges: only asked to observers with a personal link (a casual
 *  visitor's figure would be a guess). Index into this table; the server stores lo and hi. */
export const KT_RANGES = [[0, 5], [5, 8], [8, 12], [12, 16], [16, 20], [20, 30]] as const;
export type KtRange = 0 | 1 | 2 | 3 | 4 | 5;

export interface FieldReport {
  spotId: string;
  windVsApp: WindVsApp;
  waterState: WaterState | null;
  dirSeen: DirSeen | null;
  ktRange: KtRange | null;                   // observers only; the server drops it for anonymous reports
  appWindKt: number | null;                  // the figure the reporter was comparing against
  appVerdict: SpotVerdict | null;
  appVersion: string | null;
  observerCode: string | null;               // personal link code, if any (checked server-side)
}

const VERDICTS = new Set<SpotVerdict>(['calm', 'light', 'sailing', 'good', 'strong', 'unknown']);
/** Observer codes are generated at random (14 characters, ~70 bits): at least 12 so a short,
 *  hand-picked one cannot be guessed by trying (security review of v2.179.0). */
export const OBSERVER_CODE_RE = /^[a-z0-9]{12,32}$/;

/** Minutes a device waits before reporting the same spot again. */
export const REPORT_COOLDOWN_MIN = 30;

export type ParseResult = { ok: true; report: FieldReport } | { ok: false; error: string };

/** Strict parse of an untrusted body. Unknown observer codes are dropped here only if malformed;
 *  whether a well-formed code belongs to a real observer is the server's call. */
export function parseFieldReport(body: unknown, isValidSpot: (id: string) => boolean): ParseResult {
  if (body == null || typeof body !== 'object') return { ok: false, error: 'body' };
  const b = body as Record<string, unknown>;
  const { spotId, windVsApp, waterState, dirSeen, ktRange, appWindKt, appVerdict, appVersion, observerCode } = b;

  if (typeof spotId !== 'string' || !isValidSpot(spotId)) return { ok: false, error: 'spotId' };
  if (windVsApp !== -1 && windVsApp !== 0 && windVsApp !== 1) return { ok: false, error: 'windVsApp' };
  if (waterState != null && waterState !== 0 && waterState !== 1 && waterState !== 2 && waterState !== 3) return { ok: false, error: 'waterState' };
  if (dirSeen != null && !(DIR_POINTS as readonly unknown[]).includes(dirSeen)) return { ok: false, error: 'dirSeen' };
  if (ktRange != null && !(Number.isInteger(ktRange) && (ktRange as number) >= 0 && (ktRange as number) < KT_RANGES.length)) {
    return { ok: false, error: 'ktRange' };
  }
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
      ktRange: (ktRange ?? null) as KtRange | null,
      appWindKt: appWindKt == null ? null : Math.round((appWindKt as number) * 10) / 10,
      appVerdict: (appVerdict ?? null) as SpotVerdict | null,
      appVersion: (appVersion ?? null) as string | null,
      observerCode: code,
    },
  };
}

// ── What people at the water said lately (popup line) ──

/** How far back the popup looks: past two hours a report says nothing about now. */
export const RECENT_REPORT_WINDOW_MIN = 120;

export interface RecentReportRow {
  minutesAgo: number;
  windVsApp: WindVsApp;
  waterState: WaterState | null;
  dirSeen: DirSeen | null;
  appWindKt: number | null;
}

export interface RecentReportSummary {
  count: number;
  /** Minutes since the newest report, rounded down to 5: when, not the exact minute. */
  newestMin: number;
  /** What two thirds or more said; 'mixed' when they do not agree. */
  wind: WindVsApp | 'mixed';
  /** The figure the newest reporter was comparing against. */
  appWindKt: number | null;
  /** The water most of them described (the newest wins a tie), if anyone did. */
  water: WaterState | null;
  /** Where the wind came from, only when more than half of those who said it agree. */
  dir: DirSeen | null;
}

function modeNewestFirst<T>(values: T[]): { value: T; n: number } | null {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: { value: T; n: number } | null = null;
  for (const v of values) {                       // newest first: a tie keeps the newest
    const n = counts.get(v)!;
    if (!best || n > best.n) best = { value: v, n };
  }
  return best;
}

/** Groups the last two hours of reports of one spot. Null when there are none. */
export function summarizeRecentReports(rows: RecentReportRow[]): RecentReportSummary | null {
  const fresh = rows
    .filter((r) => Number.isFinite(r.minutesAgo) && r.minutesAgo >= 0 && r.minutesAgo <= RECENT_REPORT_WINDOW_MIN)
    .sort((a, b) => a.minutesAgo - b.minutesAgo);
  if (fresh.length === 0) return null;
  const n = fresh.length;
  const wind = modeNewestFirst(fresh.map((r) => r.windVsApp))!;
  const waters = fresh.map((r) => r.waterState).filter((w): w is WaterState => w != null);
  const dirs = fresh.map((r) => r.dirSeen).filter((d): d is DirSeen => d != null);
  const dir = modeNewestFirst(dirs);
  return {
    count: n,
    newestMin: Math.floor(fresh[0].minutesAgo / 5) * 5,
    wind: wind.n * 3 >= n * 2 ? wind.value : 'mixed',
    appWindKt: fresh[0].appWindKt,
    water: modeNewestFirst(waters)?.value ?? null,
    dir: dir && dir.n * 2 > dirs.length ? dir.value : null,
  };
}

const WATER_WORDS: Record<WaterState, string> = { 0: 'agua como un espejo', 1: 'agua movida, sin espuma', 2: 'algo de espuma', 3: 'mucha espuma' };
const DIR_WORDS: Record<DirSeen, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SO', 270: 'O', 315: 'NO' };

/** «hace 15 min · 2 reportes» */
export function recentReportWhen(s: RecentReportSummary): string {
  const ago = s.newestMin < 5 ? 'hace un momento'
    : s.newestMin < 60 ? `hace ${s.newestMin} min`
    : `hace ${Math.floor(s.newestMin / 60)} h${s.newestMin % 60 ? ` ${s.newestMin % 60} min` : ''}`;
  return `${ago} · ${s.count === 1 ? '1 reporte' : `${s.count} reportes`}`;
}

/** «Más viento que los 9 kt de la app · algo de espuma · del N» */
export function recentReportWhat(s: RecentReportSummary): string {
  const kt = s.appWindKt != null ? Math.round(s.appWindKt) : null;
  const wind = s.wind === 'mixed' ? 'No coinciden entre ellos'
    : s.wind === 1 ? (kt != null ? `Más viento que los ${kt} kt de la app` : 'Más viento que la app')
    : s.wind === -1 ? (kt != null ? `Menos viento que los ${kt} kt de la app` : 'Menos viento que la app')
    : (kt != null ? `El viento de la app (${kt} kt)` : 'El viento de la app');
  const parts = [wind];
  if (s.water != null) parts.push(WATER_WORDS[s.water]);
  if (s.dir != null) parts.push(`del ${DIR_WORDS[s.dir]}`);
  return parts.join(' · ');
}

// ── A report that contradicts itself (asked before sending) ──

export type ReportConflict = 'less-with-foam' | 'more-with-mirror' | 'less-with-knots' | 'more-with-knots';

/**
 * Whether the wind answer and the water answer cannot both be true for the figure shown. Foam on
 * the water needs ~8-10 kt (Beaufort 3), a mirror needs under ~2 kt (Beaufort 0-1). 15-oct 17:46:
 * «Menos viento que los 6,8 kt» with «algo de espuma» was a mis-tap with 12-14 kt in the water.
 * The form asks again; it never blocks the report.
 */
export function reportConflict(
  wind: WindVsApp | null, water: WaterState | null, appWindKt: number | null, ktRange: KtRange | null = null,
): ReportConflict | null {
  if (wind == null || appWindKt == null) return null;
  // An observer's knots against their own «more / less»: the whole range on the other side of the figure.
  if (ktRange != null) {
    const [lo, hi] = KT_RANGES[ktRange];
    if (wind === -1 && lo > appWindKt) return 'less-with-knots';
    if (wind === 1 && hi < appWindKt) return 'more-with-knots';
  }
  if (water == null) return null;
  if (wind === -1 && water >= 2 && appWindKt < 8) return 'less-with-foam';
  if (wind === 1 && water === 0 && appWindKt >= 3) return 'more-with-mirror';
  return null;
}

// ── Observers with a personal link ──

/** One past report, as the observer sees it in their diary. Times in ms. */
export interface ObserverReport {
  time: number;
  spotId: string;
  windVsApp: WindVsApp;
  waterState: WaterState | null;
  dirSeen: DirSeen | null;
  ktLo: number | null;
  ktHi: number | null;
  appWindKt: number | null;
}

export interface ObserverInfo {
  name: string;
  reports: ObserverReport[];
}

/** «12-16 kt» / «más de 20 kt» */
export function ktRangeLabel(lo: number, hi: number): string {
  return hi >= 30 ? `más de ${lo} kt` : `${lo}-${hi} kt`;
}

/** One diary line: «12-16 kt · algo de espuma · del SO · la app decía 14». */
export function observerReportWhat(r: ObserverReport): string {
  const parts: string[] = [];
  if (r.ktLo != null && r.ktHi != null) parts.push(ktRangeLabel(r.ktLo, r.ktHi));
  else parts.push(r.windVsApp === 1 ? 'más viento que la app' : r.windVsApp === -1 ? 'menos viento que la app' : 'como la app');
  if (r.waterState != null) parts.push(WATER_WORDS[r.waterState]);
  if (r.dirSeen != null) parts.push(`del ${DIR_WORDS[r.dirSeen]}`);
  if (r.appWindKt != null) parts.push(`la app decía ${Math.round(r.appWindKt)}`);
  return parts.join(' · ');
}
