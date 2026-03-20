/**
 * Export service — builds GeoJSON from current station/buoy data.
 *
 * Produces a standard GeoJSON FeatureCollection ready for QGIS, Google Earth,
 * or any GIS tool. Includes wind, temperature, humidity, and metadata.
 *
 * Usage: importable from sidebar/toolbar for "Export" button.
 */

import type { NormalizedStation, NormalizedReading } from '../types/station';
import type { BuoyReading } from '../api/buoyClient';
import { BUOY_COORDS_MAP } from '../api/buoyClient';
import { msToKnots, degreesToCardinal } from './windUtils';
import { SOURCE_CONFIG } from '../config/sourceConfig';

interface GeoJSONFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number, number?] };
  properties: Record<string, string | number | null>;
}

interface GeoJSONCollection {
  type: 'FeatureCollection';
  metadata: {
    name: string;
    generated: string;
    source: string;
    stationCount: number;
    buoyCount: number;
  };
  features: GeoJSONFeature[];
}

/**
 * Build GeoJSON FeatureCollection from current stations + buoys.
 */
export function buildGeoJSON(
  stations: NormalizedStation[],
  readings: Map<string, NormalizedReading>,
  buoys: BuoyReading[] = [],
  sectorName: string = 'MeteoMapGal',
): GeoJSONCollection {
  const features: GeoJSONFeature[] = [];

  // ── Stations ────────────────────────────────────
  for (const station of stations) {
    const reading = readings.get(station.id);
    const sourceName = SOURCE_CONFIG[station.source]?.fullName ?? station.source;

    const windKt = reading?.windSpeed != null ? Math.round(msToKnots(reading.windSpeed) * 10) / 10 : null;
    const gustKt = reading?.windGust != null ? Math.round(msToKnots(reading.windGust) * 10) / 10 : null;
    const cardinal = reading?.windDirection != null ? degreesToCardinal(reading.windDirection) : null;

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [station.lon, station.lat, station.altitude ?? undefined],
      },
      properties: {
        id: station.id,
        name: station.name,
        source: sourceName,
        type: 'station',
        altitude_m: station.altitude ?? null,
        wind_kt: windKt,
        wind_gust_kt: gustKt,
        wind_dir_deg: reading?.windDirection ?? null,
        wind_dir_cardinal: cardinal,
        temperature_c: reading?.temperature != null ? Math.round(reading.temperature * 10) / 10 : null,
        humidity_pct: reading?.humidity != null ? Math.round(reading.humidity) : null,
        pressure_hpa: reading?.pressure ?? null,
        dew_point_c: reading?.dewPoint != null ? Math.round(reading.dewPoint * 10) / 10 : null,
        timestamp: reading?.timestamp ? reading.timestamp.toISOString() : null,
      },
    });
  }

  // ── Buoys ───────────────────────────────────────
  for (const buoy of buoys) {
    const coords = BUOY_COORDS_MAP.get(buoy.stationId);
    if (!coords) continue;

    const windKt = buoy.windSpeed != null ? Math.round(msToKnots(buoy.windSpeed) * 10) / 10 : null;

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [coords.lon, coords.lat],
      },
      properties: {
        id: `buoy_${buoy.stationId}`,
        name: buoy.stationName,
        source: 'Puertos del Estado',
        type: 'buoy',
        altitude_m: 0,
        wind_kt: windKt,
        wind_gust_kt: null,
        wind_dir_deg: buoy.windDir ?? null,
        wind_dir_cardinal: buoy.windDir != null ? degreesToCardinal(buoy.windDir) : null,
        wave_height_m: buoy.waveHeight ?? null,
        wave_period_s: buoy.wavePeriod ?? null,
        wave_dir_deg: buoy.waveDir ?? null,
        water_temp_c: buoy.waterTemp ?? null,
        current_speed_ms: buoy.currentSpeed ?? null,
        current_dir_deg: buoy.currentDir ?? null,
        temperature_c: buoy.airTemp ?? null,
        humidity_pct: buoy.humidity ?? null,
        pressure_hpa: buoy.pressure ?? null,
        dew_point_c: buoy.dewPoint ?? null,
        timestamp: buoy.timestamp,
      },
    });
  }

  return {
    type: 'FeatureCollection',
    metadata: {
      name: sectorName,
      generated: new Date().toISOString(),
      source: 'MeteoMapGal (meteomapgal.navia3d.com)',
      stationCount: stations.length,
      buoyCount: buoys.length,
    },
    features,
  };
}

/**
 * Download GeoJSON as a file.
 */
export function downloadGeoJSON(
  stations: NormalizedStation[],
  readings: Map<string, NormalizedReading>,
  buoys: BuoyReading[] = [],
  sectorName: string = 'MeteoMapGal',
): void {
  const geojson = buildGeoJSON(stations, readings, buoys, sectorName);
  const json = JSON.stringify(geojson, null, 2);
  const blob = new Blob([json], { type: 'application/geo+json' });
  const url = URL.createObjectURL(blob);

  const date = new Date().toISOString().slice(0, 10);
  const safeName = sectorName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

  const a = document.createElement('a');
  a.href = url;
  a.download = `meteomapgal_${safeName}_${date}.geojson`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
