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
  WIND_GUST: 'VV_RACHA_10m',
  TEMPERATURE: 'TA_AVG_1.5m',
  HUMIDITY: 'HR_AVG_1.5m',
  PRECIPITATION: 'PP_SUM_1.5m',
  SOLAR_RADIATION: 'RS_AVG_1.5m',   // W/m² — global solar radiation (pyranometer)
  DEW_POINT: 'TO_AVG_1.5m',         // °C — dew point temperature
  PRESSURE_SEA_LEVEL: 'PRED_AVG_1.5m', // hPa — reduced to sea level (PR_AVG_1.5m is station level)
  WIND_DIR_SD: 'DV_SD_10m',         // ° — std deviation of direction over the 10 min
  WIND_SPEED_SD: 'VV_SD_10m',       // m/s — std deviation of speed over the 10 min
  SUNSHINE: 'HSOL_SUM_1.5m',        // h of sun in the 10 min (0 to 0.1667)
  TEMP_10CM: 'TA_AVG_0.1m',         // °C — air 10 cm above the ground
  SOIL_TEMP: 'TS_AVG_-0.1m',        // °C — soil 10 cm deep
} as const;
