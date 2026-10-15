/**
 * Sends a field report (see services/fieldReport.ts) and remembers, per device, what the
 * popup needs: the personal observer code from a `?obs=` link, and when each spot was last
 * reported so the same person cannot fire ten reports in a row.
 * Storage can be missing (private window, blocked site data): every access is guarded and
 * the box still works, it just forgets.
 */
import { OBSERVER_CODE_RE, REPORT_COOLDOWN_MIN, type FieldReport, type ObserverInfo, type RecentReportSummary } from '../services/fieldReport';

const OBSERVER_KEY = 'mmg-observer';
const LAST_KEY = (spotId: string) => `mmg-report-${spotId}`;

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* storage blocked: forget */ }
}

/**
 * Run once at start-up: a `?obs=` link saves its code on this device and the code leaves the
 * address bar, so a copied URL does not hand someone else the personal link. Before 16-oct the
 * code was only saved when a report was sent: opened from the home-screen icon, it was lost.
 * Returns true when a new code was saved (the greeting says hello once).
 */
export function captureObserverCodeFromUrl(): boolean {
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get('obs')?.toLowerCase() ?? null;
    if (!url.searchParams.has('obs')) return false;
    url.searchParams.delete('obs');
    window.history.replaceState(window.history.state, '', url.toString());
    if (!fromUrl || !OBSERVER_CODE_RE.test(fromUrl)) return false;
    const fresh = read(OBSERVER_KEY) !== fromUrl;
    write(OBSERVER_KEY, fromUrl);
    if (fresh) observerPromise = null;
    greetPending = fresh;
    return fresh;
  } catch { return false; /* no window/location in tests */ }
}

let greetPending = false;

/** True once after a new personal link was opened in this page load. */
export function takeObserverGreeting(): boolean {
  const g = greetPending;
  greetPending = false;
  return g;
}

/** The observer code saved on this device, if any. */
export function currentObserverCode(): string | null {
  const saved = read(OBSERVER_KEY);
  return saved && OBSERVER_CODE_RE.test(saved) ? saved : null;
}

/** A code typed by hand (an iPhone home-screen app does not share storage with Safari). */
export function saveObserverCode(raw: string): boolean {
  const code = raw.trim().toLowerCase().replace(/^.*[?&]obs=/, '').replace(/[^a-z0-9].*$/, '');
  if (!OBSERVER_CODE_RE.test(code)) return false;
  write(OBSERVER_KEY, code);
  observerPromise = null;
  return true;
}

function forgetObserverCode(): void {
  try { localStorage.removeItem(OBSERVER_KEY); } catch { /* storage blocked */ }
}

// Who the code belongs to and their diary. A POST on purpose: the edge caches GETs under /api/v1
// and would hand one observer's name to the next visitor. One answer per page load (cleared when
// a report is sent); a 404 means the code is unknown or switched off and is forgotten, any other
// failure keeps it for next time.
let observerPromise: Promise<ObserverInfo | null> | null = null;

export function fetchObserver(): Promise<ObserverInfo | null> {
  const code = currentObserverCode();
  if (!code) return Promise.resolve(null);
  if (observerPromise) return observerPromise;
  const p: Promise<ObserverInfo | null> = fetch('/api/v1/observers/me', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
    .then(async (res) => {
      if (res.status === 404) { forgetObserverCode(); return null; }
      if (!res.ok) { observerPromise = null; return null; }
      const body = await res.json();
      return body && typeof body.name === 'string' ? (body as ObserverInfo) : null;
    })
    .catch(() => { observerPromise = null; return null; });
  observerPromise = p;
  return p;
}

export function __clearObserverCacheForTests(): void {
  observerPromise = null;
}

/** Minutes left before this device may report the spot again (0 = may report now). */
export function cooldownLeftMin(spotId: string, now = Date.now()): number {
  const last = Number(read(LAST_KEY(spotId)));
  if (!Number.isFinite(last) || last <= 0) return 0;
  const left = REPORT_COOLDOWN_MIN - (now - last) / 60_000;
  return left > 0 ? Math.ceil(left) : 0;
}

export async function postFieldReport(report: FieldReport): Promise<boolean> {
  try {
    const res = await fetch('/api/v1/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });
    if (res.ok) { write(LAST_KEY(report.spotId), String(Date.now())); recentCache.delete(report.spotId); observerPromise = null; }
    else console.debug(`[FieldReport] POST responded ${res.status}`);
    return res.ok;
  } catch (err) {
    console.debug('[FieldReport] POST failed:', err);
    return false;
  }
}

// What was said at the water lately. A promise per spot for a minute: the popup remounts (and
// StrictMode mounts twice) without asking again, and the remount gets the same answer.
const RECENT_TTL_MS = 60_000;
const recentCache = new Map<string, { at: number; p: Promise<RecentReportSummary | null> }>();

export function fetchRecentReports(spotId: string, now = Date.now()): Promise<RecentReportSummary | null> {
  const hit = recentCache.get(spotId);
  if (hit && now - hit.at < RECENT_TTL_MS) return hit.p;
  const p = fetch(`/api/v1/reports/recent?spot=${encodeURIComponent(spotId)}`)
    .then((res) => (res.ok ? res.json() : null))
    .then((body) => (body && body.summary ? (body.summary as RecentReportSummary) : null))
    .catch(() => {
      recentCache.delete(spotId);                         // a network failure is not an answer: ask again later
      return null;
    });
  recentCache.set(spotId, { at: now, p });
  return p;
}

export function __clearRecentReportsCacheForTests(): void {
  recentCache.clear();
}
