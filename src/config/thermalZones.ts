import type { MicroZone, ThermalWindRule } from '../types/thermal';

/**
 * Micro-geographic zones around the Castrelo de Miño reservoir.
 *
 * Station matching: stationPatterns are case-insensitive substrings matched
 * against station.name. A station matches a zone if ANY pattern matches.
 * Stations are assigned to the FIRST matching zone in order.
 */
export const MICRO_ZONES: MicroZone[] = [
  {
    id: 'embalse',
    name: 'Embalse Castrelo',
    stationPatterns: [
      'leiro', 'ribadavia', 'remunino', 'prado',
      'evega', 'castrelo',
    ],
    center: { lat: 42.295, lon: -8.115 },
    polygon: [
      [-8.20, 42.34], [-8.05, 42.34], [-8.02, 42.28],
      [-8.05, 42.24], [-8.20, 42.24], [-8.22, 42.28],
    ],
    color: '#3b82f6', // blue
    avgAltitude: 110,
  },
  {
    id: 'ourense',
    name: 'Ourense',
    stationPatterns: [
      'ourense', 'farixa', 'estacions', 'instituto',
    ],
    center: { lat: 42.335, lon: -7.865 },
    polygon: [
      [-7.92, 42.37], [-7.80, 42.37], [-7.78, 42.31],
      [-7.80, 42.28], [-7.92, 42.28], [-7.94, 42.31],
    ],
    color: '#f59e0b', // amber
    avgAltitude: 140,
  },
  {
    id: 'norte',
    name: 'Montaña Norte',
    stationPatterns: [
      'fornelos', 'gandarela', 'amiudal', 'beariz',
    ],
    center: { lat: 42.42, lon: -8.30 },
    polygon: [
      [-8.50, 42.48], [-8.10, 42.48], [-8.10, 42.36],
      [-8.50, 42.36],
    ],
    color: '#22c55e', // green
    avgAltitude: 630,
  },
  {
    id: 'sur',
    name: 'Valle Sur',
    stationPatterns: [
      'notaria', 'padrenda', 'cequelinos',
    ],
    center: { lat: 42.15, lon: -8.15 },
    polygon: [
      [-8.25, 42.20], [-8.05, 42.20], [-8.05, 42.10],
      [-8.25, 42.10],
    ],
    color: '#ec4899', // pink
    avgAltitude: 200,
  },
  {
    id: 'carballino',
    name: 'O Carballiño',
    stationPatterns: [
      'carball', 'carballiño', 'señorín', 'senorin',
      'caniza', 'anllo', 'san amaro',
    ],
    center: { lat: 42.41, lon: -8.08 },
    polygon: [
      [-8.15, 42.45], [-7.98, 42.45], [-7.98, 42.37],
      [-8.15, 42.37],
    ],
    color: '#a78bfa', // violet
    avgAltitude: 450,
  },
];

/**
 * Propagation axis: wind changes typically flow along this path.
 * Each entry is [sourceZoneId, targetZoneId, approx distance km].
 */
export const PROPAGATION_AXIS: [string, string, number][] = [
  ['norte', 'carballino', 12],
  ['carballino', 'embalse', 14],
  ['embalse', 'ourense', 22],
  ['embalse', 'sur', 16],
];

/**
 * Thermal wind rules for sailing at Embalse de Castrelo de Miño.
 *
 * Based on Open-Meteo Archive v2 analysis:
 * ~47,000 pts/location, Jun-Sep 2022-2025, calm <1 m/s filtered, 8-cardinal.
 *
 * OBJECTIVE: Predict navigable thermal wind at the reservoir.
 *
 * The thermal cycle at Castrelo:
 *   Morning (6-10h): NE breeze at embalse + E slope wind in montaña = building phase
 *   Midday (10-14h): NE continues, montaña E strengthens = contrast building
 *   Afternoon (14-18h): W thermal arrives at embalse (46% freq, 3.5 m/s) = SAILING WINDOW
 *   Late afternoon (18-22h): SW humid variant or N drainage begins
 *   Night: N drainage from Carballiño (48%), cools valley for next day
 *
 * Precursor signals:
 *   - Norte E morning (76% freq!) = very strong precursor of afternoon thermal
 *   - Ourense NE morning (57% freq) = confirms regional heating pattern
 *   - Carballiño N evening (48%) = drainage that resets thermal contrast
 */
