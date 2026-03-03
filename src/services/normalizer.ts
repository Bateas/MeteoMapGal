import type { AemetRawObservation, AemetRawStation } from '../types/aemet';
import type { MeteoGaliciaStation, MeteoGaliciaObsEntry, MeteoGaliciaMedida } from '../types/meteogalicia';
import type { MeteoclimaticRawStation, MeteoclimaticStationMeta } from '../types/meteoclimatic';
import type { NormalizedStation, NormalizedReading } from '../types/station';
import { MG_PARAMS } from '../types/meteogalicia';
import { aemetDmsToDecimal } from './geoUtils';

/** Normalize an AEMET station from inventory to our format */
export function normalizeAemetStation(raw: AemetRawStation): NormalizedStation {
  return {
    id: `aemet_${raw.indicativo}`,
    source: 'aemet',
    name: raw.nombre,
    lat: aemetDmsToDecimal(raw.latitud),
    lon: aemetDmsToDecimal(raw.longitud),
    altitude: raw.altitud,
    province: raw.provincia,
  };
}

/** Normalize an AEMET observation to our reading format */
export function normalizeAemetObservation(raw: AemetRawObservation): NormalizedReading {
  return {
    stationId: `aemet_${raw.idema}`,
    timestamp: new Date(raw.fint),
    windSpeed: raw.vv ?? null,
    windGust: raw.vmax ?? null,
    windDirection: raw.dv ?? null,
    temperature: raw.ta ?? null,
    humidity: raw.hr ?? null,
    precipitation: raw.prec ?? null,
  };
}

/** Normalize a MeteoGalicia station */
export function normalizeMeteoGaliciaStation(raw: MeteoGaliciaStation): NormalizedStation {
  return {
    id: `mg_${raw.idEstacion}`,
    source: 'meteogalicia',
    name: raw.estacion,
    lat: raw.lat,
    lon: raw.lon,
    altitude: raw.altitude,
    province: raw.provincia,
    municipality: raw.concello,
  };
}

/** Helper: find a measurement by parameter code in MeteoGalicia medidas */
function findMedida(medidas: MeteoGaliciaMedida[], code: string): number | null {
  const found = medidas.find((m) => m.codigoParametro === code);
  return found ? found.valor : null;
}

/** Normalize a MeteoGalicia observation entry to our reading format.
 *  The actual API structure is:
 *  { estacion, idEstacion, instanteLecturaUTC, listaMedidas: [{ codigoParametro, valor, ... }] }
 */
export function normalizeMeteoGaliciaObservation(
  stationId: number,
  entry: MeteoGaliciaObsEntry
): NormalizedReading | null {
  if (!entry || !entry.listaMedidas || entry.listaMedidas.length === 0) return null;

  // Parse UTC timestamp - append 'Z' if not present
  const tsStr = entry.instanteLecturaUTC.endsWith('Z')
    ? entry.instanteLecturaUTC
    : entry.instanteLecturaUTC + 'Z';
  const timestamp = new Date(tsStr);

  return {
    stationId: `mg_${stationId}`,
    timestamp,
    windSpeed: findMedida(entry.listaMedidas, MG_PARAMS.WIND_SPEED),
    windGust: null,
    windDirection: findMedida(entry.listaMedidas, MG_PARAMS.WIND_DIRECTION),
    temperature: findMedida(entry.listaMedidas, MG_PARAMS.TEMPERATURE),
    humidity: findMedida(entry.listaMedidas, MG_PARAMS.HUMIDITY),
    precipitation: findMedida(entry.listaMedidas, MG_PARAMS.PRECIPITATION),
  };
}

/** Derive province from Meteoclimatic station ID prefix */
function mcProvince(stationId: string): string {
  if (stationId.startsWith('ESGAL36')) return 'PONTEVEDRA';
  if (stationId.startsWith('ESGAL32')) return 'OURENSE';
  return 'DESCONOCIDA';
}

/** Normalize a Meteoclimatic station (requires pre-known coordinates) */
export function normalizeMeteoclimaticStation(
  raw: MeteoclimaticRawStation,
  meta: MeteoclimaticStationMeta
): NormalizedStation {
  return {
    id: `mc_${raw.id}`,
    source: 'meteoclimatic',
    name: raw.location,
    lat: meta.lat,
    lon: meta.lon,
    altitude: meta.altitude,
    province: mcProvince(raw.id),
  };
}

/** Normalize a Meteoclimatic observation to our reading format.
 *  Wind speed is converted from km/h to m/s.
 */
export function normalizeMeteoclimaticObservation(
  raw: MeteoclimaticRawStation
): NormalizedReading {
  // Parse the RSS-style date: "Wed, 25 Feb 2026 23:32:08 +0000"
  const timestamp = new Date(raw.pubDate);

  return {
    stationId: `mc_${raw.id}`,
    timestamp,
    windSpeed: raw.windSpeed !== null ? raw.windSpeed / 3.6 : null, // km/h → m/s
    windGust: null,
    windDirection: raw.windAzimuth,
    temperature: raw.temperature,
    humidity: raw.humidity,
    precipitation: raw.rain,
  };
}
