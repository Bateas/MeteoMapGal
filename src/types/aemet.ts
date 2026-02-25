/** AEMET OpenData two-step response wrapper */
export interface AemetApiResponse {
  descripcion: string;
  estado: number;
  datos: string;      // URL to fetch actual data
  metadatos: string;  // URL to metadata
}

/** Raw observation from AEMET /api/observacion/convencional/todas */
export interface AemetRawObservation {
  idema: string;       // Station ID (e.g. "1428")
  lon: number;         // Longitude (decimal degrees)
  lat: number;         // Latitude (decimal degrees)
  alt: number;         // Altitude (meters)
  ubi: string;         // Station name/location
  fint: string;        // ISO 8601 timestamp
  prec: number;        // Precipitation (mm)
  pacutp: number;      // Accumulated precipitation
  plession: number;    // Station pressure
  tamin: number;       // Min temperature
  ta: number;          // Current temperature (C)
  tamax: number;       // Max temperature
  tpr: number;         // Dew point
  stddv: number;      // Wind direction std deviation
  stddvx: number;     // Max wind direction std deviation
  dv: number;          // Wind direction (degrees)
  dmax: number;        // Max wind direction
  vv: number;          // Wind speed (m/s)
  vmax: number;        // Max wind speed
  hr: number;          // Relative humidity (%)
  vis: number;         // Visibility
  geo700: number;      // Geopotential 700
  geo850: number;      // Geopotential 850
  geo925: number;      // Geopotential 925
  np: number;          // Cloud layers
  hrnp: number;        // Humidity at cloud layer
  // ... more fields possible
}

/** Raw station from AEMET inventory */
export interface AemetRawStation {
  indicativo: string;  // Station code (e.g. "1428")
  indsinop: string;    // SYNOP code
  nombre: string;      // Station name
  provincia: string;   // Province
  altitud: number;     // Altitude (meters)
  // Coordinates in "DDMMSSN" format (degrees, minutes, seconds, cardinal)
  latitud: string;     // e.g. "421730N"
  longitud: string;    // e.g. "080745W"
}