export const DEFAULT_THERMAL_RULES: ThermalWindRule[] = [
  // ═══ PRIMARY: Navigable thermal at embalse ═══════════════

  {
    id: 'thermal_w_embalse',
    name: 'Térmico W navegable (Embalse)',
    description: 'Viento W 14-18h. 46% frecuencia, 3.5 m/s (7 kt). Principal ventana de navegación. n=271',
    enabled: true,
    conditions: {
      minTemp: 20,
      maxTemp: 26,
      minHumidity: 55,
      maxHumidity: 75,
      timeWindow: { from: 14, to: 18 },
      months: [6, 7, 8, 9],
    },
    expectedWind: {
      zone: 'embalse',
      directionRange: { from: 225, to: 315 }, // W ±45°
      minSpeed: 1.5,
    },
    source: 'historical',
  },
  {
    id: 'thermal_w_embalse_hot',
    name: 'Térmico W con calor (Embalse)',
    description: 'Viento W 14-18h, T>30°C. 33% frecuencia, 2.9 m/s. Calor extremo reduce fiabilidad. n=683',
    enabled: true,
    conditions: {
      minTemp: 30,
      maxHumidity: 55,
      timeWindow: { from: 14, to: 18 },
      months: [6, 7, 8, 9],
    },
    expectedWind: {
      zone: 'embalse',
      directionRange: { from: 225, to: 315 },
      minSpeed: 1.5,
    },
    source: 'historical',
  },
  {
    id: 'thermal_sw_embalse_evening',
    name: 'Térmico SW atardecer húmedo (Embalse)',
    description: 'Viento SW 18-22h, HR>75%. 46% frecuencia, 2.1 m/s. Variante húmeda del térmico. n=82',
    enabled: true,
    conditions: {
      minTemp: 20,
      maxTemp: 26,
      minHumidity: 75,
      timeWindow: { from: 18, to: 22 },
      months: [6, 7, 8, 9],
    },
    expectedWind: {
      zone: 'embalse',
      directionRange: { from: 180, to: 270 }, // SW ±45°
      minSpeed: 1.0,
    },
    source: 'historical',
  },

  // ═══ PRECURSORS: Signals that predict afternoon thermal ══

  {
    id: 'precursor_ne_embalse_morning',
    name: 'Precursor: NE matutino (Embalse)',
    description: 'NE 10-14h antes del térmico W. 38% freq, 2.9 m/s. Si hay NE por la mañana → W por la tarde. n=245',
    enabled: true,
    conditions: {
      minTemp: 20,
      maxTemp: 26,
      maxHumidity: 55,
      timeWindow: { from: 10, to: 14 },
      months: [6, 7, 8, 9],
    },
    expectedWind: {
      zone: 'embalse',
      directionRange: { from: 0, to: 90 }, // NE ±45°
      minSpeed: 1.0,
    },
    source: 'historical',
  },
  {
    id: 'precursor_e_norte_morning',
    name: 'Precursor: E matutino montaña (76%!)',
    description: 'Brisa E 6-10h en montaña. 76% frecuencia (!), 2.2 m/s. Señal más fiable de térmico vespertino. n=72',
    enabled: true,
    conditions: {
      minTemp: 20,
      maxTemp: 26,
      minHumidity: 55,
      maxHumidity: 75,
      timeWindow: { from: 6, to: 10 },
      months: [6, 7, 8, 9],
    },
    expectedWind: {
      zone: 'norte',
      directionRange: { from: 45, to: 135 }, // E ±45°
      minSpeed: 1.0,
    },
    source: 'historical',
  },
  {
    id: 'precursor_ne_ourense_morning',
    name: 'Precursor: NE matutino Ourense (57%)',
    description: 'NE 6-10h en Ourense. 57% frecuencia, 2.3 m/s. Confirma calentamiento regional. n=133',
    enabled: true,
    conditions: {
      minTemp: 20,
      maxTemp: 26,
      minHumidity: 55,
      maxHumidity: 75,
      timeWindow: { from: 6, to: 10 },
      months: [6, 7, 8, 9],
    },
    expectedWind: {
      zone: 'ourense',
      directionRange: { from: 0, to: 90 }, // NE ±45°
      minSpeed: 1.0,
    },
    source: 'historical',
  },

  // ═══ DRAINAGE: Night patterns that reset thermal contrast ═

  {
    id: 'drainage_n_embalse',
    name: 'Drenaje N nocturno (Embalse)',
    description: 'N 18-22h, HR<55%. 37% freq, 3.8 m/s. Enfría el valle → más contraste mañana. n=229',
    enabled: true,
    conditions: {
      minTemp: 20,
      maxTemp: 26,
      maxHumidity: 55,
      timeWindow: { from: 18, to: 22 },
      months: [6, 7, 8, 9],
    },
    expectedWind: {
      zone: 'embalse',
      directionRange: { from: 315, to: 45 }, // N ±45°
      minSpeed: 1.5,
    },
    source: 'historical',
  },
  {
    id: 'drainage_n_carballino',
    name: 'Drenaje N Carballiño (48%)',
    description: 'N 18-22h. 48% frecuencia, 3.3-3.6 m/s. Drenaje de valle muy consistente. n=225-507',
    enabled: true,
    conditions: {
      minTemp: 20,
      timeWindow: { from: 18, to: 22 },
      months: [6, 7, 8, 9],
    },
    expectedWind: {
      zone: 'carballino',
      directionRange: { from: 315, to: 45 }, // N ±45°
      minSpeed: 1.5,
    },
    source: 'historical',
  },
];
