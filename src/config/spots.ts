/**
 * Sailing spot definitions — multi-sector.
 *
 * A "spot" is a micro-zone within a sector with its own scoring profile,
 * preferred stations/buoys, and wind pattern knowledge. The sector fetches
 * ALL stations; the spot narrows scoring to what matters locally.
 *
 * Rías Baixas — 4 spots in Ría de Vigo (expandable to other Rías):
 * - Cesantes: interior, thermal-dominant, flat water
 * - Bocana: Vigo–Rande narrows, terral wind from ría interior, sheltered water
 * - Centro Ría: mid-ría, virazón territory, moderate wave exposure
 * - Cíes-Ría: exterior, full ocean conditions, swell-critical
 *
 * Embalse — 1 spot (expandable):
 * - Castrelo: reservoir center, thermal WSW dominant
 */

import type { IconId } from '../components/icons/WeatherIcons';

/** Type-safe spot identifiers for exhaustive matching */
export type SpotId = 'cesantes' | 'bocana' | 'centro-ria' | 'cies-ria' | 'lourido' | 'castineiras' | 'vao' | 'lanzada' | 'illa-arousa' | 'castrelo'
  | 'surf-patos' | 'surf-lanzada' | 'surf-corrubedo';

export interface WindPattern {
  name: string;
  /** Typical direction (degrees from north) */
  direction: number;
  /** Season/timing description */
  season: string;
  /** Short description */
  description: string;
}

export interface SpotWebcam {
  /** Display label */
  label: string;
  /** URL to open or embed */
  url: string;
  /** 'image' = static JPG (auto-refresh), 'page' = external page/stream link */
  type: 'image' | 'page';
  /** Provider name */
  source: string;
  /** Compass direction the camera faces (degrees from north) */
  azimuth: number;
  /** Auto-refresh interval in seconds (only for type='image') */
  refreshInterval?: number;
}

export interface SailingSpot {
  id: SpotId;
  name: string;
  shortName: string;
  /** Icon from WeatherIcons registry */
  icon: IconId;
  center: [number, number]; // [lon, lat]
  radiusKm: number;
  description: string;
  /** Known wind patterns for this spot */
  windPatterns: WindPattern[];
  /** Station IDs to prioritize for scoring (prefixed: aemet_, mg_, mc_, wu_, nt_) */
  preferredStations: string[];
  /** Buoy IDs to prioritize (from RIAS_BUOY_STATIONS) */
  preferredBuoys: number[];
  /** Wave relevance for scoring */
  waveRelevance: 'none' | 'moderate' | 'critical';
  /** Whether thermal wind detection applies */
  thermalDetection: boolean;
  /** Whether morning bocana/terral detection applies (E/NE land breeze) */
  bocanaDetection?: boolean;
  /** Safety hard gates */
  hardGates: {
    /** Max wind (kt) before NOGO */
    maxWindKt?: number;
    /** Max significant wave height (m) before NOGO */
    maxWaveHeight?: number;
  };
  /** Wind speed calibration offset (kt). Added to consensus avg to compensate
   *  for amateur station low-mounting bias or exposed locations. Default 0. */
  windCalibrationKt?: number;
  /** Upwind indicator stations — if these show wind in a pattern direction
   *  while the spot is calm, it signals approaching wind (frontal propagation).
   *  NOT used for thermal/bruma patterns (those generate locally).
   *  Format: station IDs from the sector's station pool. */
  upwindStations?: string[];

  /** Webcams near this spot (Phase 1) */
  webcams?: SpotWebcam[];
  /** Nearest IHM tide station ID (from tideClient.ts) for tide summary in popup */
  tideStationId?: string;

