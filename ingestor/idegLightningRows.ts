/**
 * Rows for the IDEG lightning archive (`lightning_ideg`) from the Xunta's public map service
 * «Observacion_raios_ultimas_24h», layer 1 «DescargasUltimas24HConIntraNubes»: the one MeteoGalicia's
 * own lightning viewer draws. Unlike the feed the alerts read today, it includes the discharges that
 * stay inside the cloud (`CloudInd = 1`) and how well each one was located (sensors, error ellipse).
 *
 * Why keep it: in the season replay (8-oct) a third of the strikes that reached a site came from a
 * storm born on top of it, with no ground strike around before. Intra-cloud discharges usually start
 * minutes before the first ground strike. Stored as published, they let us measure whether they warn
 * earlier, without touching the alerts. Pure, so the tests run on real payloads.
 */

export interface IdegLightningRow {
  time: Date;
  lat: number;
  lon: number;
  /** kA, signed (polarity); null when the service leaves it empty */
  peakCurrent: number | null;
  /** CloudInd = 1: the discharge stayed inside the cloud */
  intraCloud: boolean;
  multiplicity: number | null;
  sensors: number | null;
  /** Error ellipse as published (SemiEjeMayor / SemiEjeMenor) */
  semiMajor: number | null;
  semiMinor: number | null;
  chiSquare: number | null;
  /** idDescargas of the layer, kept for reference only: an object id of a 24 h view may be reused */
  sourceId: number | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Features of an ArcGIS query (`f=json`, `outSR=4326`) to rows. Anything without a time or a
 *  position inside the world is dropped; nothing else is filtered: what counts is decided on read. */
export function idegLightningRows(payload: unknown): IdegLightningRow[] {
  const features = (payload as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const rows: IdegLightningRow[] = [];
  for (const f of features) {
    const a = (f as { attributes?: Record<string, unknown> }).attributes ?? {};
    const g = (f as { geometry?: { x?: unknown; y?: unknown } }).geometry ?? {};
    const t = num(a.Fecha);
    const lat = num(g.y);
    const lon = num(g.x);
    if (t == null || lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    rows.push({
      time: new Date(t),
      lat,
      lon,
      peakCurrent: num(a.PeakCurrent),
      intraCloud: a.CloudInd === 1,
      multiplicity: num(a.Multiplicidad),
      sensors: num(a.Nsensores),
      semiMajor: num(a.SemiEjeMayor),
      semiMinor: num(a.SemiEjeMenor),
      chiSquare: num(a.ChiSquare),
      sourceId: num(a.idDescargas),
    });
  }
  return rows;
}

/** True when the service says there are more records than it sent (paging needed). */
export function idegHasMore(payload: unknown): boolean {
  return (payload as { exceededTransferLimit?: unknown } | null)?.exceededTransferLimit === true;
}
