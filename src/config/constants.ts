/** Centro del mapa: zona embalse Castrelo de Miño / Ribadavia */
export const MAP_CENTER: [number, number] = [-8.1, 42.29]; // [lon, lat]

/** Radio de búsqueda de estaciones en km */
export const DISCOVERY_RADIUS_KM = 25;

/** Intervalo de refresco de datos (10 minutos) */
export const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

/** Máximo de lecturas en historial por estación (48h a intervalos de 10min) */
export const MAX_HISTORY_ENTRIES = 288;

/** Umbral de datos obsoletos (minutos) */
export const STALE_THRESHOLD_MIN = 30;
export const OFFLINE_THRESHOLD_MIN = 60;

/** Vista inicial del mapa */
export const INITIAL_VIEW_STATE = {
  longitude: MAP_CENTER[0],
  latitude: MAP_CENTER[1],
  zoom: 11,
  pitch: 50,
  bearing: -15,
} as const;
