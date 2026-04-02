/**
 * Water zone definitions for MeteoMapGal.
 *
 * Each zone represents a body of water (ría, embalse, costa, ensenada)
 * that may span multiple concellos. These are NOT municipal boundaries —
 * they are functional water zones for monitoring, events, and alerts.
 *
 * Coordinates: [lon, lat] pairs forming a closed polygon.
 * Zones grouped by sector (rias / embalse) for filtering.
 */

export interface WaterZone {
  id: string;
  name: string;
  shortName: string;
  type: 'ria' | 'embalse' | 'costa' | 'ensenada' | 'puerto';
  sector: 'rias' | 'embalse';
  /** Concellos that border this water zone */
  concellos: string[];
  /** Center point for data queries [lon, lat] */
  center: [number, number];
  /** Polygon coordinates [lon, lat][] — closed (first = last) */
  polygon: [number, number][];
  /** Approximate area in km² */
  areaKm2: number;
  /** Typical depth range in meters */
  depthRange?: [number, number];
  /** Key characteristics */
  features?: string[];
}

// ═══════════════════════════════════════════════════
// RIAS BAIXAS SECTOR
// ═══════════════════════════════════════════════════

const RIA_VIGO_INTERIOR: WaterZone = {
  id: 'ria-vigo-interior',
  name: 'Ría de Vigo (interior)',
  shortName: 'Vigo Int.',
  type: 'ria',
  sector: 'rias',
  concellos: ['Vigo', 'Cangas', 'Moaña', 'Redondela', 'Soutomaior'],
  center: [-8.68, 42.28],
  polygon: [
    [-8.62, 42.33], // Rande (norte)
    [-8.60, 42.30], // Redondela
    [-8.62, 42.27], // Chapela
    [-8.68, 42.23], // Puerto de Vigo
    [-8.72, 42.22], // Bouzas
    [-8.77, 42.24], // Cangas
    [-8.78, 42.27], // Donón
    [-8.75, 42.30], // Moaña
    [-8.72, 42.32], // Meira
    [-8.67, 42.33], // Cesantes
    [-8.62, 42.33], // close
  ],
  areaKm2: 45,
  depthRange: [5, 30],
  features: ['Puerto comercial', 'Bocana terral matutina', 'Spots Cesantes/Vao'],
};

const RIA_VIGO_EXTERIOR: WaterZone = {
  id: 'ria-vigo-exterior',
  name: 'Ría de Vigo (exterior) — Cíes',
  shortName: 'Cíes-Vigo',
  type: 'ria',
  sector: 'rias',
  concellos: ['Vigo', 'Cangas', 'Baiona', 'Nigrán'],
  center: [-8.85, 42.20],
  polygon: [
    [-8.77, 42.24], // Cangas
    [-8.78, 42.27], // Donón
    [-8.84, 42.23], // Cabo Home
    [-8.91, 42.23], // Cíes Norte
    [-8.91, 42.18], // Cíes Sur
    [-8.87, 42.15], // Estelas
    [-8.84, 42.12], // Monteferro
    [-8.80, 42.12], // Baiona
    [-8.75, 42.14], // Nigrán
    [-8.72, 42.18], // Samil
    [-8.72, 42.22], // Bouzas
    [-8.77, 42.24], // close
  ],
  areaKm2: 65,
  depthRange: [10, 50],
  features: ['Islas Cíes', 'Oleaje atlántico', 'Spots Lourido/A Lanzada Sur'],
};

const ENSENADA_BAIONA: WaterZone = {
  id: 'ensenada-baiona',
  name: 'Ensenada de Baiona',
  shortName: 'Baiona',
  type: 'ensenada',
  sector: 'rias',
  concellos: ['Baiona', 'Nigrán'],
  center: [-8.84, 42.12],
  polygon: [
    [-8.87, 42.15], // Estelas
    [-8.84, 42.12], // Monteferro
    [-8.80, 42.10], // Baiona puerto
    [-8.82, 42.08], // A Ramallosa
    [-8.86, 42.10], // Cabo Silleiro
    [-8.87, 42.15], // close
  ],
  areaKm2: 12,
  depthRange: [3, 20],
  features: ['Monte Real Club de Yates', 'Regatas tradicionales'],
};

const RIA_PONTEVEDRA: WaterZone = {
  id: 'ria-pontevedra',
  name: 'Ría de Pontevedra',
  shortName: 'Pontevedra',
  type: 'ria',
  sector: 'rias',
  concellos: ['Pontevedra', 'Marín', 'Bueu', 'Sanxenxo', 'Poio', 'Combarro'],
  center: [-8.72, 42.38],
  polygon: [
    [-8.63, 42.43], // Pontevedra
    [-8.62, 42.40], // Combarro
    [-8.66, 42.38], // Poio
    [-8.72, 42.36], // Marín
    [-8.78, 42.35], // Bueu
    [-8.83, 42.36], // Cabo Udra
    [-8.87, 42.38], // Ons
    [-8.82, 42.40], // Sanxenxo
    [-8.77, 42.42], // Portonovo
    [-8.72, 42.43], // Raxó
    [-8.63, 42.43], // close
  ],
  areaKm2: 80,
  depthRange: [5, 35],
  features: ['Puerto de Marín', 'Spot Castiñeiras', 'Isla de Ons'],
};

