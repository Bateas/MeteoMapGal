const AEMET_KEY = import.meta.env.VITE_AEMET_API_KEY;

export const AEMET = {
  /** All conventional observations (two-step: returns URL to data) */
  allObservations: () =>
    `/aemet-api/api/observacion/convencional/todas?api_key=${AEMET_KEY}`,

  /** Station inventory (two-step: returns URL to data) */
  stationInventory: () =>
    `/aemet-api/api/valores/climatologicos/inventarioestaciones/todasestaciones?api_key=${AEMET_KEY}`,

  /** National radar composite (two-step: returns URL to PNG) — covers all Spain including Galicia */
  radarNacional: () =>
    `/aemet-api/api/red/radar/nacional?api_key=${AEMET_KEY}`,

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

const METEOSIX_KEY = import.meta.env.VITE_METEOSIX_API_KEY;

export const METEOSIX = {
  /** Numeric forecast — models & grids must repeat per variable (API requirement) */
  forecast: (lon: number, lat: number, variables: string, grid = '1km', model = 'WRF') => {
    const count = variables.split(',').length;
    const models = Array(count).fill(model).join(',');
    const grids = Array(count).fill(grid).join(',');
    return `/meteosix-api/getNumericForecastInfo?coords=${lon},${lat}&variables=${variables}&models=${models}&grids=${grids}&lang=es&format=application/json&API_KEY=${METEOSIX_KEY}`;
  },
  /** Tide predictions */
  tides: (lon: number, lat: number) =>
    `/meteosix-api/getTidesInfo?coords=${lon},${lat}&lang=es&format=application/json&API_KEY=${METEOSIX_KEY}`,
  /** Sunrise/sunset */
  solar: (lon: number, lat: number) =>
    `/meteosix-api/getSolarInfo?coords=${lon},${lat}&format=application/json&API_KEY=${METEOSIX_KEY}`,
} as const;

export const METEOGALICIA = {
  /** List all meteorological stations */
  stationList: () =>
    `/meteogalicia-api/mgrss/observacion/listaEstacionsMeteo.action`,

  /** Last 10-min observations for a station */
  latestObservation: (stationId: number) =>
    `/meteogalicia-api/mgrss/observacion/ultimos10minEstacionsMeteo.action?idEst=${stationId}`,
} as const;
