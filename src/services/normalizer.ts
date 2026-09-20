import type { AemetRawObservation, AemetRawStation } from '../types/aemet';
import type { MeteoGaliciaStation, MeteoGaliciaObsEntry, MeteoGaliciaMedida } from '../types/meteogalicia';
import type { MeteoclimaticRawStation, MeteoclimaticStationMeta } from '../types/meteoclimatic';
import type { NormalizedStation, NormalizedReading } from '../types/station';
import { MG_PARAMS } from '../types/meteogalicia';
import { aemetDmsToDecimal } from './geoUtils';
import { provinceFromMeteoclimaticId } from './provinceService';

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

/** Build a station from an AEMET OBSERVATION row.
 *
 *  The climatological inventory and the observation feed are not the same
 *  population, and the inventory is the smaller one: measured 4-ago, 56 AEMET
 *  stations were reporting inside Galicia and only 31 of them existed in the
 *  inventory. The other 25 (11 of them with wind — Ribadeo, Burela, Carballo,
 *  Vimianzo, Noia, Silleda, Lugo, Monforte...) were downloaded every five
 *  minutes and dropped on the floor, because the fetcher keeps only the ids
 *  discovery already knows.
 *
 *  Observations also carry lat/lon as plain decimals, so they skip the
 *  degrees-minutes-seconds parsing the inventory needs. */
export function normalizeAemetObservationStation(raw: AemetRawObservation): NormalizedStation {
  return {
    id: `aemet_${raw.idema}`,
    source: 'aemet',
    name: raw.ubi,
    lat: raw.lat,
    lon: raw.lon,
    altitude: raw.alt,
  };
}

/** Normalize an AEMET observation to our reading format */
export function normalizeAemetObservation(raw: AemetRawObservation): NormalizedReading {
  // AEMET `vis` = visibility in km (SYNOP encoding 0-55). Sanity: accept 0-50,
  // reject SYNOP special codes (>=90). Only airport/aeronautical stations report it.
  const visRaw = raw.vis;
  const visibility = visRaw != null && visRaw >= 0 && visRaw <= 50 ? visRaw : null;
  return {
    stationId: `aemet_${raw.idema}`,
    timestamp: new Date(raw.fint),
    windSpeed: raw.vv ?? null,
    windGust: raw.vmax ?? null,
    windDirection: raw.dv ?? null,
    temperature: raw.ta ?? null,
    humidity: raw.hr ?? null,
    precipitation: raw.prec ?? null,
    solarRadiation: null, // AEMET obs don't include solar in this endpoint
    pressure: raw.plession ?? null,   // Station-level pressure (hPa)
    dewPoint: raw.tpr ?? null,        // Dew point from AEMET
    visibility,                       // km — null for stations without sensor
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

  // MeteoGalicia uses -9999 as sentinel for missing/error data — filter all fields
  const sanitize = (v: number | null) => (v !== null && v >= -900 ? v : null);
  const sanitizePositive = (v: number | null) => (v !== null && v >= 0 ? v : null);

  return {
    stationId: `mg_${stationId}`,
    timestamp,
    windSpeed: sanitizePositive(findMedida(entry.listaMedidas, MG_PARAMS.WIND_SPEED)),
    windGust: sanitizePositive(findMedida(entry.listaMedidas, MG_PARAMS.WIND_GUST)),
    windDirection: sanitize(findMedida(entry.listaMedidas, MG_PARAMS.WIND_DIRECTION)),
    temperature: sanitize(findMedida(entry.listaMedidas, MG_PARAMS.TEMPERATURE)),
    humidity: sanitizePositive(findMedida(entry.listaMedidas, MG_PARAMS.HUMIDITY)),
    precipitation: sanitizePositive(findMedida(entry.listaMedidas, MG_PARAMS.PRECIPITATION)),
    solarRadiation: sanitizePositive(findMedida(entry.listaMedidas, MG_PARAMS.SOLAR_RADIATION)),
    pressure: null, // MG doesn't report pressure in 10-min obs
    dewPoint: sanitize(findMedida(entry.listaMedidas, MG_PARAMS.DEW_POINT)),
  };
}

// The Meteoclimatic id spells the province out; `provinceService` reads all
// four INE codes. The version that lived here knew only 32 and 36 and called
// everything else 'DESCONOCIDA' — harmless while those were the only two feeds
// requested, wrong the moment A Coruna and Lugo were.

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
    province: provinceFromMeteoclimaticId(raw.id) ?? undefined,
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
    solarRadiation: null, // Meteoclimatic PWS don't report solar
    pressure: raw.pressure,
    dewPoint: null, // Meteoclimatic XML doesn't include dew point
  };
}

// ── IPMA (Portugal) ──────────────────────────────────────────

