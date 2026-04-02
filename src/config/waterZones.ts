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
  concellos: ['Castrelo de Miño', 'Ribadavia', 'Cenlle'],
  center: [-8.10, 42.29],
  polygon: [
    [-8.13, 42.31], // Norte (Francelos)
    [-8.10, 42.31], // NE
    [-8.08, 42.30], // Presa norte
    [-8.07, 42.29], // Presa
    [-8.08, 42.27], // Sur presa
    [-8.11, 42.26], // Ribadavia
    [-8.14, 42.27], // SW
    [-8.15, 42.29], // Castrelo pueblo
    [-8.13, 42.31], // close
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
  concellos: ['Crecente', 'Arbo', 'As Neves'],
  center: [-8.18, 42.15],
  polygon: [
    [-8.21, 42.17],
    [-8.18, 42.17],
    [-8.15, 42.16],
    [-8.14, 42.14],
    [-8.16, 42.13],
    [-8.19, 42.13],
    [-8.22, 42.15],
    [-8.21, 42.17],
  ],
  areaKm2: 5,
  depthRange: [3, 20],
  features: ['Aguas tranquilas', 'Piragüismo'],
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
