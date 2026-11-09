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