export interface IpmaFeatureProperties {
  idEstacao: number;
  localEstacao?: string;
  time: string;
  temperatura?: number | null;
  humidade?: number | null;
  intensidadeVento?: number | null;   // m/s
  intensidadeVentoKM?: number | null; // km/h
  ventoIntensidadeKm?: number | null; // alias
  ventoRachamx?: number | null;       // max gust km/h (if reported)
  idDireccVento?: number | null;      // 0..9 (1=N, 2=NE, 3=E, 4=SE, 5=S, 6=SW, 7=W, 8=NW, 9=N, 0=calm)
  idVentoDir?: number | null;         // alias
  precAcumulada?: number | null;
  pressao?: number | null;
  radiacao?: number | null;
  radTotal?: number | null;           // alias
}

export interface IpmaFeature {
  type: string;
  geometry: {
    type: string;
    coordinates: [number, number]; // [lon, lat]
  };
  properties: IpmaFeatureProperties;
}

const IPMA_WIND_DIR_TO_DEGREES: Record<number, number | null> = {
  0: null, // Sem rumo / calma
  1: 0,    // N
  2: 45,   // NE
  3: 90,   // E
  4: 135,  // SE
  5: 180,  // S
  6: 225,  // SW
  7: 270,  // W
  8: 315,  // NW
  9: 360,  // N
};

function sanitizeIpmaValue(val: number | null | undefined): number | null {
  if (val == null || val === -99 || val === -99.0 || val === -990 || val === -990.0) return null;
  return val;
}

function inferPortugueseDistrict(lat: number, lon: number): string {
  if (lat >= 41.6 && lon <= -8.2) return 'Viana do Castelo (Portugal)';
  if (lat >= 41.4 && lat < 41.8 && lon > -8.6 && lon <= -8.0) return 'Braga (Portugal)';
  if (lon > -8.0 && lon <= -7.2) return 'Vila Real (Portugal)';
  if (lon > -7.2) return 'Bragança (Portugal)';
  if (lat < 41.6 && lon <= -8.4) return 'Porto (Portugal)';
  return 'Portugal Norte';
}

/** Normalize an IPMA weather station */
export function normalizeIpmaStation(feature: IpmaFeature): NormalizedStation {
  const [lon, lat] = feature.geometry.coordinates;
  const props = feature.properties;
  return {
    id: `ipma_${props.idEstacao}`,
    source: 'ipma',
    name: props.localEstacao,
    lat,
    lon,
    altitude: 0, // IPMA surface GeoJSON doesn't report elevation in properties
    province: inferPortugueseDistrict(lat, lon),
  };
}

export function parseIpmaTimestamp(timeStr: string): Date {
  if (!timeStr) return new Date();
  // IPMA reports in UTC (e.g. '2026-09-20T18:00:00'). Without 'Z',
  // ECMAScript treats it as local time, shifting it 2h into the past in Spain.
  if (!timeStr.endsWith('Z') && !timeStr.includes('+')) {
    return new Date(`${timeStr}Z`);
  }
  return new Date(timeStr);
}

/** Normalize an IPMA surface observation */
export function normalizeIpmaReading(props: IpmaFeatureProperties): NormalizedReading {
  const temp = sanitizeIpmaValue(props.temperatura);
  const hum = sanitizeIpmaValue(props.humidade);
  const wSpeed = sanitizeIpmaValue(props.intensidadeVento);
  const wSpeedKm = sanitizeIpmaValue(props.intensidadeVentoKM ?? props.ventoIntensidadeKm);
  const wGustKm = sanitizeIpmaValue(props.ventoRachamx);
  const dirCode = props.idDireccVento ?? props.idVentoDir;

  // Calculate dew point if temperature and relative humidity are available
  let dewPoint: number | null = null;
  if (temp !== null && hum !== null && hum > 0 && hum <= 100) {
    const a = 17.27;
    const b = 237.7;
    const alpha = ((a * temp) / (b + temp)) + Math.log(hum / 100.0);
    dewPoint = Math.round(((b * alpha) / (a - alpha)) * 10) / 10;
  }

  // Speed in m/s: prefer intensidadeVento, fallback to intensidadeVentoKM / 3.6
  const finalWindSpeed = wSpeed !== null
    ? wSpeed
    : (wSpeedKm !== null ? Math.round((wSpeedKm / 3.6) * 10) / 10 : null);

  const finalWindGust = wGustKm !== null ? Math.round((wGustKm / 3.6) * 10) / 10 : null;

  const finalWindDir = dirCode != null && IPMA_WIND_DIR_TO_DEGREES[dirCode] !== undefined
    ? IPMA_WIND_DIR_TO_DEGREES[dirCode]
    : null;

  return {
    stationId: `ipma_${props.idEstacao}`,
    timestamp: parseIpmaTimestamp(props.time),
    windSpeed: finalWindSpeed,
    windGust: finalWindGust,
    windDirection: finalWindDir,
    temperature: temp,
    humidity: hum,
    precipitation: sanitizeIpmaValue(props.precAcumulada),
    solarRadiation: sanitizeIpmaValue(props.radiacao ?? props.radTotal),
    pressure: sanitizeIpmaValue(props.pressao),
    dewPoint,
  };
}

