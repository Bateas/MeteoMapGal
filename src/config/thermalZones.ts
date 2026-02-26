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
 * Thermal wind rules derived from Open-Meteo Archive analysis.
 * Based on ~47,000 hourly data points per location (Jun-Sep 2022-2025).
 *
 * Key findings:
 * - Embalse & Ourense: strong WSW pattern afternoons (14-17h, 17-20h), 33-47% freq
 * - Embalse: NNE nocturnal drainage (20-23h), 27-31% freq = catabático confirmed
 * - Norte (montaña): E morning wind (6-10h, 10-14h), 36-52% freq = slope breeze
 * - Norte: NW evening pattern (17-20h) with heat = thermal reversal
 * - Carballiño: N/NNW nocturnal (20-23h), 28-43% freq = valley drainage
 */
export const DEFAULT_THERMAL_RULES: ThermalWindRule[] = [
  // ── Embalse: WSW afternoon thermal ──────────────────────
  {
    id: 'hist_embalse_wsw_afternoon',
    name: 'Térmico WSW vespertino (Embalse)',
    description: 'Viento WSW 14-17h, T=20-25°C, HR baja. 38% frecuencia histórica, 3.6 m/s medio (n=115)',
    enabled: true,
    conditions: {
      minTemp: 20,
      maxTemp: 25,
      maxHumidity: 60,
      timeWindow: { from: 14, to: 17 },
      months: [6, 7, 8, 9],
    },
    expectedWind: {
      zone: 'embalse',
      directionRange: { from: 202, to: 292 }, // WSW ±45°
      minSpeed: 1.8,
    },
    source: 'historical',
  },
  {
    id: 'hist_embalse_wsw_evening',
    name: 'Térmico WSW atardecer (Embalse)',
    description: 'Viento WSW 17-20h, T=20-25°C, HR alta. 39% frecuencia, 2.4 m/s (n=70)',
    enabled: true,
    conditions: {
      minTemp: 20,
      maxTemp: 25,
      minHumidity: 70,
      timeWindow: { from: 17, to: 20 },
      months: [6, 7, 8, 9],
    },
    expectedWind: {
      zone: 'embalse',
      directionRange: { from: 202, to: 292 },
      minSpeed: 1.2,
    },
    source: 'historical',
  },
  // ── Embalse: NNE nocturnal drainage (catabático) ────────
  {
    id: 'hist_embalse_nne_night',
    name: 'Catabático NNE nocturno (Embalse)',
    description: 'Drenaje NNE 20-23h, T=25-28°C, HR baja. 31% frecuencia, 2.8 m/s (n=98)',
    enabled: true,
    conditions: {
      minTemp: 25,
      maxTemp: 28,
      maxHumidity: 60,
      timeWindow: { from: 20, to: 23 },
      months: [6, 7, 8, 9],
    },
    expectedWind: {
      zone: 'embalse',
      directionRange: { from: 337, to: 67 }, // NNE ±45°
      minSpeed: 1.4,
    },
    source: 'historical',
  },
  {
    id: 'hist_embalse_nne_hot_evening',
    name: 'NNE con calor extremo (Embalse)',
    description: 'Viento NNE 17-20h, T>28°C, HR<50%. 27% frecuencia, 3.5 m/s (n=157)',
    enabled: true,
    conditions: {
      minTemp: 28,
      maxHumidity: 50,
      timeWindow: { from: 17, to: 20 },
      months: [6, 7, 8, 9],
    },
    expectedWind: {
      zone: 'embalse',
      directionRange: { from: 337, to: 67 },
      minSpeed: 1.7,
    },
    source: 'historical',
  },
  // ── Ourense: WSW afternoon ──────────────────────────────
  {
    id: 'hist_ourense_wsw_afternoon',
    name: 'Térmico WSW vespertino (Ourense)',
    description: 'Viento WSW 14-17h, T=20-25°C. 40-47% frecuencia, 3.2-3.8 m/s (n=30-115)',
    enabled: true,
    conditions: {
      minTemp: 20,
      maxTemp: 28,
      timeWindow: { from: 14, to: 17 },
      months: [6, 7, 8, 9],
    },
    expectedWind: {
      zone: 'ourense',
      directionRange: { from: 202, to: 292 },
      minSpeed: 1.6,
    },
    source: 'historical',
  },
  {
    id: 'hist_ourense_ne_morning',
    name: 'NE matutino (Ourense)',
    description: 'Viento NE 10-14h, T=25-28°C, HR=60-70%. 32% frecuencia, 1.6 m/s (n=56)',
    enabled: true,
    conditions: {
      minTemp: 25,
      maxTemp: 28,
      minHumidity: 60,
      maxHumidity: 70,
      timeWindow: { from: 10, to: 14 },
      months: [6, 7, 8, 9],
    },
    expectedWind: {
      zone: 'ourense',
      directionRange: { from: 0, to: 90 }, // NE ±45°
      minSpeed: 0.8,
    },
    source: 'historical',
  },
  // ── Norte (montaña): E morning slope breeze ─────────────
  {
    id: 'hist_norte_e_morning',
    name: 'Brisa E matutina (Montaña)',
    description: 'Viento E 6-10h, T=20-25°C. 41-52% frecuencia, 1.8-1.9 m/s (n=42-54). Brisa de ladera',
    enabled: true,
    conditions: {
      minTemp: 20,
      maxTemp: 25,
      timeWindow: { from: 6, to: 10 },
      months: [6, 7, 8, 9],
    },
    expectedWind: {
      zone: 'norte',
      directionRange: { from: 45, to: 135 }, // E ±45°
      minSpeed: 0.9,
    },
    source: 'historical',
  },
  {
    id: 'hist_norte_nw_hot_evening',
    name: 'NW atardecer con calor (Montaña)',
    description: 'Viento NW 17-20h, T>25°C. 31-34% frecuencia, 2.4-3.1 m/s. Reversión térmica',
    enabled: true,
    conditions: {
      minTemp: 25,
      timeWindow: { from: 17, to: 20 },
      months: [6, 7, 8, 9],
    },
    expectedWind: {
      zone: 'norte',
      directionRange: { from: 270, to: 360 }, // NW ±45°
      minSpeed: 1.2,
    },
    source: 'historical',
  },
  // ── Carballiño: N/NNW nocturnal valley drainage ─────────
  {
    id: 'hist_carballino_n_night',
    name: 'Drenaje N nocturno (Carballiño)',
    description: 'Viento N/NNW 20-23h, T=20-25°C. 29-32% frecuencia, 2.9-3.6 m/s (n=97-212)',
    enabled: true,
    conditions: {
      minTemp: 20,
      maxTemp: 28,
      timeWindow: { from: 20, to: 23 },
      months: [6, 7, 8, 9],
    },
    expectedWind: {
      zone: 'carballino',
      directionRange: { from: 315, to: 45 }, // N ±45°
      minSpeed: 1.4,
    },
    source: 'historical',
  },
  {
    id: 'hist_carballino_nne_evening',
    name: 'NNE atardecer seco (Carballiño)',
    description: 'Viento NNE 17-20h, T=20-25°C, HR<50%. 26% frecuencia, 4.1 m/s (n=133)',
    enabled: true,
    conditions: {
      minTemp: 20,
      maxTemp: 25,
      maxHumidity: 50,
      timeWindow: { from: 17, to: 20 },
      months: [6, 7, 8, 9],
    },
    expectedWind: {
      zone: 'carballino',
      directionRange: { from: 337, to: 67 }, // NNE ±45°
      minSpeed: 2.0,
    },
    source: 'historical',
  },
];
