/**
 * Requests to the Observatorio Costeiro's API (https://api.intecmar.gal), shared by the live feed
 * (intecmarLive.ts) and the night archive (intecmarArchive.ts): one session, one pace, one daily count.
 *
 * The account: the project's free registration at apiweb.intecmar.gal. Its user and
 * password live only in `ingestor/.env` (INTECMAR_USER, INTECMAR_PASSWORD) and are never printed.
 * Login (OAuth2 password flow) gives a bearer token of ~3 h; it is reused until 5 minutes before it
 * expires, and concurrent callers wait for the same login, so there is at most one login every ~3 h.
 *
 * INTECMAR audits the API and blocks the account at around 10,000 requests a day (21-oct). So: one
 * request at a time with a pause between them (serialised across both callers), a time limit on each,
 * at most ONE retry (5 s) on 429/5xx; a breaker that refuses everything for an hour after 5 failed
 * requests in a row (intecmarLiveLogic.breakerNote); ONE new login per pass on a 401 (IntecmarPass),
 * and a second 401 in the same pass aborts the pass (IntecmarSessionError); a hard cap of
 * INTECMAR_MAX_REQUESTS_PER_DAY per UTC day (default 1500, logins and retries included) with a single
 * warning line when reached; and a wrong password stops BOTH callers until the next restart instead
 * of insisting.
 */
import { tokenExpiryMs } from './intecmarLogic.js';
import { addRequest, breakerNote, breakerOpen, closedBreaker, dailyCap, describeDay, emptyLedger, requestsLeft, rollLedger,
  type BreakerState, type RequestLedger } from './intecmarLiveLogic.js';
import { log } from './logger.js';

const BASE = 'https://api.intecmar.gal';
const TIMEOUT_MS = 60_000;
const PAUSE_MS = 1_500;
const RETRY_WAIT_MS = [5_000];
const USER_AGENT = 'MeteoMapGal/1.0 (+https://meteomapgal.com; ola@meteomapgal.com)';

export class IntecmarAuthError extends Error {}

export class IntecmarBudgetError extends Error {}

/** The token was refused again after this pass's one new login: the pass is aborted. */
export class IntecmarSessionError extends Error {}

/** The breaker is open after failures in a row: nothing is sent until it closes. */
export class IntecmarBreakerError extends Error {}

export class IntecmarHttpError extends Error {
  constructor(public readonly status: number, path: string) {
    super(`INTECMAR ${path}: HTTP ${status}`);
  }
}

/** Who asks: counted apart in the daily ledger. */
export type IntecmarTag = 'vivo' | 'noche';

/** One pass of a caller (a live pass, a night): it may log in again once, never per request. */
export interface IntecmarPass {
  tag: IntecmarTag;
  relogged: boolean;
}

export function newPass(tag: IntecmarTag): IntecmarPass {
  return { tag, relogged: false };
}

export function intecmarCredentials(): { user: string; password: string } | null {
  const user = process.env.INTECMAR_USER?.trim();
  const password = process.env.INTECMAR_PASSWORD;
  return user && password ? { user, password } : null;
}

let token: string | null = null;
let tokenUntil = 0;
let loggingIn: Promise<string> | null = null;
let lastRequestAt = 0;
let gate: Promise<void> = Promise.resolve();
let stoppedReason: string | null = null;
const startedAt = Date.now();
let ledger: RequestLedger = emptyLedger(startedAt);
let capWarnedDay = '';
let breaker: BreakerState = closedBreaker();

/** Why the account was given up (wrong credentials), or null while it works. */
export function intecmarStopped(): string | null {
  return stoppedReason;
}

export function intecmarDailyCap(): number {
  return dailyCap(process.env.INTECMAR_MAX_REQUESTS_PER_DAY);
}

/** Whether the breaker is refusing requests now (the callers skip their pass quietly). */
export function intecmarBreakerOpen(nowMs = Date.now()): boolean {
  return breakerOpen(breaker, nowMs);
}

/** Requests still allowed today (UTC). */
export function intecmarRequestsLeft(nowMs = Date.now()): number {
  return requestsLeft(ledger, nowMs, intecmarDailyCap());
}

/** The daily count (rolled to `nowMs`) and when the process started counting. */
export function intecmarLedger(nowMs = Date.now()): { ledger: RequestLedger; startedAt: number } {
  ledger = rollLedger(ledger, nowMs);
  return { ledger, startedAt };
}

