/** How a BETA weather point's rain is going against the WRF, as the server last worked it out. */
export interface MeteoPointStatus {
  state: string;
  text: string;
}

/** Null while the watcher is not running, or when the server does not answer: the card just leaves it out. */
export async function fetchMeteoPointStatus(id: string): Promise<MeteoPointStatus | null> {
  try {
    const res = await fetch(`/api/v1/meteo-point/status?id=${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const data = await res.json() as { state: string | null; text?: string };
    return data.state && data.text ? { state: data.state, text: data.text } : null;
  } catch {
    return null;
  }
}

/** The rain measured at a weather point's gauge. */
export interface GaugeRain {
  gauge: string;
  mm24h: number; mm3d: number; mm7d: number;
  n24h: number; n3d: number; n7d: number;
  lastAt: string | null;
}

/** Null when the point has no gauge, or the server does not answer: the card just leaves it out. */
export async function fetchMeteoPointRain(id: string): Promise<GaugeRain | null> {
  try {
    const res = await fetch(`/api/v1/meteo-point/rain?id=${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const data = await res.json() as Partial<GaugeRain> & { gauge: string | null };
    return data.gauge ? data as GaugeRain : null;
  } catch {
    return null;
  }
}
