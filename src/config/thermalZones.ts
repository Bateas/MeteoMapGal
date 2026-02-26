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
 * Placeholder thermal wind rules.
 * These will be replaced/augmented by historical analysis results.
 */
export const DEFAULT_THERMAL_RULES: ThermalWindRule[] = [
  {
    id: 'thermal_vespertino_mino',
    name: 'Térmico vespertino Miño',
    description: 'Brisa térmica vespertina en el valle del Miño con calor y humedad alta',
    enabled: true,
    conditions: {
      minTemp: 28,
      minHumidity: 55,
      timeWindow: { from: 16, to: 20 },
      months: [6, 7, 8, 9],
    },
    expectedWind: {
      zone: 'embalse',
      directionRange: { from: 225, to: 315 }, // SW to NW (west-ish)
      minSpeed: 1.5, // m/s
    },
    source: 'manual',
  },
  {
    id: 'katabatic_nocturno',
    name: 'Catabático nocturno',
    description: 'Drenaje de aire frío de montaña al valle por la noche',
    enabled: true,
    conditions: {
      maxTemp: 20,
      timeWindow: { from: 22, to: 6 },
      months: [5, 6, 7, 8, 9, 10],
    },
    expectedWind: {
      zone: 'embalse',
      directionRange: { from: 0, to: 90 }, // N to E (downhill from norte)
      minSpeed: 0.5,
    },
    source: 'manual',
  },
  {
    id: 'efecto_embalse_matutino',
    name: 'Efecto embalse matutino',
    description: 'Brisa suave generada por la diferencia térmica agua-tierra al amanecer',
    enabled: true,
    conditions: {
      maxTemp: 20,
      minHumidity: 75,
      timeWindow: { from: 6, to: 10 },
      months: [5, 6, 7, 8, 9],
    },
    expectedWind: {
      zone: 'embalse',
      directionRange: { from: 135, to: 270 }, // SE to W (variable, lake breeze)
      minSpeed: 0.3,
    },
    source: 'manual',
  },
];
