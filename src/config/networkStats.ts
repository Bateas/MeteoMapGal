import { ALL_SPOTS } from './spots';
import { ALL_WEBCAMS } from './webcams';
import { RIAS_BUOY_STATIONS } from '../api/buoyClient';

/**
 * How big the network is, for the places that tell a visitor about it.
 *
 * These numbers used to be typed into the README and the in-app guide by hand,
 * and by August they were describing a different project: "100+ estaciones"
 * when there were 457, "966 tests" when there were 1829, thirteen spots when
 * there were fourteen. Nobody lied — the figures were true when written and
 * nothing made them wrong out loud when they stopped being.
 *
 * So anything that can be counted from the configuration is counted here
 * instead of retyped. What genuinely cannot — the size of the station network,
 * which lives in the database and grows on its own — sits below as a single
 * constant with the date it was measured, in one place rather than five.
 */

/** Spots with an automatic verdict, split by what they answer for. */
export const SPOT_COUNT = ALL_SPOTS.length;
export const SURF_SPOT_COUNT = ALL_SPOTS.filter((s) => s.category === 'surf').length;
export const SAILING_SPOT_COUNT = SPOT_COUNT - SURF_SPOT_COUNT;

/** Webcams wired for vision analysis. */
export const WEBCAM_COUNT = ALL_WEBCAMS.length;

/** Marine buoys configured. `enabled: false` ones stay in the count because
 *  they are part of the network and their absence is the news, not a tidy-up:
 *  Cíes has been offline since December 2025 and saying "12" would quietly
 *  bury that. */
export const BUOY_COUNT = RIAS_BUOY_STATIONS.length;

/**
 * Stations reaching the ingestor. Cannot be derived here — discovery decides
 * it at runtime against six upstream networks — so it is a measurement with a
 * date attached rather than a claim.
 *
 * Live figure any time: `/api/v1/stations`.
 */
export const STATION_COUNT_MEASURED = 457;
export const STATION_COUNT_MEASURED_ON = '2026-08-04';

/** The six upstream networks, in the order the map credits them. Counts are
 *  deliberately absent: they move every week and a stale breakdown is worse
 *  than none. What each network IS does not move. */
export const SOURCES = [
  { key: 'aemet', name: 'AEMET', what: 'Agencia Estatal de Meteorología' },
  { key: 'meteogalicia', name: 'MeteoGalicia', what: 'Xunta de Galicia' },
  { key: 'meteoclimatic', name: 'Meteoclimatic', what: 'Red ciudadana' },
  { key: 'wunderground', name: 'Weather Underground', what: 'Estaciones personales' },
  { key: 'netatmo', name: 'Netatmo', what: 'Red doméstica IoT' },
  { key: 'skyx', name: 'SkyX', what: 'Estación portátil, auto-descubrimiento por GPS' },
] as const;

/** "más de 400" ages better than "457", which is wrong the day after. */
export function approxStationCount(): string {
  return `más de ${Math.floor(STATION_COUNT_MEASURED / 50) * 50}`;
}
