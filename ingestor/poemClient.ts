/**
 * Requests to POEM (https://poem.puertos.es), Puertos del Estado's API.
 *
 * The token: POEM signs you in through Puertos del Estado's identity manager
 * (MEM) in a browser and hands back a token that every request carries as
 * `Authorization: Bearer`. The server keeps that token, never the account
 * login, in `ingestor/.env` as POEM_TOKEN. It is a secret like any API key:
 * never in git, in a log or in a chat. Only its expiry date is ever printed.
 */

const POEM_BASE = 'https://poem.puertos.es';
const TIMEOUT_MS = 20_000;
/** Who is asking, with a contact for Puertos del Estado's operators. */
const USER_AGENT = 'MeteoMapGal/1.0 (+https://meteomapgal.com; datos@meteomapgal.com)';

export class PoemHttpError extends Error {
  constructor(public readonly status: number, path: string) {
    super(`POEM ${path}: HTTP ${status}`);
  }
}

/** The token from the environment, or null while there is none (then PORTUS is still read the old way). */
export function poemToken(): string | null {
  const t = process.env.POEM_TOKEN?.trim();
  return t ? t : null;
}

/**
 * GET a POEM endpoint. `path` starts with "/" (e.g. "/doris/mareas/redmar_mir_tr");
 * params go in the query as given ("fecha.ge", "Columns", "Limit"...).
 */
export async function poemGet(path: string, params: Record<string, string>, token: string): Promise<unknown> {
  const url = new URL(path, POEM_BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: {
      accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new PoemHttpError(res.status, path);
  return res.json();
}
