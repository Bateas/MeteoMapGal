/**
 * Water zone definitions for MeteoMapGal.
 * Polygons from OpenStreetMap (where available) or manually traced.
 * Coordinates: [lon, lat] pairs forming a closed polygon.
 */

export interface WaterZone {
  id: string;
  name: string;
  shortName: string;
  type: 'ria' | 'embalse' | 'costa' | 'ensenada';
  sector: 'rias' | 'embalse';
  concellos: string[];
  center: [number, number];
  polygon: [number, number][];
  areaKm2: number;
  depthRange?: [number, number];
  features?: string[];
}

// ═══════════════════════════════════════════════════
// RIAS BAIXAS — OSM real polygons
// ═══════════════════════════════════════════════════

const RIA_VIGO: WaterZone = {
  id: 'ria-vigo',
  name: 'Ría de Vigo',
  shortName: 'Vigo',
  type: 'ria',
  sector: 'rias',
  concellos: ['Vigo', 'Cangas', 'Moaña', 'Redondela', 'Soutomaior', 'Nigrán', 'Baiona'],
  center: [-8.75, 42.24],
  // OSM relation 9983650 — simplified 37 pts
  polygon: [
    [-8.9142,42.2513],[-8.8327,42.2528],[-8.8071,42.2545],[-8.7873,42.2544],
    [-8.771,42.2618],[-8.7497,42.2684],[-8.7355,42.2785],[-8.7145,42.2841],
    [-8.6955,42.2796],[-8.6643,42.2911],[-8.6608,42.3098],[-8.6414,42.3361],
    [-8.627,42.3463],[-8.6125,42.3433],[-8.6195,42.3155],[-8.6155,42.2859],
    [-8.6267,42.2884],[-8.6716,42.2734],[-8.6828,42.2634],[-8.702,42.2601],
    [-8.7231,42.2427],[-8.7384,42.2285],[-8.7485,42.2296],[-8.7661,42.2231],
    [-8.797,42.1978],[-8.8138,42.1783],[-8.8492,42.1498],[-8.8308,42.113],
    [-8.8468,42.1249],[-8.8723,42.1153],[-8.9092,42.1786],[-8.8933,42.1912],
    [-8.8962,42.199],[-8.9142,42.2116],[-8.8958,42.2278],[-8.9083,42.247],
    [-8.9142,42.2513],
  ],
  areaKm2: 176,
  depthRange: [5, 45],
  features: ['Puerto comercial Vigo', 'Islas Cíes', 'Spots Cesantes/Vao/Lourido', 'Bocana terral'],
};

const RIA_PONTEVEDRA: WaterZone = {
  id: 'ria-pontevedra',
  name: 'Ría de Pontevedra',
  shortName: 'Pontevedra',
  type: 'ria',
  sector: 'rias',
  concellos: ['Pontevedra', 'Marín', 'Bueu', 'Sanxenxo', 'Poio', 'Cangas'],
  center: [-8.78, 42.37],
  // OSM relation 9982966 — simplified 37 pts
  polygon: [
    [-8.839,42.3389],[-8.9333,42.3448],[-8.9326,42.3459],[-8.9323,42.3471],
    [-8.9329,42.3483],[-8.934,42.3489],[-8.9362,42.3494],[-8.9381,42.3561],
    [-8.9364,42.3622],[-8.9333,42.3705],[-8.9314,42.3772],[-8.9286,42.3845],
    [-8.9216,42.3933],[-8.9205,42.4007],[-8.8554,42.3984],[-8.8312,42.3894],
    [-8.8224,42.3961],[-8.8043,42.3981],[-8.7921,42.3963],[-8.7773,42.3899],
    [-8.7582,42.3999],[-8.7352,42.4138],[-8.7065,42.4282],[-8.6934,42.4374],
    [-8.6783,42.4212],[-8.6556,42.4288],[-8.6785,42.4101],[-8.6935,42.3977],
    [-8.7035,42.3957],[-8.7131,42.3926],[-8.7371,42.3742],[-8.752,42.3452],
    [-8.7786,42.33],[-8.7984,42.3337],[-8.8176,42.3378],[-8.835,42.3414],
    [-8.839,42.3389],
  ],
  areaKm2: 145,
  depthRange: [5, 35],
  features: ['Puerto de Marín', 'Isla de Ons', 'Spots Castiñeiras/A Lanzada'],
};