/** The single warning line of the day when the cap is reached (by a refused request or a skipped pass). */
export function noteCapReached(nowMs = Date.now()): void {
  const today = rollLedger(ledger, nowMs).current;
  if (capWarnedDay === today.day) return;
  capWarnedDay = today.day;
  log.warn(`[INTECMAR] tope diario de ${intecmarDailyCap()} peticiones alcanzado (${describeDay(today)}): nada mas a api.intecmar.gal hasta las 00:00 UTC; el tiempo real sigue por MeteoGalicia`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Waits its turn (one request every PAUSE_MS across live and night), then counts the request against
 * the day. Throws IntecmarBudgetError, without counting, when the cap is reached.
 */
function pace(tag: IntecmarTag): Promise<void> {
  const turn = gate.then(async () => {
    const wait = lastRequestAt + PAUSE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    const now = Date.now();
    if (requestsLeft(ledger, now, intecmarDailyCap()) <= 0) {
      noteCapReached(now);
      throw new IntecmarBudgetError('tope diario de peticiones alcanzado');
    }
    ledger = addRequest(ledger, now, tag);
    lastRequestAt = now;
  });
  gate = turn.catch(() => undefined);
  return turn;
}

async function login(tag: IntecmarTag): Promise<string> {
  const creds = intecmarCredentials();
  if (!creds) throw new IntecmarAuthError('sin INTECMAR_USER / INTECMAR_PASSWORD');
  if (breakerOpen(breaker, Date.now())) throw new IntecmarBreakerError('demasiados fallos seguidos, en pausa');
  await pace(tag);
  let res: Response;
  try {
    res = await fetch(`${BASE}/auth/user_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', accept: 'application/json', 'User-Agent': USER_AGENT },
      body: new URLSearchParams({ username: creds.user, password: creds.password, grant_type: 'password' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    noteAnswer(false);
    throw err;
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    stoppedReason = `login rechazado (HTTP ${res.status})`;
    throw new IntecmarAuthError(stoppedReason);
  }
  if (!res.ok) {
    noteAnswer(false);
    throw new IntecmarHttpError(res.status, '/auth/user_token');
  }
  noteAnswer(true);
  const body = (await res.json()) as { access_token?: unknown };
  if (typeof body.access_token !== 'string') {
    stoppedReason = 'login sin token';
    throw new IntecmarAuthError(stoppedReason);
  }
  token = body.access_token;
  tokenUntil = tokenExpiryMs(token, Date.now());
  return token;
}

async function currentToken(tag: IntecmarTag): Promise<string> {
  if (token && Date.now() < tokenUntil) return token;
  if (!loggingIn) loggingIn = login(tag).finally(() => { loggingIn = null; });
  return loggingIn;
}

function noteAnswer(ok: boolean): void {
  const wasOpen = breakerOpen(breaker, Date.now());
  breaker = breakerNote(breaker, ok, Date.now());
  if (!wasOpen && breakerOpen(breaker, Date.now())) {
    log.warn(`[INTECMAR] varios fallos seguidos: no se pregunta a api.intecmar.gal hasta las ${new Date(breaker.openUntil).toISOString().slice(11, 16)} UTC`);
  }
}

/**
 * GET a data endpoint (`path` starts with "/") within a pass. Throws IntecmarAuthError (credentials
 * rejected, now or before), IntecmarSessionError (token refused after the pass's one new login: abort
 * the pass), IntecmarBreakerError, IntecmarBudgetError (daily cap) or IntecmarHttpError.
 */
export async function intecmarGet(path: string, params: Record<string, string | number>, pass: IntecmarPass): Promise<unknown> {
  if (stoppedReason) throw new IntecmarAuthError(stoppedReason);
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  for (let attempt = 0; ; attempt++) {
    if (breakerOpen(breaker, Date.now())) throw new IntecmarBreakerError('demasiados fallos seguidos, en pausa');
    const bearer = await currentToken(pass.tag);
    await pace(pass.tag);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { accept: 'application/json', Authorization: `Bearer ${bearer}`, 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      noteAnswer(false);
      throw err;
    }
    if (res.ok) {
      noteAnswer(true);
      return res.json();
    }
    if (res.status === 401) {
      if (pass.relogged) throw new IntecmarSessionError('token rechazado tras un nuevo login en esta pasada');
      if (token === bearer) token = null;
      pass.relogged = true;
      continue;
    }
    const transient = res.status === 429 || res.status >= 500;
    if (transient && attempt < RETRY_WAIT_MS.length) {
      await sleep(RETRY_WAIT_MS[attempt]);
      continue;
    }
    if (transient) noteAnswer(false);
    throw new IntecmarHttpError(res.status, path);
  }
}
