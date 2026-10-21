/**
 * NAO/AO daily indices for the map, read from NOAA CPC by the server.
 *
 * Each visitor used to download both «current» files (~500 KB each, through a proxy) to read
 * 35 lines. The server reads them at most every 12 h and hands back four numbers per index.
 * A failed read keeps the last good answer (NOAA updates daily at best; on 21-oct-2026 the file
 * ended on 30-sep, and the map now ignores an index older than 10 days on its side).
 */
import { summariseIndex, type TeleconnectionIndex } from '../src/api/naoClient.js';
import { SERVER_USER_AGENT } from '../src/config/serverIdentity.js';
import { memoAsync } from './requestGuards.js';
import { log } from './logger.js';

const BASE = 'https://ftp.cpc.ncep.noaa.gov/cwlinks';
const FILES = {
  NAO: `${BASE}/norm.daily.nao.index.b500101.current.ascii`,
  AO: `${BASE}/norm.daily.ao.index.b500101.current.ascii`,
} as const;
const MEMO_MS = 12 * 60 * 60_000;

let lastGood: TeleconnectionIndex[] = [];

async function readIndex(name: 'NAO' | 'AO'): Promise<TeleconnectionIndex | null> {
  const res = await fetch(FILES[name], { headers: { 'User-Agent': SERVER_USER_AGENT }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`NOAA ${name}: HTTP ${res.status}`);
  return summariseIndex(await res.text(), name);
}

export const queryTeleconnections = memoAsync(MEMO_MS, async () => {
  const got = await Promise.allSettled([readIndex('NAO'), readIndex('AO')]);
  const indices = got.flatMap((g) => (g.status === 'fulfilled' && g.value ? [g.value] : []));
  if (indices.length > 0) {
    lastGood = indices;
  } else {
    const why = got.map((g) => (g.status === 'rejected' ? (g.reason as Error).message : 'sin datos')).join('; ');
    log.warn(`[Teleconnections] NOAA sin respuesta valida (${why}); se sirve la ultima buena`);
  }
  return { indices: lastGood };
});
