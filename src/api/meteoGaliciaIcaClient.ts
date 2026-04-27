/**
 * MeteoGalicia ICA (Índice de Calidade do Aire) client.
 *
 * Official Xunta de Galicia air-quality network: ~30 monitored stations
 * reporting hourly. We hit the ESRI ArcGIS REST endpoint (CORS allowed)
 * directly — no proxy needed.
 *
 * Layer 1 = ICA_Observacion (actual measurements). Layer 0 is forecast.
 *
 * ICA scale (Galicia/Spain national index):
 *   1 = Buena/Boa, 2 = Aceptable, 3 = Deficiente, 4 = Mala, 5 = Muy mala
 *
 * Each reading also reports the limiting pollutant (`parametro_maximo`):
 * O3, NO2, PM10, PM25, SO2, CO, BEN.
 */

const ENDPOINT =
  'https://ideg.xunta.gal/meteogalicia/rest/services/' +
  'METEO2_WS/Observacion_Predicion_Calidad_Aire/MapServer/1/query';

export type IcaCategory = 'buena' | 'aceptable' | 'deficiente' | 'mala' | 'muy_mala' | 'unknown';

export interface IcaReading {
  station: string;
  /** Decimal value 1.0-5.0 (interpolated). Bucket via icaCategory() */
  ica: number;
  /** Pollutant driving the index (O3, NO2, PM10, PM25, etc) */
  dominantPollutant: string;
  /** Spanish category label from the source */
  categoryEs: string;
  /** Hex color from the source */
  color: string;
  lat: number;
  lon: number;
  timestamp: Date;
}

interface ArcGisFeature {
  attributes: {
    estacion: string;
    valor_ica: number;
    nombre_es: string;
    parametro_maximo: string;
    rgb: string;
    latWGS84: number;
    lonWGS84: number;
    sFecha: string;
  };
}

/**
 * Fetch the latest ICA observation for every reporting station.
 *
 * Server-side filter: `fecha >= CURRENT_TIMESTAMP - 1` (last day) — keeps
 * the response small. We then de-dup keeping the freshest record per station.
 */
export async function fetchIcaObservations(): Promise<IcaReading[]> {
  const params = new URLSearchParams({
    where: 'fecha>=CURRENT_TIMESTAMP-1',
    outFields: 'estacion,valor_ica,nombre_es,parametro_maximo,rgb,latWGS84,lonWGS84,sFecha',
    f: 'json',
    orderByFields: 'fecha DESC',
    resultRecordCount: '500',
  });

  try {
    const res = await fetch(`${ENDPOINT}?${params}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const json = await res.json();
    const features: ArcGisFeature[] = json?.features ?? [];

    // De-dup: keep first record per station (orderByFields is DESC so first = freshest)
    const seen = new Set<string>();
    const out: IcaReading[] = [];
    for (const f of features) {
      const a = f.attributes;
      if (!a?.estacion || seen.has(a.estacion)) continue;
      if (typeof a.valor_ica !== 'number' || !Number.isFinite(a.valor_ica)) continue;
      if (typeof a.latWGS84 !== 'number' || typeof a.lonWGS84 !== 'number') continue;
      seen.add(a.estacion);
      out.push({
        station: a.estacion,
        ica: a.valor_ica,
        dominantPollutant: a.parametro_maximo ?? '',
        categoryEs: a.nombre_es ?? '',
        color: a.rgb ?? '#94a3b8',
        lat: a.latWGS84,
        lon: a.lonWGS84,
        timestamp: new Date(a.sFecha?.replace(' ', 'T') + 'Z'),
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Map decimal ICA (1-5) to a discrete category */
export function icaCategory(value: number): IcaCategory {
  if (!Number.isFinite(value)) return 'unknown';
  if (value < 1.5) return 'buena';
  if (value < 2.5) return 'aceptable';
  if (value < 3.5) return 'deficiente';
  if (value < 4.5) return 'mala';
  return 'muy_mala';
}