  // ── Beta / Surf fields ──────────────────────────────────────
  /** Beta flag — spot is experimental, shown with BETA badge */
  beta?: boolean;
  /** Spot category — sailing (default) or surf */
  category?: 'sailing' | 'surf';
  /** Beach compass orientation in degrees (e.g., 315 = NW-facing) — surf spots */
  beachOrientation?: number;
  /** Offshore wind direction(s) in degrees — wind from these dirs cleans waves */
  offshoreWindDir?: number[];
  /** Best swell directions in degrees (e.g., [315, 270] = NW, W) */
  swellDirections?: number[];
  /** Tide preference for surf quality */
  tidePreference?: 'low' | 'mid' | 'high' | 'mid-high' | 'all';
  /** Coastal correction factor for wave height (0.0-1.0). Default 0.85.
   *  Lower = more sheltered (e.g. 0.80 for Patos behind Cíes).
   *  Higher = more exposed (e.g. 0.92 for A Lanzada full Atlantic). */
  coastalFactor?: number;
}

// ── Spot Definitions ──────────────────────────────────────────

export const RIAS_SPOTS: SailingSpot[] = [
  {
    id: 'cesantes',
    name: 'Cesantes (Interior)',
    shortName: 'Cesantes',
    icon: 'sailboat',
    center: [-8.619, 42.307],
    radiusKm: 12,
    description: 'Interior Ría de Vigo, ensenada de San Simón. Agua plana, viento SW tardes en primavera-verano.',
    windPatterns: [
      {
        name: 'Viento SW (tardes)',
        direction: 250,
        season: 'Marzo–Octubre, 12-18h',
        description: 'El sol calienta la tierra y entra brisa del SW por la ría. Mejor en días despejados sin norte. Viento estable 8-15kt, agua plana. La mejor sesión del spot.',
      },
      {
        name: 'Norte (componente)',
        direction: 0,
        season: 'Todo el año',
        description: 'Entra por Rande canalizado. Racheado e irregular, complica la navegación. Si hay norte fuerte, el viento SW de tardes no se forma.',
      },
    ],
    // Closest stations to Cesantes scoring zone
    preferredStations: [
      'mc_ESGAL3600000036209A', // Vigo-Coia (~5km, replaces offline Redondela+Vigo Centro)
    ],
    preferredBuoys: [
      1251, // Rande CETMAR (~3km) — key buoy for interior ría
      3221, // Vigo REDMAR (tide/pressure, ~5km)
    ],
    waveRelevance: 'none',
    thermalDetection: true,
    hardGates: { maxWindKt: 30 },
    // Upwind for frontal WSW: Bouzas (mouth of ría) shows wind before interior
    // NOT used for thermal/bruma (local generation, Bouzas stays calm)
    upwindStations: ['mc_ESGAL3600000036209A'], // Vigo Bouzas (12m, boca ría)
    tideStationId: '29', // Vigo
    webcams: [
      {
        label: 'Cesantes (tmkites)',
        url: 'https://www.tmkites.com/playas/cesantes/',
        type: 'page',
        source: 'tmkites',
        azimuth: 270, // Mirando al oeste (ría)
      },
    ],
  },
  {
    id: 'bocana',
    name: 'Bocana (Vigo–Rande)',
    shortName: 'Bocana',
    icon: 'sailboat',
    center: [-8.70, 42.265],
    radiusKm: 10,
    description: 'Estrecho de Rande, entre Vigo y San Simón. Viento de tierra por las mañanas, agua protegida.',
    windPatterns: [
      {
        name: 'Viento de tierra (mañanas)',
        direction: 75,
        season: 'Octubre–Mayo, 6-11h',
        description: 'Por la noche la tierra se enfría y el aire baja hacia la ría. Mejor tras noches despejadas y frías. Viento E/NE suave 5-10kt, se para cuando el sol calienta (~11h).',
      },
      {
        name: 'Norte (componente)',
        direction: 0,
        season: 'Todo el año',
        description: 'Norte canalizado por el estrecho de Rande. Racheado, irregular y frio. Puede ser fuerte con frentes.',
      },
    ],
    // Stations closest to the Rande–Vigo channel
    preferredStations: [
      'mg_14001',               // Porto de Vigo (7m, ON water, avg 10.8kt!) — dominant for in-ría wind
      'mc_ESGAL3600000036209A', // Vigo-Coia (~4km, replaces offline Redondela+Bouzas)
    ],
    preferredBuoys: [
      1251, // Rande CETMAR — directly at Rande narrows
      3221, // Vigo REDMAR (sea level, ~2km)
    ],
    waveRelevance: 'none', // Protected from ocean swell by the ría
    thermalDetection: false,
    bocanaDetection: true, // Morning terral E/NE 6-11AM, validated 14d buoy data
    hardGates: { maxWindKt: 30 },
    tideStationId: '29', // Vigo
    webcams: [
      {
        label: 'Vigo Móvil (Ría)',
        url: 'https://www.g24.gal/-/vigo-mobil-',
        type: 'page',
        source: 'G24',
        azimuth: 315, // Mirando NW (bocana → Cangas)
      },
    ],
  },
  {
    id: 'centro-ria',
    name: 'Ría de Vigo (centro)',
    shortName: 'Ría Vigo',
    icon: 'sailboat',
    center: [-8.802807, 42.227813],
    radiusKm: 10,
    description: 'Zona media de la Ría de Vigo, entre Cangas y Bouzas. Brisa SW tardes, viento de tierra mañanas.',
    windPatterns: [
      {
        name: 'Brisa SW (tardes)',
        direction: 225,
        season: 'Abril–Septiembre, 12-18h',
        description: 'Brisa marina que entra del SW cuando el sol calienta. Días despejados de primavera y verano. Viento estable 8-15kt. Se potencia hacia el interior (Cesantes).',
      },
      {
        name: 'Viento de tierra (mañanas)',
        direction: 75,
        season: 'Octubre–Mayo, mañanas',
        description: 'El aire frío de tierra baja hacia la ría por las mañanas. Más débil que en el estrecho de Rande al ser zona abierta.',
      },
      {
        name: 'Noroeste (frentes)',
        direction: 330,
        season: 'Otono–Invierno',
        description: 'Viento NW con frentes atlánticos. Puede durar varios días. Mar de fondo y marejadilla dentro de la ría.',
      },
    ],
    preferredStations: [
      'mg_14001',               // Porto de Vigo (7m, ON water, avg 10.8kt!) — best in-ría wind
      'mc_ESGAL3600000036940A', // Cangas do Morrazo (~8km N) — costera
      'mc_ESGAL3600000036209A', // Vigo Bouzas (~5km S) — costera
    ],
    preferredBuoys: [
      1251, // Rande CETMAR (~8km NE) — humidity/temp for theta-v
      3221, // Vigo REDMAR (sea level, ~3km S) — wind on water
      4273, // Cabo Udra REMPOR (~10km S, wind)
    ],
    waveRelevance: 'moderate',
    thermalDetection: true, // Virazon detection via theta-v gradient (Rande buoy + land stations)
    hardGates: { maxWindKt: 30, maxWaveHeight: 2.0 },
    tideStationId: '29', // Vigo
    webcams: [
      {
        label: 'Cangas (MeteoGalicia)',
        url: 'https://www.meteogalicia.gal/datosred/camaras/MeteoGalicia/Cangas/ultima.jpg',
        type: 'image',
        source: 'MeteoGalicia',
        azimuth: 120,
        refreshInterval: 300,
      },
      {
        label: 'Vigo Movil (Ria)',
        url: 'https://www.g24.gal/-/vigo-mobil-',
        type: 'page',
        source: 'G24',
        azimuth: 315,
      },
    ],
  },
  {
    id: 'cies-ria',
    name: 'Cíes-Ría (Baiona–Cíes)',
    shortName: 'Cíes-Ría',
    icon: 'sailboat',
    center: [-8.8648, 42.1849],
    radiusKm: 12,
    description: 'Entrada de la Ría de Vigo, entre Baiona y las Islas Cíes. Condiciones oceánicas, olas y viento atlántico.',
    windPatterns: [
      {
        name: 'Nortada (verano)',
        direction: 330,
        season: 'Junio–Septiembre, tardes',
        description: 'El viento típico del verano gallego. NW constante 12-20kt por las tardes. Mar de fondo 1-2m. Ideal para vela, kite y windsurf con experiencia.',
      },
      {
        name: 'Suroeste (borrascas)',
        direction: 225,
        season: 'Octubre–Marzo',
        description: 'Viento SW fuerte con borrascas atlánticas. Mar de 2-4m, rachas fuertes. Zona expuesta, solo para expertos con mar grande.',
      },
    ],
    preferredStations: [
      'mc_ESGAL3600000036350C', // Baiona (~8km)
    ],
    preferredBuoys: [
      2248, // Cabo Silleiro REDEXT (referencia oceánica, 55km W)
      1253, // A Guarda CETMAR (sur)
      1252, // Islas Cíes CETMAR (bocana directa)
    ],
    waveRelevance: 'critical',
    thermalDetection: false,
    hardGates: { maxWindKt: 30, maxWaveHeight: 3.0 },
    tideStationId: '30', // Baiona
    webcams: [
      {
        label: 'Cíes – Rodas (MeteoGalicia)',
        url: 'https://www.meteogalicia.gal/datosred/camaras/MeteoGalicia/Ciesrodas/ultima.jpg',
        type: 'image',
        source: 'MeteoGalicia',
        azimuth: 180,
        refreshInterval: 300,
      },
      {
        label: 'Cíes – Faro Sur',
        url: 'https://www.meteogalicia.gal/datosred/camaras/MeteoGalicia/CiesFaroSur/ultima.jpg',
        type: 'image',
        source: 'MeteoGalicia',
        azimuth: 180,
        refreshInterval: 300,
      },
      {
        label: 'Cíes – Faro Norte (Ría)',
        url: 'https://www.meteogalicia.gal/datosred/camaras/MeteoGalicia/CiesFaroNorte/ultima.jpg',
        type: 'image',
        source: 'MeteoGalicia',
        azimuth: 0,
        refreshInterval: 300,
      },
    ],
  },
  {
    id: 'lourido',
    name: 'Lourido (Ría de Pontevedra)',
    shortName: 'Lourido',
    icon: 'sailboat',
    center: [-8.679265, 42.420740],
    radiusKm: 10,
    description: 'Playa de Lourido, Ría de Pontevedra. Kite y windsurf. Brisa SW por las tardes en primavera-verano.',
    windPatterns: [
      {
        name: 'Brisa SW (tardes)',
        direction: 225,
        season: 'Abril–Octubre, 13-19h',
        description: 'Brisa marina que entra del SW por la ría. Días de sol y calor. Viento estable 10-18kt, ideal para kite y windsurf. La boya de Marín confirma el viento real.',
      },
      {
        name: 'Noroeste (frentes)',
        direction: 330,
        season: 'Otono–Invierno',
        description: 'Viento NW con frentes atlánticos. Marejadilla dentro de la ría, agua revuelta. Puede ser fuerte pero incómodo por las olas cortas.',
      },
    ],
    preferredStations: [
      // MC Pontevedra (36300A) and Sanxenxo (36380A) confirmed offline Apr 2026
    ],
    preferredBuoys: [
      4271, // Lourizán REMPOR (~3km SE, has wind!)
      4273, // Cabo Udra REMPOR (~8km W, has wind)
      3223, // Marín REDMAR (tide gauge, ~3km S)
    ],
    waveRelevance: 'moderate',
    thermalDetection: true, // Same ría thermal/bruma dynamics as Cesantes
    windCalibrationKt: 1, // Closer stations now (3km vs 20km), less compensation needed
    hardGates: { maxWindKt: 30, maxWaveHeight: 2.5 },
    tideStationId: '28', // Marín
    webcams: [
      {
        label: 'Aguete - Marin (MeteoGalicia)',
        url: 'https://www.meteogalicia.gal/datosred/camaras/MeteoGalicia/Aguete2/ultima.jpg',
        type: 'image',
        source: 'MeteoGalicia',
        azimuth: 225,
        refreshInterval: 300,
      },
      {
        label: 'Lourido (KiteGalicia)',
        url: 'https://kitegalicia.com/playas/centro-kg-lourido/',
        type: 'page',
        source: 'KiteGalicia',
        azimuth: 225,
      },
    ],
  },
  {
    id: 'castineiras',
    name: 'Castiñeiras (Ría de Arousa)',
    shortName: 'Castiñeiras',
    icon: 'sailboat',
    center: [-9.001197, 42.528255],
    radiusKm: 10,
    description: 'Playa de Castiñeiras, costa norte de la Ría de Arousa. Exposición W/NW, olas y viento atlántico.',
    windPatterns: [
      {
        name: 'Nortada (verano)',
        direction: 330,
        season: 'Junio–Septiembre, tardes',
        description: 'Viento NW del verano gallego. 10-18kt constante por las tardes. Mar de fondo 1-2m. Bueno para surf, kite y windsurf.',
      },
      {
        name: 'Suroeste (borrascas)',
        direction: 225,
        season: 'Otoño–Invierno',
        description: 'Viento SW fuerte con frentes atlánticos. Olas grandes, zona expuesta.',
      },
    ],
    preferredStations: [
      // MC O Grove (36340A) confirmed offline Apr 2026
    ],
    preferredBuoys: [
      1250, // Cortegada (Arousa) — interior ría reference
    ],
    waveRelevance: 'critical',
    thermalDetection: false,
    hardGates: { maxWindKt: 30, maxWaveHeight: 3.0 },
    tideStationId: '27', // Sanxenxo (closest)
    webcams: [
      {
        label: 'Salvora (MeteoGalicia)',
        url: 'https://www.meteogalicia.gal/datosred/camaras/MeteoGalicia/Salvora/ultima.jpg',
        type: 'image',
        source: 'MeteoGalicia',
        azimuth: 180,
        refreshInterval: 300,
      },
      {
        label: 'Coron - Vilanova (MeteoGalicia)',
        url: 'https://www.meteogalicia.gal/datosred/camaras/MeteoGalicia/Coron/ultima.jpg',
        type: 'image',
        source: 'MeteoGalicia',
        azimuth: 270,
        refreshInterval: 300,
      },
    ],
  },
  {
    id: 'vao',
    name: 'Praia do Vao (Vigo)',
    shortName: 'Vao',
    icon: 'sailboat',
    center: [-8.792616, 42.198600],
    radiusKm: 8,
    description: 'Playa do Vao, sur de Vigo. Urbana y accesible. Exposición SW, protegida parcialmente por las Cíes.',
    windPatterns: [
      {
        name: 'Brisa SW (tardes)',
        direction: 225,
        season: 'Abril–Octubre, 13-19h',
        description: 'Brisa marina SW que entra por la boca de la ría. Parcialmente protegida por las Islas Cíes. Viento 8-14kt.',
      },
      {
        name: 'Noroeste (frentes)',
        direction: 330,
        season: 'Otoño–Invierno',
        description: 'Viento NW con frentes. Olas de 1-2m por la exposición parcial al océano.',
      },
    ],
    preferredStations: [
      'mc_ESGAL3600000036209A', // Vigo Centro (~5km N)
      'mc_ESGAL3600000036350C', // Baiona (~10km S)
    ],
    preferredBuoys: [
      3221, // Vigo REDMAR (~5km N)
      2248, // Cabo Silleiro (~20km SW, oceánica)
    ],
    waveRelevance: 'moderate',
    thermalDetection: false,
    hardGates: { maxWindKt: 30, maxWaveHeight: 2.5 },
    tideStationId: '29', // Vigo
    webcams: [
      {
        label: 'Vao – Toralla (HispaCams)',
        url: 'https://www.hispacams.com/webcams/coruxo-playa-de-o-vao-toralla/',
        type: 'page',
        source: 'HispaCams',
        azimuth: 225, // Mirando SW (playa + Toralla)
      },
    ],
  },
  {
    id: 'lanzada',
    name: 'Praia da Lanzada',
    shortName: 'A Lanzada',
    icon: 'sailboat',
    center: [-8.879528, 42.449269],
    radiusKm: 10,
    description: 'Gran playa oceánica entre O Grove y Sanxenxo. Exposición total al Atlántico. Surf, kite y windsurf con olas.',
    windPatterns: [
      {
        name: 'Nortada (verano)',
        direction: 340,
        season: 'Junio–Septiembre, tardes',
        description: 'Viento N/NW del verano gallego. 12-20kt constante. Mar de fondo 1-3m. La playa referencia para kite y surf en Galicia.',
      },
      {
        name: 'Suroeste (borrascas)',
        direction: 225,
        season: 'Otoño–Invierno',
        description: 'Frentes atlánticos con olas grandes (2-4m) y viento fuerte. Solo para expertos.',
      },
    ],
    preferredStations: [
      // MC Sanxenxo (36380A) and O Grove (36340A) confirmed offline Apr 2026
    ],
    preferredBuoys: [
      4273, // Cabo Udra REMPOR (~15km S, wind+waves)
      2248, // Cabo Silleiro (~40km SW, oceánica)
    ],
    waveRelevance: 'critical',
    thermalDetection: false,
    hardGates: { maxWindKt: 30, maxWaveHeight: 4.0 },
    tideStationId: '27', // Sanxenxo
  },
  {
    id: 'illa-arousa',
    name: 'Praia do Bao (Illa de Arousa)',
    shortName: 'Illa Arousa',
    icon: 'sailboat',
    center: [-8.860286, 42.545818],
    radiusKm: 8,
    description: 'Playa do Bao en la Illa de Arousa, interior de la Ría de Arousa. Agua plana, brisa térmica por las tardes.',
    windPatterns: [
      {
        name: 'Brisa SW (tardes)',
        direction: 225,
        season: 'Abril–Octubre, 13-19h',
        description: 'Brisa marina que entra por la ría. Agua plana protegida por la isla. Ideal para principiantes y windsurf.',
      },
      {
        name: 'Norte (componente)',
        direction: 0,
        season: 'Todo el año',
        description: 'Norte canalizado por la ría. Racheado pero con agua plana.',
      },
    ],
    preferredStations: [
      // MC O Grove (36340A) confirmed offline Apr 2026
    ],
    preferredBuoys: [
      1250, // Cortegada (Arousa) — interior ría, ~5km N
    ],
    waveRelevance: 'none', // Protected by island
    thermalDetection: true, // Interior ría, similar dynamics
    hardGates: { maxWindKt: 30 },
    tideStationId: '27', // Sanxenxo
  },

  // ── Surf Spots (BETA) ─────────────────────────────────────────
  // Swell-oriented spots. Scoring uses wind data for now;
  // surf-specific scoring (swell + tide + direction) is planned.

  {
    id: 'surf-patos',
    name: 'Patos (Surf)',
    shortName: 'Patos',
    icon: 'waves',
    center: [-8.8243, 42.1548],
    radiusKm: 8,
    description: 'Playa NW en Nigrán. Beach break + reef derecha. Mejor con swell NW >1m, marea media-alta, viento S/SSW (offshore).',
    beta: true,
    category: 'surf',
    beachOrientation: 315, // NW-facing
    offshoreWindDir: [180, 200], // S, SSW
    swellDirections: [315, 270], // NW, W
    tidePreference: 'mid-high',
    coastalFactor: 0.45, // Heavily sheltered by Cíes Islands — NW swell barely enters
    windPatterns: [
      {
        name: 'Offshore S/SSW (mañanas)',
        direction: 195,
        season: 'Todo el año, 7-12h',
        description: 'Viento terral de S/SSW limpia las olas. Mañanas suelen ser glass. La mejor condición para surf en Patos.',
      },
      {
        name: 'Onshore NW (tardes)',
        direction: 315,
        season: 'Verano, tardes',
        description: 'Brisa de NW entra por la tarde y destroza las olas. Evitar para surf.',
      },
    ],
    preferredStations: [
      'mc_ESGAL3600000036209A', // Vigo Centro (~10km)
    ],
    preferredBuoys: [
      1252, // Cíes (~15km W) — swell reference
      1253, // A Guarda (~20km S) — swell confirmation
    ],
    waveRelevance: 'critical',
    thermalDetection: false,
    hardGates: { maxWindKt: 25, maxWaveHeight: 4.0 },
    tideStationId: '1', // Vigo
    webcams: [
      { label: 'Waira Surf Patos', url: 'https://waira.com/webcam/', type: 'page', source: 'Waira Surf School', azimuth: 300 },
    ],
  },
  {
    id: 'surf-lanzada',
    name: 'A Lanzada (Surf)',
    shortName: 'Lanzada Surf',
    icon: 'waves',
    center: [-8.876, 42.448],
    radiusKm: 10,
    description: '2.4km de playa W abierta al Atlántico. Muy consistente. Beach break todos los niveles. Mejor con swell SW/W, viento NE/E (offshore).',
    beta: true,
    category: 'surf',
    beachOrientation: 270, // W-facing
    offshoreWindDir: [45, 90], // NE, E
    swellDirections: [225, 270, 290], // SW, W, WNW
    tidePreference: 'all',
    coastalFactor: 0.75, // Exposed but NW swell arrives at angle to W-facing beach
    windPatterns: [
      {
        name: 'Offshore NE/E (mañanas)',
        direction: 55,
        season: 'Todo el año, 7-12h',
        description: 'Viento de tierra limpia las olas. Mañanas son la mejor ventana. La playa más consistente de Galicia.',
      },
      {
        name: 'Brisa onshore W (tardes)',
        direction: 270,
        season: 'Verano, 14-19h',
        description: 'Brisa térmica de W/SW entra por la tarde. Olas se desordenan. La sesión es por la mañana.',
      },
    ],
    preferredStations: [
      // MC Sanxenxo (36380A) and O Grove (36340A) confirmed offline Apr 2026
    ],
    preferredBuoys: [
      4273, // Cabo Udra REMPOR (~15km S) — swell directo enfrente
      2248, // Cabo Silleiro (~40km SW) — referencia oceánica
    ],
    waveRelevance: 'critical',
    thermalDetection: false,
    hardGates: { maxWindKt: 30, maxWaveHeight: 5.0 },
    tideStationId: '27', // Sanxenxo
    webcams: [
      { label: 'Salvora (MG)', url: 'https://www.meteogalicia.gal/datosred/camaras/MeteoGalicia/Salvora/ultima.jpg', type: 'image', source: 'MeteoGalicia', azimuth: 180, refreshInterval: 300 },
    ],
  },
  {
    id: 'surf-corrubedo',
    name: 'Corrubedo (Surf)',
    shortName: 'Corrubedo',
    icon: 'waves',
    center: [-9.033, 42.556],
    radiusKm: 10,
    description: 'Playa NW en parque natural de dunas. Olas potentes, corrientes fuertes. Solo intermedio-avanzado. Mejor con swell NW, viento SE (offshore).',
    beta: true,
    category: 'surf',
    beachOrientation: 315, // NW-facing
    offshoreWindDir: [135, 180], // SE, S
    swellDirections: [315, 290], // NW, WNW
    tidePreference: 'all',
    coastalFactor: 0.88, // Exposed but dune park with some refraction
    windPatterns: [
      {
        name: 'Offshore SE (mañanas)',
        direction: 135,
        season: 'Todo el año, mañanas',
        description: 'Viento de SE limpia la ola. Corrubedo es potente — no apto para principiantes.',
      },
      {
        name: 'NW dominante',
        direction: 315,
        season: 'Otoño–Invierno',
        description: 'Viento fuerte de NW con mar de fondo grande (2-4m). Onshore pero olas de calidad si el período es largo.',
      },
    ],
    preferredStations: [],
    preferredBuoys: [
      2248, // Cabo Silleiro (~60km SW) — deep-water swell reference
    ],
    waveRelevance: 'critical',
    thermalDetection: false,
    hardGates: { maxWindKt: 25, maxWaveHeight: 5.0 },
    tideStationId: '7', // Vilagarcía
    webcams: [
      { label: 'Corrubedo (MG)', url: 'https://www.meteogalicia.gal/datosred/camaras/MeteoGalicia/Corrubedo/ultima.jpg', type: 'image', source: 'MeteoGalicia', azimuth: 270, refreshInterval: 300 },
    ],
  },
];