const RIA_AROUSA: WaterZone = {
  id: 'ria-arousa',
  name: 'Ría de Arousa',
  shortName: 'Arousa',
  type: 'ria',
  sector: 'rias',
  concellos: ['Vilagarcía', 'Cambados', 'O Grove', 'Ribeira', 'A Illa de Arousa', 'Vilanova'],
  center: [-8.80, 42.55],
  polygon: [
    [-8.68, 42.60], // Vilagarcía
    [-8.65, 42.57], // Carril
    [-8.68, 42.53], // Vilanova
    [-8.72, 42.50], // Cambados
    [-8.78, 42.48], // O Grove
    [-8.88, 42.50], // A Lanzada
    [-8.93, 42.52], // Sálvora
    [-8.95, 42.55], // Corrubedo
    [-8.90, 42.57], // Ribeira
    [-8.82, 42.58], // Illa Arousa
    [-8.75, 42.60], // Vilaxoán
    [-8.68, 42.60], // close
  ],
  areaKm2: 180,
  depthRange: [3, 40],
  features: ['Mayor ría gallega', 'Bateas mejillón', 'Spot Illa Arousa/A Lanzada'],
};

const COSTA_MORTE_SUR: WaterZone = {
  id: 'costa-morte-sur',
  name: 'Costa da Morte Sur (Corrubedo — Muros)',
  shortName: 'C. Morte Sur',
  type: 'costa',
  sector: 'rias',
  concellos: ['Ribeira', 'Porto do Son', 'Noia', 'Muros'],
  center: [-8.98, 42.65],
  polygon: [
    [-8.93, 42.56], // Corrubedo
    [-9.02, 42.60], // Porto do Son
    [-9.05, 42.65], // Noia
    [-9.08, 42.70], // Muros
    [-9.10, 42.72], // Louro
    [-9.05, 42.72], // offshore
    [-8.95, 42.58], // offshore
    [-8.93, 42.56], // close
  ],
  areaKm2: 120,
  depthRange: [10, 100],
  features: ['Oleaje fuerte', 'Viento atlántico', 'Corrubedo dunas'],
};

// ═══════════════════════════════════════════════════
// EMBALSE SECTOR
// ═══════════════════════════════════════════════════

const EMBALSE_CASTRELO: WaterZone = {
  id: 'embalse-castrelo',
  name: 'Embalse de Castrelo de Miño',
  shortName: 'Castrelo',
  type: 'embalse',
  sector: 'embalse',
  concellos: ['Castrelo de Miño', 'Ribadavia', 'Cenlle', 'Cortegada'],
  center: [-8.07, 42.31],
  // Real outline from OpenStreetMap (relation 17067996) — 42 points
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

const EMBALSE_FRIEIRA: WaterZone = {
  id: 'embalse-frieira',
  name: 'Embalse de Frieira',
  shortName: 'Frieira',
  type: 'embalse',
  sector: 'embalse',
  concellos: ['Crecente', 'Arbo', 'As Neves', 'Salvaterra de Miño'],
  center: [-8.17, 42.22],
  // Real outline from OpenStreetMap (relation 18103720) — 27 points
  polygon: [
    [-8.1537,42.25235],[-8.17165,42.23033],[-8.16805,42.21906],[-8.1915,42.211],
    [-8.17707,42.19828],[-8.17164,42.18258],[-8.15825,42.18195],[-8.17425,42.16925],
    [-8.19185,42.15467],[-8.17575,42.16575],[-8.162,42.179],[-8.17196,42.1813],
    [-8.17991,42.19125],[-8.18825,42.20675],[-8.18742,42.21785],[-8.18327,42.21979],
    [-8.17084,42.22139],[-8.16514,42.2432],[-8.16175,42.26425],[-8.14425,42.2805],
    [-8.133,42.28125],[-8.14877,42.27658],[-8.15888,42.25832],[-8.15669,42.25749],
    [-8.15329,42.25561],[-8.15224,42.25372],[-8.1537,42.25235],
  ],
  areaKm2: 12,
  depthRange: [3, 30],
  features: ['Aguas tranquilas', 'Piragüismo', 'Río Miño'],
};

// ═══════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════

export const WATER_ZONES: WaterZone[] = [
  // Rías Baixas
  RIA_VIGO_INTERIOR,
  RIA_VIGO_EXTERIOR,
  ENSENADA_BAIONA,
  RIA_PONTEVEDRA,
  RIA_AROUSA,
  COSTA_MORTE_SUR,
  // Embalses
  EMBALSE_CASTRELO,
  EMBALSE_FRIEIRA,
];

/** Get zones by sector */
export function getZonesBySector(sectorId: string): WaterZone[] {
  return WATER_ZONES.filter((z) => z.sector === sectorId);
}

/** Get zone by ID */
export function getZoneById(id: string): WaterZone | undefined {
  return WATER_ZONES.find((z) => z.id === id);
}

/** Get zones that contain a concello */
export function getZonesByConcello(concello: string): WaterZone[] {
  return WATER_ZONES.filter((z) =>
    z.concellos.some((c) => c.toLowerCase() === concello.toLowerCase())
  );
}

/** Convert polygon to bounds (for compatibility with regattaStore ZoneBounds) */
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
