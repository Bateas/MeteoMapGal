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
      'evega', 'castrelo', 'cenlle', 'arnoia',
      'cortegada', 'melón', 'melon',
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
      'barbadás', 'barbadas', 'pereiro',
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
      'avión', 'avion', 'covelo',
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
      'cartelle', 'celanova', 'quintela', 'bande',
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
 * Based on TWO data sources:
 *   1. Open-Meteo Archive: 854 days/point, 7 locations, Jun-Sep 2019-2025
 *      Valley thermals: Aug 48-50%, Jul 40-43%, Jun 20-24%, Sep 18-22%
 *      W dominant at embalse (74%), SW (12%), NW (13%)
 *      Average gust ~10 m/s (19 kt) at valley, ~8.8 m/s at altitude
 *
 *   2. AEMET station data: 1,412 daily records, Ribadavia/Ourense/Carballiño
 *      ΔT > 20°C → 42% thermal probability
 *      HR media > 85% → 0% thermals
 *      Peak gust timing: avg 14.9h for SW wind days
 *
 * Key user observations:
 *   - Thermal goes from calm (0) to 7-12 kt rapidly in the afternoon
 *   - W direction alone can mislead (synoptic W exists without thermal)
 *   - Thermal possible at 19-20h in Jun/Jul (sunset ~22:00 Galicia)
 *   - Humidity sensors unreliable (spike 100% with fog, drop fast with sun)
 *
 * The thermal cycle at Castrelo:
 *   Morning (6-10h): NE breeze + E slope wind = building phase
 *   Midday (10-14h): NE continues, contrast builds
 *   Afternoon (13-20h): W thermal arrives = SAILING WINDOW
 *   Late (18-21h): SW humid variant possible in long-daylight months
 *   Night: N drainage from Carballiño (48%), cools valley
 */
export const DEFAULT_THERMAL_RULES: ThermalWindRule[] = [
  // ═══ PRIMARY: Navigable thermal at embalse ═══════════════

  {
    id: 'thermal_sw_embalse',
    name: 'Térmico W navegable (Embalse)',
    description: 'Viento W 13-20h. W dominante (74% embalse). Racha media 10 m/s. De calma a 7-12 kt rápido. n=292/854',
    enabled: true,
    conditions: {
      minTemp: 20,
      maxTemp: 30,
      // No minHumidity — sensors unreliable for lower bound
      maxHumidity: 80,
      timeWindow: { from: 13, to: 20 },
      months: [6, 7, 8, 9],
    },
    expectedWind: {
      zone: 'embalse',
      directionRange: { from: 200, to: 310 }, // SW-WNW (covers W dominant + SW/NW secondary)
      minSpeed: 2.0, // ~4 kt minimum for navigable detection
    },
    source: 'historical',
  },
  {
    id: 'thermal_sw_embalse_hot',
    name: 'Térmico W con calor (Embalse)',
    description: 'W 13-20h, T>28°C. Días calurosos con ΔT alto. HR baja por calor. n=683',
    enabled: true,
    conditions: {
      minTemp: 28,
      maxHumidity: 65,
      timeWindow: { from: 13, to: 20 },
      months: [6, 7, 8, 9],
    },
    expectedWind: {
      zone: 'embalse',
      directionRange: { from: 200, to: 310 },
      minSpeed: 2.0,
    },
    source: 'historical',
  },
  {
    id: 'thermal_sw_embalse_evening',
    name: 'Térmico SW atardecer (Embalse)',
    description: 'SW 18-21h. Variante tardía en meses con luz larga (Jun/Jul sunset 22h). Más suave. n=82',
    enabled: true,
    conditions: {
      minTemp: 20,
      maxTemp: 30,
      maxHumidity: 85,
      timeWindow: { from: 18, to: 21 },
      months: [6, 7, 8, 9],
    },
    expectedWind: {
      zone: 'embalse',
      directionRange: { from: 180, to: 280 }, // S-W (evening can shift more S)
      minSpeed: 1.5,
    },
    source: 'historical',
  },

  // ═══ PRECURSORS: Signals that predict afternoon thermal ══

  {
    id: 'precursor_ne_embalse_morning',
    name: 'Precursor: NE matutino (Embalse)',
    description: 'NE 10-14h antes del térmico W. 38% freq. NE mañana → W tarde. n=245',
    enabled: true,
    conditions: {
      minTemp: 18,
      maxTemp: 28,
      maxHumidity: 75,
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
    description: 'Brisa E 6-10h en montaña. 76% frecuencia. Señal más fiable de térmico vespertino. n=72',
    enabled: true,
    conditions: {
      minTemp: 14,
      maxTemp: 26,
      maxHumidity: 85,
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
    description: 'NE 6-10h en Ourense. 57% frecuencia. Confirma calentamiento regional. n=133',
    enabled: true,
    conditions: {
      minTemp: 14,
      maxTemp: 26,
      maxHumidity: 85,
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
    description: 'N 18-22h, HR<55%. 37% freq, 3.8 m/s. Enfría el valle → contraste mañana. n=229',
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
    description: 'N 18-22h. 48% frecuencia. Drenaje de valle muy consistente. n=225-507',
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
