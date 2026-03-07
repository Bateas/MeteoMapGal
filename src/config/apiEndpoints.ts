const AEMET_KEY = import.meta.env.VITE_AEMET_API_KEY;

export const AEMET = {
  /** All conventional observations (two-step: returns URL to data) */
  allObservations: () =>
    `/aemet-api/api/observacion/convencional/todas?api_key=${AEMET_KEY}`,

  /** Station inventory (two-step: returns URL to data) */
  stationInventory: () =>
    `/aemet-api/api/valores/climatologicos/inventarioestaciones/todasestaciones?api_key=${AEMET_KEY}`,

  /** Regional radar image (two-step: returns URL to PNG) — 'ga' = Galicia/Cuntis */
  radarRegional: (radarId = 'ga') =>
    `/aemet-api/api/red/radar/regional/${radarId}?api_key=${AEMET_KEY}`,

  /** Proxy for AEMET data URLs (step 2) — validates origin to prevent SSRF */
  proxyDataUrl: (url: string) => {
    // AEMET step 2 returns full URLs like https://opendata.aemet.es/opendata/sh/XXXXX
    // We route through /aemet-data proxy.
    // Security: whitelist only opendata.aemet.es to prevent SSRF via proxy.
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('.aemet.es')) {
      throw new Error(`Invalid AEMET data URL domain: ${parsed.hostname}`);
    }
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
} as const;
