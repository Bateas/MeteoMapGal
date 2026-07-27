/**
 * Named fire events, from our own API.
 *
 * A satellite hotspot is a hot 375m pixel and nothing more. EFFIS groups the
 * same detections, across passes and platforms, into an EVENT — with the
 * municipality it burns in and how many hectares it has taken. That is the
 * difference between "a detection 15 km away" and "Pazos de Borbén, 4 ha",
 * and it is the only reason this layer exists.
 *
 * The two are complementary, not redundant: hotspots are fast (minutes from
 * the overpass) while events are named but lag behind, so a fire that started
 * an hour ago shows as a hotspot and has no event yet.
 */

const API = '/api/v1';

export interface FireEvent {
  id: string;
  /** First detection / ignition estimate. Null when EFFIS omits it. */
  fireDate: Date | null;
  /** Last EFFIS revision — how current the burnt area figure is. */
  lastUpdate: Date | null;
  country: string | null;
  province: string | null;
  /** Municipality. The part that makes this worth showing. */
  commune: string | null;
  /** Burnt area in hectares. */
  areaHa: number | null;
  lat: number;
  lon: number;
  /** True when EFFIS places it in one of the four Galician provinces. */
  galicia: boolean;
}

interface RawEvent {
  id?: string;
  fireDate?: string | null;
  lastUpdate?: string | null;
  country?: string | null;
  province?: string | null;
  commune?: string | null;
  areaHa?: number | string | null;
  lat?: number | string | null;
  lon?: number | string | null;
  galicia?: boolean;
}

function toDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toNum(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fetch named events. Anything unusable is dropped rather than guessed: an
 * event without coordinates cannot be placed on a map, and one without an id
 * cannot be de-duplicated against itself on the next poll.
 */
export async function fetchFireEvents(days = 7): Promise<FireEvent[]> {
  try {
    const res = await fetch(`${API}/fires/events?days=${Math.max(1, Math.min(30, days))}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { events?: RawEvent[] };
    const out: FireEvent[] = [];
    for (const e of body.events ?? []) {
      const lat = toNum(e.lat);
      const lon = toNum(e.lon);
      if (!e.id || lat == null || lon == null) continue;
      out.push({
        id: e.id,
        fireDate: toDate(e.fireDate),
        lastUpdate: toDate(e.lastUpdate),
        country: e.country ?? null,
        province: e.province ?? null,
        commune: e.commune ?? null,
        areaHa: toNum(e.areaHa),
        lat,
        lon,
        galicia: e.galicia === true,
      });
    }
    return out;
  } catch (err) {
    // The endpoint only exists on deployed builds; in dev it may 404. Silence.
    console.debug('[fireEvents] unavailable:', err);
    return [];
  }
}

/** "Pazos de Borbén (Pontevedra)" — falls back gracefully as fields go missing. */
export function fireEventName(e: FireEvent): string {
  if (e.commune && e.province) return `${e.commune} (${e.province})`;
  return e.commune ?? e.province ?? e.country ?? 'Incendio';
}

/** "4 ha" / "1.240 ha" — null when EFFIS has not measured it yet. */
export function formatBurntArea(areaHa: number | null): string | null {
  if (areaHa == null || !Number.isFinite(areaHa) || areaHa <= 0) return null;
  return `${areaHa >= 1000 ? Math.round(areaHa).toLocaleString('es-ES') : Math.round(areaHa)} ha`;
}
