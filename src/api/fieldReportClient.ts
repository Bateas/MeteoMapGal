/**
 * Sends a field report (see services/fieldReport.ts) and remembers, per device, what the
 * popup needs: the personal observer code from a `?obs=` link, and when each spot was last
 * reported so the same person cannot fire ten reports in a row.
 * Storage can be missing (private window, blocked site data): every access is guarded and
 * the box still works, it just forgets.
 */
import { OBSERVER_CODE_RE, REPORT_COOLDOWN_MIN, type FieldReport } from '../services/fieldReport';

const OBSERVER_KEY = 'mmg-observer';
const LAST_KEY = (spotId: string) => `mmg-report-${spotId}`;

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* storage blocked: forget */ }
}

/** Observer code from the current URL (`?obs=`), saved for next visits; else the saved one. */
export function currentObserverCode(): string | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('obs')?.toLowerCase() ?? null;
    if (fromUrl && OBSERVER_CODE_RE.test(fromUrl)) {
      write(OBSERVER_KEY, fromUrl);
      return fromUrl;
    }
  } catch { /* no window/location in tests */ }
  const saved = read(OBSERVER_KEY);
  return saved && OBSERVER_CODE_RE.test(saved) ? saved : null;
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
    if (res.ok) write(LAST_KEY(report.spotId), String(Date.now()));
    else console.debug(`[FieldReport] POST responded ${res.status}`);
    return res.ok;
  } catch (err) {
    console.debug('[FieldReport] POST failed:', err);
    return false;
  }
}
