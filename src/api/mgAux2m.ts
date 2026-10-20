/**
 * MeteoGalicia's 2 m wind and leaf wetness, for the SHADOW archive only.
 *
 * 39 stations of MeteoGalicia's network (most of the 19xxx agro-meteorological series: Prado next to
 * the Castrelo reservoir, EVEGA Leiro, Cequeliños...) measure wind only at 2 m, among the vines, plus
 * hours of wet leaf. `MG_PARAMS` and the normalizer know only the 10 m codes, so all of it was dropped
 * without a trace. It already comes in the one `ultimos10minEstacionsMeteo` answer we ask for every
 * cycle: archiving it costs no request.
 *
 * It must NOT reach `windSpeed`, the scoring engine or the map. At 2 m among vines the 10-min mean
 * read about a quarter of the wind on the water on the one strong day checked (3-aug), while the
 * direction matched the SW entry. Until an exam against field truths validates it, it is archived
 * apart and read by nothing. That is why these codes live here and not in `MG_PARAMS`.
 *
 * Pure: shared by the ingestor; same -9999 handling and validation code as the rest of the source.
 */
import type { MeteoGaliciaMedida, MeteoGaliciaObsEntry } from '../types/meteogalicia';

/** Parameter codes of the 2 m set, as MeteoGalicia names them. */
export const MG_AUX_PARAMS = {
  WIND_SPEED_2M: 'VV_AVG_2m',
  WIND_GUST_2M: 'VV_RACHA_2m',
  WIND_DIRECTION_2M: 'DV_AVG_2m',
  WIND_SPEED_SD_2M: 'VV_SD_2m',
  WIND_DIR_SD_2M: 'DV_SD_2m',
  LEAF_WETNESS: 'HF_SUM_2m',
} as const;

/** MeteoGalicia's validation code for a good value (2 suspect, 3 wrong, 5 interpolated, 9 not recorded). */
export const MG_VALID_CODE = 1;

export interface MgAuxReading {
  stationId: string;          // mg_<id>, like the readings table
  time: Date;                 // UTC
  wind2m: number | null;      // m/s, 10-min mean at 2 m
  gust2m: number | null;      // m/s
  dir2m: number | null;       // degrees, meteorological "from"
  windSd2m: number | null;    // m/s, std deviation of speed over the 10 min
  dirSd2m: number | null;     // degrees, std deviation of direction
  leafWetMin: number | null;  // minutes of wet leaf within the 10 min (0-10)
}

const within = (v: number | null, min: number, max: number): number | null =>
  v != null && Number.isFinite(v) && v >= min && v <= max ? v : null;

/** The value of one code, or null when absent, the -9999 sentinel, or flagged by MeteoGalicia's own
 *  quality control (any code but 1; a missing code is taken as valid, like the 10 m fields). */
function valid(medidas: MeteoGaliciaMedida[], code: string): MeteoGaliciaMedida | null {
  const m = medidas.find((x) => x.codigoParametro === code);
  if (!m || typeof m.valor !== 'number' || !Number.isFinite(m.valor) || m.valor <= -900) return null;
  if (m.lnCodigoValidacion != null && m.lnCodigoValidacion !== MG_VALID_CODE) return null;
  return m;
}

/** Speed in m/s; MeteoGalicia gives m/s, but a km/h unit is converted rather than stored ×3.6. */
function speedMs(m: MeteoGaliciaMedida | null, max = 60): number | null {
  if (!m) return null;
  const v = /km/i.test(m.unidade ?? '') ? m.valor / 3.6 : m.valor;
  return within(v, 0, max);
}

/** Leaf wetness as minutes of the 10. MeteoGalicia's duration sums in this feed come in HOURS
 *  (like HSOL_SUM: 0.1667 is the whole period); a unit spelled in minutes is taken as is. */
function leafWetMinutes(m: MeteoGaliciaMedida | null): number | null {
  if (!m) return null;
  const minutes = /min/i.test(m.unidade ?? '') ? m.valor : m.valor * 60;
  const v = within(minutes, 0, 10.5); // the source rounds a hair over the period
  return v == null ? null : Math.min(10, Math.round(v * 100) / 100);
}

/**
 * The 2 m wind and leaf wetness of one `ultimos10min` entry, or null when it carries none of them
 * (most 10 m stations) or its timestamp does not parse.
 */
export function parseMgAux2m(stationId: number, entry: MeteoGaliciaObsEntry | null | undefined): MgAuxReading | null {
  if (!entry || !Array.isArray(entry.listaMedidas) || typeof entry.instanteLecturaUTC !== 'string') return null;
  const ts = entry.instanteLecturaUTC.endsWith('Z') ? entry.instanteLecturaUTC : `${entry.instanteLecturaUTC}Z`;
  const time = new Date(ts);
  if (Number.isNaN(time.getTime())) return null;

  const med = entry.listaMedidas;
  const dir = valid(med, MG_AUX_PARAMS.WIND_DIRECTION_2M);
  const dirSd = valid(med, MG_AUX_PARAMS.WIND_DIR_SD_2M);
  const out: MgAuxReading = {
    stationId: `mg_${stationId}`,
    time,
    wind2m: speedMs(valid(med, MG_AUX_PARAMS.WIND_SPEED_2M)),
    gust2m: speedMs(valid(med, MG_AUX_PARAMS.WIND_GUST_2M)),
    dir2m: within(dir?.valor ?? null, 0, 360),
    windSd2m: speedMs(valid(med, MG_AUX_PARAMS.WIND_SPEED_SD_2M), 20), // above 20 m/s of spread is not wind
    dirSd2m: within(dirSd?.valor ?? null, 0, 180),
    leafWetMin: leafWetMinutes(valid(med, MG_AUX_PARAMS.LEAF_WETNESS)),
  };
  const any = out.wind2m != null || out.gust2m != null || out.dir2m != null
    || out.windSd2m != null || out.dirSd2m != null || out.leafWetMin != null;
  return any ? out : null;
}
