/**
 * Hourly forecast data point for the reservoir area.
 * Used by the forecast timeline UI.
 */
export interface HourlyForecast {
  /** Local time (Europe/Madrid) */
  time: Date;
  /** Temperature at 2m (°C) */
  temperature: number | null;
  /** Relative humidity (%) */
  humidity: number | null;
  /** Wind speed at 10m (m/s — convert to kt for display) */
  windSpeed: number | null;
  /** Wind direction at 10m (degrees, meteorological "from") */
  windDirection: number | null;
  /** Wind gusts at 10m (m/s) */
  windGusts: number | null;
  /** Precipitation (mm) in the hour */
  precipitation: number | null;
  /** Precipitation probability (%) */
  precipProbability: number | null;
  /** Cloud cover (%) */
  cloudCover: number | null;
  /** Surface pressure (hPa) */
  pressure: number | null;
  /** Shortwave radiation (W/m²) */
  solarRadiation: number | null;
  /** CAPE (J/kg) — convective potential */
  cape: number | null;
  /** Planetary boundary layer height (m) */
  boundaryLayerHeight: number | null;
  /** Visibility (m) — from Open-Meteo. <1000m = fog, <5000m = mist */
  visibility: number | null;
  /** Is it currently daytime? */
  isDay: boolean;
}

/** Supported forecast model identifiers */
export type ForecastModel = 'best_match' | 'icon_eu' | 'gfs_seamless' | 'ecmwf_ifs025';

/** Model display metadata */
export const FORECAST_MODELS: { id: ForecastModel; label: string; short: string; desc: string }[] = [
  { id: 'best_match', label: 'Auto (Best Match)', short: 'Auto', desc: 'Open-Meteo selecciona el mejor modelo' },
  { id: 'icon_eu', label: 'ICON-EU (DWD)', short: 'ICON', desc: 'Alta resolución Europa 7km, actualización horaria' },
  { id: 'gfs_seamless', label: 'GFS (NOAA)', short: 'GFS', desc: 'Global 13km, actualización cada 6h' },
  { id: 'ecmwf_ifs025', label: 'ECMWF IFS', short: 'ECMWF', desc: 'Europeo 25km, alta precisión' },
];

/**
 * Forecast data state for the timeline component.
 */
export interface ForecastState {
  hourly: HourlyForecast[];
  fetchedAt: Date | null;
  isLoading: boolean;
  error: string | null;
  activeModel: ForecastModel;
}
