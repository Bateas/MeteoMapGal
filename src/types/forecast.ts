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
  /** Is it currently daytime? */
  isDay: boolean;
}

/**
 * Forecast data state for the timeline component.
 */
export interface ForecastState {
  hourly: HourlyForecast[];
  fetchedAt: Date | null;
  isLoading: boolean;
  error: string | null;
}
