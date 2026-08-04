/** Raw Meteoclimatic XML station data (parsed from XML feed) */
export interface MeteoclimaticRawStation {
  id: string;           // e.g. "ESGAL3200000032003A"
  location: string;     // e.g. "Ourense - Centro"
  pubDate: string;      // ISO-ish date string
  qos: number;          // 0-3 quality score
  temperature: number | null;  // °C
  humidity: number | null;     // %
  pressure: number | null;     // hPa
  windSpeed: number | null;    // km/h (needs conversion to m/s)
  windAzimuth: number | null;  // degrees
  windGust: number | null;     // km/h
  rain: number | null;         // mm
}

/** Known Meteoclimatic station coordinates (not included in XML feed) */
export interface MeteoclimaticStationMeta {
  id: string;
  lat: number;
  lon: number;
  altitude: number;
  /**
   * Present only when the position came from the public profile page, which
   * publishes degrees and minutes and nothing finer: roughly +-1.5 km. Absent
   * means the entry was curated by hand and can be trusted at spot scale.
   */
  precision?: 'coarse';
}

/**
 * Hardcoded coordinates for Meteoclimatic stations (Ourense + Pontevedra nearby).
 * The XML feed doesn't include lat/lon, so we maintain a lookup table.
 * Stations from ESGAL32 (Ourense) and ESGAL36 (Pontevedra) feeds.
 */
