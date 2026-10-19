/**
 * Requests to the Observatorio Costeiro's API (https://api.intecmar.gal), for intecmarArchive.ts.
 *
 * The account: the project's free registration at apiweb.intecmar.gal. Its user and
 * password live only in `ingestor/.env` (INTECMAR_USER, INTECMAR_PASSWORD) and are never printed.
 * Login (OAuth2 password flow) gives a bearer token of ~3 h; it is reused until 5 minutes before it
 * expires, so a night's pass signs in once.
 *
 * INTECMAR audits the API and blocks requests below «minimum efficiency thresholds» it does not
 * publish (asked on 19-oct). So: one request at a time with a pause between them, a time limit on
 * each, at most two retries with a growing wait on 429/5xx, one new login on a 401, and a wrong
 * password stops the archive until the next restart instead of insisting.
 */
import { tokenExpiryMs } from './intecmarLogic.js';

const BASE = 'https://api.intecmar.gal';
const TIMEOUT_MS = 60_000;
const PAUSE_MS = 1_500;
const RETRY_WAIT_MS = [5_000, 20_000];
const USER_AGENT = 'MeteoMapGal/1.0 (+https://meteomapgal.com; ola@meteomapgal.com)';

export class IntecmarAuthError extends Error {}

export class IntecmarHttpError extends Error {
  constructor(public readonly status: number, path: string) {
    super(`INTECMAR ${path}: HTTP ${status}`);
  }
}

export function intecmarCredentials(): { user: string; password: string } | null {
  const user = process.env.INTECMAR_USER?.trim();
  const password = process.env.INTECMAR_PASSWORD;
  return user && password ? { user, password } : null;
}

let token: string | null = null;
let tokenUntil = 0;
let lastRequestAt = 0;
let requests = 0;

/** Requests made since the last call (the archive logs it per pass). */
export function takeRequestCount(): number {
  const n = requests;
  requests = 0;
  return n;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pace(): Promise<void> {
  const wait = lastRequestAt + PAUSE_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  requests++;
}

async function login(): Promise<string> {
  const creds = intecmarCredentials();
  if (!creds) throw new IntecmarAuthError('sin INTECMAR_USER / INTECMAR_PASSWORD');
  await pace();
  const res = await fetch(`${BASE}/auth/user_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', accept: 'application/json', 'User-Agent': USER_AGENT },
    body: new URLSearchParams({ username: creds.user, password: creds.password, grant_type: 'password' }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 400 || res.status === 401 || res.status === 403) throw new IntecmarAuthError(`login rechazado (HTTP ${res.status})`);
  if (!res.ok) throw new IntecmarHttpError(res.status, '/auth/user_token');
  const body = (await res.json()) as { access_token?: unknown };
  if (typeof body.access_token !== 'string') throw new IntecmarAuthError('login sin token');
  token = body.access_token;
  tokenUntil = tokenExpiryMs(token, Date.now());
  return token;
}

async function currentToken(): Promise<string> {
  return token && Date.now() < tokenUntil ? token : login();
}

/** GET a data endpoint (`path` starts with "/"). Throws IntecmarAuthError or IntecmarHttpError. */
export async function intecmarGet(path: string, params: Record<string, string | number>): Promise<unknown> {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  let relogged = false;
  for (let attempt = 0; ; attempt++) {
    const bearer = await currentToken();
    await pace();
    const res = await fetch(url, {
      headers: { accept: 'application/json', Authorization: `Bearer ${bearer}`, 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) return res.json();
    if (res.status === 401 && !relogged) {
      token = null;
      relogged = true;
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < RETRY_WAIT_MS.length) {
      await sleep(RETRY_WAIT_MS[attempt]);
      continue;
    }
    throw new IntecmarHttpError(res.status, path);
  }
}
