/**
 * MeteoGalicia's latest 10-min observations for many stations in ONE request.
 *
 * The official service (`ultimos10minEstacionsMeteo.action`) takes several station ids separated by
 * commas and answers one entry per station. We used to ask once per station: ~155 requests every 5 min
 * from the server (~44,600 a day), and the same fan-out from every browser whose copy of our API
 * failed. MeteoGalicia
 * audits request efficiency and temporarily blocks the IPs below its threshold (notice of 17-sep-2026),
 * so the server and the browser fallback both group the ids here.
 *
 * Pure: builds the urls and indexes the answer. Shared by `ingestor/fetchers.ts` and
 * `src/api/meteogaliciaClient.ts`, so the two cannot drift apart.
 */
import type { MeteoGaliciaObsEntry } from '../types/meteogalicia';

/** Ids per request. Our ~155 stations (12-oct) fit in one (~1 KB of url; MeteoGalicia has 166 in
 *  service); the cap only keeps the url bounded if the list ever grows. */
export const MG_IDS_PER_REQUEST = 200;

/**
 * Urls for the given station ids. Ids are deduplicated and sorted, so the same set always gives the
 * same url (and the browser fallback hits the proxy cache instead of the provider).
 */
export function latestObservationUrls(base: string, ids: number[], perRequest = MG_IDS_PER_REQUEST): string[] {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))].sort((a, b) => a - b);
  const urls: string[] = [];
  for (let i = 0; i < unique.length; i += perRequest) {
    const chunk = unique.slice(i, i + perRequest).join(',');
    urls.push(`${base}/mgrss/observacion/ultimos10minEstacionsMeteo.action?idEst=${chunk}`);
  }
  return urls;
}

/** One entry per station: the newest one it sent. Entries without a numeric id or a measure list are dropped. */
export function indexLatestById(body: unknown): Map<number, MeteoGaliciaObsEntry> {
  const out = new Map<number, MeteoGaliciaObsEntry>();
  const list = (body as { listUltimos10min?: unknown } | null)?.listUltimos10min;
  if (!Array.isArray(list)) return out;
  for (const raw of list) {
    const entry = raw as MeteoGaliciaObsEntry | null;
    if (typeof entry?.idEstacion !== 'number' || !Array.isArray(entry.listaMedidas)) continue;
    const prev = out.get(entry.idEstacion);
    if (!prev || String(entry.instanteLecturaUTC) > String(prev.instanteLecturaUTC)) out.set(entry.idEstacion, entry);
  }
  return out;
}
