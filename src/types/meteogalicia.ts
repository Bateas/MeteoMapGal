/** MeteoGalicia station from listaEstacionsMeteo */
export interface MeteoGaliciaStation {
  idEstacion: number;
  estacion: string;      // Station name
  lat: number;           // Latitude (decimal degrees)
  lon: number;           // Longitude (decimal degrees)
  altitude: number;      // Altitude (meters)
  concello: string;      // Municipality
  provincia: string;     // Province
  utmx: string;
  utmy: string;
}

/** Single measurement value from MeteoGalicia */
export interface MeteoGaliciaMedida {
  codigoParametro: string;       // e.g. "HR_AVG_1.5m"
  nomeParametro: string;         // e.g. "Humidade relativa media a 1.5m"
  unidade: string;               // e.g. "%", "ºC", "m/s"
  valor: number;
  lnCodigoValidacion: number;
}

/** MeteoGalicia last 10-min observation entry */
export interface MeteoGaliciaObsEntry {
  estacion: string;
  idEstacion: number;
  instanteLecturaUTC: string;    // e.g. "2026-02-25T20:50:00"
  listaMedidas: MeteoGaliciaMedida[];
}

/** MeteoGalicia last 10-min response */
export interface MeteoGaliciaObsResponse {
  listUltimos10min: MeteoGaliciaObsEntry[];
}

/** MeteoGalicia parameter codes */
export const MG_PARAMS = {
  WIND_DIRECTION: 'DV_AVG_10m',
  WIND_SPEED: 'VV_AVG_10m',
  TEMPERATURE: 'TA_AVG_1.5m',
  HUMIDITY: 'HR_AVG_1.5m',
  PRECIPITATION: 'PP_SUM_1.5m',
} as const;