export const EMBALSE_SPOTS: SailingSpot[] = [
  {
    id: 'castrelo',
    name: 'Castrelo de Miño (Embalse)',
    shortName: 'Castrelo',
    icon: 'sailboat',
    center: [-8.1087, 42.2991],
    radiusKm: 15,
    description: 'Embalse de Castrelo de Miño, valle del Miño. Agua dulce y plana. Viento SW por las tardes con sol.',
    windPatterns: [
      {
        name: 'Viento SW (tardes)',
        direction: 250,
        season: 'Marzo–Octubre, 14-19h',
        description: 'El sol calienta el valle y entra viento del SW. Mejor con temperaturas altas, cielo despejado y sin norte. Viento constante 8-15kt, agua plana. Los mejores días del embalse.',
      },
      {
        name: 'Norte (componente)',
        direction: 0,
        season: 'Todo el año',
        description: 'Viento de norte racheado e irregular. Si hay norte fuerte, el viento SW de tardes no se forma. Frio en invierno.',
      },
    ],
    preferredStations: [
      'skyx_SKY100',  // SkyX at reservoir edge (~0km) — best source, NO direction
      'aemet_1484C',  // Ribadavia (~5km) — has direction, closest AEMET
      // aemet_1496 (Ourense 15km) REMOVED — different valley, penalizes scoring
    ],
    preferredBuoys: [], // No buoys in freshwater reservoir
    waveRelevance: 'none',
    thermalDetection: true,
    hardGates: { maxWindKt: 30 },
    webcams: [
      { label: 'Castrelo (ESP32-CAM)', url: 'https://meteomapgal.navia3d.com/webcam/castrelo.jpg', type: 'image', source: 'Propia', azimuth: 225, refreshInterval: 60 },
    ],
  },
];

/** All spots from both sectors */
export const ALL_SPOTS: SailingSpot[] = [...RIAS_SPOTS, ...EMBALSE_SPOTS];

/** Get spots for a specific sector */
export function getSpotsForSector(sectorId: string): SailingSpot[] {
  if (sectorId === 'rias') return RIAS_SPOTS;
  if (sectorId === 'embalse') return EMBALSE_SPOTS;
  return [];
}

/** Default spot per sector */
export function getDefaultSpotId(sectorId: string): SpotId {
  if (sectorId === 'embalse') return 'castrelo';
  return 'cesantes'; // Rías default
}

export const DEFAULT_SPOT_ID = 'cesantes';
