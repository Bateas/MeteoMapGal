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
  /** Lifted Index (°C) — negative = unstable. <-3 strong instability, >0 stable */
  liftedIndex: number | null;
  /** Convective Inhibition (J/kg) — high CIN suppresses convection even with high CAPE */
  cin: number | null;
  /** Snow level (m) — altitude above which precipitation falls as snow */
  snowLevel: number | null;
  /** Sky state from MeteoSIX WRF (SUNNY, CLOUDY, FOG, STORMS, etc.) — null for Open-Meteo */
  skyState: string | null;
  /** Is it currently daytime? */
  isDay: boolean;
  // ── Marine wave data (from Open-Meteo Marine API or MeteoSIX USWAN, Rías surf spots only) ──
  /** Significant wave height (m) */
  waveHeight?: number | null;
  /** Peak wave period (s) */
  wavePeriod?: number | null;
  /** Wave direction (degrees) */
  waveDirection?: number | null;
  /** Swell wave height (m) — ocean swell component */
  swellHeight?: number | null;
  /** Swell wave period (s) */
  swellPeriod?: number | null;
}

/** Supported forecast model identifiers */
export type ForecastModel = 'best_match' | 'icon_eu' | 'gfs_seamless' | 'ecmwf_ifs025' | 'meteosix_wrf';

/** Model display metadata — only Auto + WRF-MG shown to users.
 *  ICON/GFS/ECMWF removed from UI (niche, no system depends on them).
 *  Auto provides CAPE/CIN/LI/gusts for storm predictor + alerts.
 *  WRF-MG provides 1km resolution wind/temp for Galicia. */
export const FORECAST_MODELS: { id: ForecastModel; label: string; short: string; desc: string }[] = [
  { id: 'meteosix_wrf', label: 'WRF MeteoGalicia', short: 'WRF-MG', desc: 'Modelo regional 1km Galicia, MeteoGalicia' },
  { id: 'best_match', label: 'Auto (Open-Meteo)', short: 'Auto', desc: 'Modelo global + CAPE, rachas, visibilidad' },
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