const BAHIA_BAIONA: WaterZone = {
  id: 'bahia-baiona',
  name: 'Bahía de Baiona',
  shortName: 'Baiona',
  type: 'ensenada',
  sector: 'rias',
  concellos: ['Baiona', 'Nigrán'],
  center: [-8.85, 42.13],
  // OSM relation 9983644 — 27 pts
  polygon: [
    [-8.8558,42.1486],[-8.841,42.1472],[-8.825,42.1447],[-8.8182,42.1331],
    [-8.8234,42.1199],[-8.8359,42.1144],[-8.8421,42.1155],[-8.8461,42.1192],
    [-8.8479,42.1222],[-8.8445,42.1247],[-8.8527,42.1273],[-8.8521,42.1233],
    [-8.8638,42.1191],[-8.8723,42.1153],[-8.8756,42.1133],[-8.8843,42.1133],
    [-8.8968,42.1124],[-8.8769,42.1467],[-8.8681,42.146],[-8.8658,42.1457],
    [-8.8653,42.1453],[-8.8639,42.1453],[-8.8579,42.1458],[-8.8552,42.1445],
    [-8.8532,42.1456],[-8.8544,42.1474],[-8.8558,42.1486],
  ],
  areaKm2: 12,
  depthRange: [3, 20],
  features: ['Monte Real Club de Yates', 'Regatas tradicionales'],
};

const RIA_AROUSA: WaterZone = {
  id: 'ria-arousa',
  name: 'Ría de Arousa',
  shortName: 'Arousa',
  type: 'ria',
  sector: 'rias',
  concellos: ['Vilagarcía', 'Cambados', 'O Grove', 'Ribeira', 'A Illa de Arousa', 'Vilanova', 'Sanxenxo'],
  center: [-8.82, 42.52],
  // Manual trace — Arousa too large for single Overpass query
  polygon: [
    [-8.68, 42.60], [-8.65, 42.57], [-8.67, 42.53], [-8.70, 42.50],
    [-8.75, 42.48], [-8.80, 42.46], [-8.85, 42.44], [-8.88, 42.43],
    [-8.92, 42.44], [-8.95, 42.46], [-8.98, 42.49], [-9.00, 42.52],
    [-8.98, 42.55], [-8.94, 42.57], [-8.88, 42.58], [-8.83, 42.59],
    [-8.78, 42.60], [-8.73, 42.61], [-8.68, 42.60],
  ],
  areaKm2: 230,
  depthRange: [3, 40],
  features: ['Mayor ría gallega', 'Bateas mejillón', 'Spots Illa Arousa/A Lanzada'],
};

// ═══════════════════════════════════════════════════
// EMBALSE SECTOR — OSM real polygons
// ═══════════════════════════════════════════════════

const EMBALSE_CASTRELO: WaterZone = {
  id: 'embalse-castrelo',
  name: 'Embalse de Castrelo de Miño',
  shortName: 'Castrelo',
  type: 'embalse',
  sector: 'embalse',
  concellos: ['Castrelo de Miño', 'Ribadavia', 'Cenlle', 'Cortegada'],
  center: [-8.07, 42.31],
  // OSM relation 17067996 — 42 pts
  polygon: [
    [-8.09998,42.29448],[-8.11284,42.29112],[-8.11826,42.29342],[-8.11875,42.30013],
    [-8.11201,42.30466],[-8.09844,42.30362],[-8.09037,42.30608],[-8.08322,42.30543],
    [-8.08011,42.30777],[-8.07903,42.30685],[-8.0758,42.31043],[-8.07242,42.31764],
    [-8.07098,42.32391],[-8.0663,42.3298],[-8.0597,42.32912],[-8.04829,42.32645],
    [-8.04146,42.32899],[-8.03348,42.32698],[-8.03006,42.32552],[-8.02876,42.32537],
    [-8.02787,42.32508],[-8.02327,42.32544],[-8.01738,42.3269],[-8.01367,42.33016],
    [-8.01254,42.33198],[-8.01232,42.33321],[-8.00983,42.34023],[-7.9948,42.34424],
    [-7.9655,42.33823],[-7.9865,42.33975],[-7.98831,42.34019],[-8.0102,42.33066],
    [-8.02731,42.32076],[-8.04376,42.3259],[-8.04977,42.32259],[-8.04879,42.32104],
    [-8.05413,42.32309],[-8.06935,42.31021],[-8.07195,42.30536],[-8.0832,42.30135],
    [-8.09572,42.29754],[-8.09998,42.29448],
  ],
  areaKm2: 8,
  depthRange: [2, 25],
  features: ['Club Náutico', 'Térmicas de valle', 'SkyX anemómetro', 'Hidroaviones CL-215'],
};

// ═══════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════

export const WATER_ZONES: WaterZone[] = [
  RIA_VIGO,
  RIA_PONTEVEDRA,
  BAHIA_BAIONA,
  RIA_AROUSA,
  EMBALSE_CASTRELO,
];

export function getZonesBySector(sectorId: string): WaterZone[] {
  return WATER_ZONES.filter((z) => z.sector === sectorId);
}

export function getZoneById(id: string): WaterZone | undefined {
  return WATER_ZONES.find((z) => z.id === id);
}

export function getZonesByConcello(concello: string): WaterZone[] {
  return WATER_ZONES.filter((z) =>
    z.concellos.some((c) => c.toLowerCase() === concello.toLowerCase())
  );
}

export function zoneToBounds(zone: WaterZone): { ne: [number, number]; sw: [number, number] } {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lon, lat] of zone.polygon) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { ne: [maxLon, maxLat], sw: [minLon, minLat] };
}