export const METEOCLIMATIC_STATIONS: MeteoclimaticStationMeta[] = [
  // --- Ourense (ESGAL32) ---
  { id: 'ESGAL3200000032003A', lat: 42.333, lon: -7.850, altitude: 135 },   // Ourense - Centro
  { id: 'ESGAL3200000032005A', lat: 42.317, lon: -7.867, altitude: 136 },   // Ourense - CIFP A Farixa
  { id: 'ESGAL3200000032236A', lat: 42.133, lon: -8.183, altitude: 218 },   // A Notaria (Padrenda)
  { id: 'ESGAL3200000032548A', lat: 41.950, lon: -7.000, altitude: 977 },   // Cádavos - A Mezquita
  { id: 'ESGAL3200000032500A', lat: 42.417, lon: -8.067, altitude: 420 },   // O Carballiño - Señorín
  { id: 'ESGAL3200000032455A', lat: 42.383, lon: -8.083, altitude: 400 },   // San Amaro - Anllo
  // --- Pontevedra (ESGAL36) — nearby stations for frontal/gradient detection ---
  { id: 'ESGAL3600000036516A', lat: 42.515, lon: -8.155, altitude: 580 },   // O Sisto - Dozón
  { id: 'ESGAL3600000036516B', lat: 42.518, lon: -8.150, altitude: 575 },   // Barrio O Sisto
  { id: 'ESGAL3600000036110B', lat: 42.385, lon: -8.525, altitude: 380 },   // Campo Lameiro (A Lagoa)
  { id: 'ESGAL3600000036519A', lat: 42.660, lon: -8.130, altitude: 550 },   // Cristimil - Lalín
  { id: 'ESGAL3600000036538A', lat: 42.659, lon: -7.946, altitude: 640 },   // Rodeiro-Vilarmaior
  // --- Pontevedra (ESGAL36) — Rías Baixas coastal stations ---
  { id: 'ESGAL3600000036380A', lat: 42.399, lon: -8.698, altitude: 35 },    // Sanxenxo
  { id: 'ESGAL3600000036041A', lat: 42.233, lon: -8.720, altitude: 12 },    // Vigo - Bouzas
  { id: 'ESGAL3600000036057A', lat: 42.233, lon: -8.683, altitude: 30 },    // Vigo - Centro
  { id: 'ESGAL3600000036212A', lat: 42.200, lon: -8.750, altitude: 77 },    // Vigo - Navia
  { id: 'ESGAL3600000036316A', lat: 42.300, lon: -8.700, altitude: 320 },   // Vigo - Teis
  { id: 'ESGAL3600000036300A', lat: 42.428, lon: -8.644, altitude: 20 },    // Pontevedra
  { id: 'ESGAL3600000036940A', lat: 42.250, lon: -8.783, altitude: 70 },    // Cangas do Morrazo (fixed: was 36440A/404)
  { id: 'ESGAL3600000036350A', lat: 42.100, lon: -8.767, altitude: 15 },    // Nigrán
  { id: 'ESGAL3600000036750A', lat: 41.933, lon: -8.767, altitude: 38 },    // Goián - Tomiño (Miño estuary)
  { id: 'ESGAL3600000036340A', lat: 42.442, lon: -8.808, altitude: 8 },     // O Grove - A Toxa
  { id: 'ESGAL3600000036260A', lat: 42.325, lon: -8.601, altitude: 50 },    // Redondela
  { id: 'ESGAL3600000036510A', lat: 42.196, lon: -8.748, altitude: 5 },     // Baiona
  { id: 'ESGAL3600000036209A', lat: 42.210, lon: -8.730, altitude: 15 },    // Vigo - Coia (coastal, useful for Cesantes/Bocana)
  { id: 'ESGAL3600000036350C', lat: 42.140, lon: -8.810, altitude: 39 },    // Nigrán - Panasco (near surf Patos)
  // --- A Coruña (ESGAL15) — Barbanza coast, Corrubedo area ---
  { id: 'ESGAL1500000015290A', lat: 42.802, lon: -9.026, altitude: 50 },    // Abelleira - Muros (coastal, near Corrubedo)
  { id: 'ESGAL1500000015211A', lat: 42.790, lon: -8.840, altitude: 100 },   // Roo - Noia (Ría Muros-Noia)

  // ── Añadidas 2026-08-04, precision GRUESA ────────────────────────────
  // El feed XML no lleva coordenadas y la ficha publica solo da grados y
  // minutos, asi que estas salen de ahi: ±1,5 km. Ninguna otra via las afina
  // — el campo `homepage` del feed esta vacio en las 15, comprobado.
  //
  // Por eso llevan `precision: 'coarse'`, y la regla que va con la marca:
  // valen para cobertura y para el barrido de calibracion, NUNCA como
  // `preferredStations` de un spot ni en trabajo sensible al relieve. Un
  // error de 1,5 km en un valle cruza un monte — es exactamente lo que hace
  // inutil a Remuino para el viento del embalse.
  //
  // Se afinan cuando haga falta y solo entonces: a 40 km del spot mas cercano
  // el error no cambia ninguna decision. El metodo, cuando toque, es cruzar
  // la caja de 1 minuto con la altitud publicada — en terreno abrupto quedan
  // pocos puntos a esa cota, que es justo donde la precision importa.
  // --- Ourense (ESGAL32) ---
  { id: 'ESGAL3200000032870A', lat: 41.8833, lon: -8.0833, altitude: 487, precision: 'coarse' },   // Cimadevila - Lobios
  // --- Pontevedra (ESGAL36) ---
  { id: 'ESGAL3600000036419A', lat: 42.1500, lon: -8.6667, altitude: 412, precision: 'coarse' },   // Mos - O.C. British School
  { id: 'ESGAL3600000036202A', lat: 42.2167, lon: -8.7167, altitude: 47, precision: 'coarse' },   // Vigo (O Castro)  [DUPLICA SITIO: a 1,0 km de wu_IVIGO51]
  // --- A Coruna (ESGAL15) — norte, futuro sector ---
  { id: 'ESGAL1500000015624A', lat: 43.4333, lon: -8.2667, altitude: 45, precision: 'coarse' },   // Ares-Pedragosa
  { id: 'ESGAL1500000015142B', lat: 43.2833, lon: -8.5000, altitude: 65, precision: 'coarse' },   // Arteixo
  { id: 'ESGAL1500000015004A', lat: 43.3667, lon: -8.4000, altitude: 17, precision: 'coarse' },   // La Coruña  [DUPLICA SITIO: a 1,7 km de aemet_1387]
  { id: 'ESGAL1500000015121A', lat: 43.2500, lon: -8.5833, altitude: 215, precision: 'coarse' },   // Laracha
  { id: 'ESGAL1500000015680A', lat: 43.0333, lon: -8.4167, altitude: 307, precision: 'coarse' },   // Montaos  [sin anemometro]
  { id: 'ESGAL1500000015702A', lat: 42.8667, lon: -8.5333, altitude: 270, precision: 'coarse' },   // Santiago - Centro
  { id: 'ESGAL1500000015630A', lat: 43.3667, lon: -8.1833, altitude: 105, precision: 'coarse' },   // Vilanova-Miño 
  { id: 'ESGAL1500000015684A', lat: 43.1000, lon: -8.6000, altitude: 415, precision: 'coarse' },   // Vilar (Tordoia)
  // --- Lugo (ESGAL27) — norte, futuro sector ---
  { id: 'ESGAL2700000027821A', lat: 43.1000, lon: -7.4500, altitude: 443, precision: 'coarse' },   // Aeródromo de Rozas  [DUPLICA SITIO: a 1,4 km de aemet_1505]
  { id: 'ESGAL2700000027678A', lat: 42.8333, lon: -7.1167, altitude: 610, precision: 'coarse' },   // Becerreá - Agüeira
  { id: 'ESGAL2700000027002B', lat: 43.0000, lon: -7.5500, altitude: 481, precision: 'coarse' },   // Lugo - Ramón Ferreiro  [DUPLICA SITIO: a 0,3 km de aemet_1518A — MENOS que su propio error de posicion]
  { id: 'ESGAL2700000027002A', lat: 43.0167, lon: -7.5000, altitude: 475, precision: 'coarse' },   // Lugo - San Roque  [sin anemometro]
];

/** Meteoclimatic feed regions to fetch */
// All four Galician provinces. Lugo (ESGAL27) was missing here long after the
// ingestor had been fixed, so the frontend's own fetch could never see it.
export const METEOCLIMATIC_REGIONS = ['ESGAL32', 'ESGAL36', 'ESGAL15', 'ESGAL27'] as const;
