const AEMET_KEY = import.meta.env.VITE_AEMET_API_KEY;

export const AEMET = {
  /** All conventional observations (two-step: returns URL to data) */
  allObservations: () =>
    `/aemet-api/api/observacion/convencional/todas?api_key=${AEMET_KEY}`,

  /** Station inventory (two-step: returns URL to data) */
  stationInventory: () =>
    `/aemet-api/api/valores/climatologicos/inventarioestaciones/todasestaciones?api_key=${AEMET_KEY}`,

  /** Proxy for AEMET data URLs (step 2) */
  proxyDataUrl: (url: string) => {
    // AEMET step 2 returns full URLs like https://opendata.aemet.es/opendata/sh/XXXXX
    // We route through /aemet-data proxy
    const parsed = new URL(url);
    return `/aemet-data${parsed.pathname}${parsed.search}`;
  },
} as const;

export const METEOCLIMATIC = {
  /** Regional XML feed (e.g. ESGAL32 for Ourense) */
  regionFeed: (region: string) =>
    `/meteoclimatic-api/feed/xml/${region}`,
} as const;

export const METEOGALICIA = {
  /** List all meteorological stations */
  stationList: () =>
    `/meteogalicia-api/mgrss/observacion/listaEstacionsMeteo.action`,

  /** Last 10-min observations for a station */
  latestObservation: (stationId: number) =>
    `/meteogalicia-api/mgrss/observacion/ultimos10minEstacionsMeteo.action?idEst=${stationId}`,

  /** Current day observations for a station */
  currentDayObservation: (stationId: number) =>
    `/meteogalicia-api/mgrss/observacion/ultimasObservacions/datos24h.action?idEst=${stationId}`,
} as const;
