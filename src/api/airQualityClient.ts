/**
 * Open-Meteo Air Quality + UV client.
 *
 * Minimal fetch: UV index (from forecast API) + PM2.5/AQI (from AQ API).
 * Zone-based (sector center), NOT spot-specific.
 * Used for subtle badges in SpotPopup and ticker warnings — NOT overlays.
 *
 * Free, no API key, no CORS restrictions.
 */

import { openMeteoFetch } from './openMeteoQueue';

export interface AirQualityCurrent {
  uvIndex: number;
  pm2_5: number;
  europeanAqi: number;
  /** Saharan dust concentration μg/m³ (calima indicator) */
  dust: number;
  /** Atmospheric aerosol optical depth (0-3, higher = hazier) */
  aerosolOpticalDepth: number;
  fetchedAt: number;
}

const AQ_BASE = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const FORECAST_BASE = 'https://api.open-meteo.com/v1/forecast';

/**
 * Fetch current UV + AQ for a zone center.
 * Returns null on failure (non-critical data).
 */
export async function fetchAirQualityCurrent(
  lat: number,
  lon: number,
): Promise<AirQualityCurrent | null> {
  try {
    // Parallel: UV from forecast API + AQ from air-quality API
    const [uvRes, aqRes] = await Promise.all([
      openMeteoFetch(
        `${FORECAST_BASE}?latitude=${lat}&longitude=${lon}` +
        `&current=uv_index&timezone=Europe%2FMadrid&forecast_days=1`
      ).catch(() => null),
      openMeteoFetch(
        `${AQ_BASE}?latitude=${lat}&longitude=${lon}` +
        `&current=pm2_5,european_aqi,dust,aerosol_optical_depth&timezone=Europe%2FMadrid&forecast_days=1`
      ).catch(() => null),
    ]);

    const uvData = uvRes ? await uvRes.json() : null;
    const aqData = aqRes ? await aqRes.json() : null;

    return {
      uvIndex: uvData?.current?.uv_index ?? 0,
      pm2_5: aqData?.current?.pm2_5 ?? 0,
      europeanAqi: aqData?.current?.european_aqi ?? 0,
      dust: aqData?.current?.dust ?? 0,
      aerosolOpticalDepth: aqData?.current?.aerosol_optical_depth ?? 0,
      fetchedAt: Date.now(),
    };
  } catch (err) {
    console.warn('[AirQuality] Fetch failed:', (err as Error).message);
    return null;
  }
}
