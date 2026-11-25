/**
 * Do we know the official warnings? One rule for every surface that says them (18-nov): the strip over the map,
 * the strip under it and Condiciones. Before the first poll nothing has failed yet; after it, we know them while
 * MeteoGalicia really answered within the last hour (the warnings are polled every 15 min). The download keeps
 * its old copy on a failure, so «polled» alone does not say how old the warnings are.
 */
export const OFFICIAL_MAX_SILENCE_MS = 60 * 60_000;

export function officialWarningsKnown(lastPoll: Date | null, lastOkMs: number, nowMs: number): boolean {
  return lastPoll === null || nowMs - lastOkMs < OFFICIAL_MAX_SILENCE_MS;
}

/** What the strip over the map says when they are not known: never silence, which reads as «nothing». */
export const OFFICIAL_UNKNOWN_TITLE = 'Avisos oficiales sin dato';
export const OFFICIAL_UNKNOWN_DETAIL = 'MeteoGalicia no responde: puede haber avisos que no vemos';
