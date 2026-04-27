/**
 * AemetVisibilityHalo — small DEM-aware fog halos around AEMET stations
 * that report visibility < 2km.
 *
 * Reactive philosophy:
 * - Auto-renders only when ≥1 of the 8 official AEMET visibility stations
 *   reports vis < 2km (data-confirmed fog, not modeled).
 * - Each halo is anchored to that station's actual altitude. Cells more
 *   than 50m above the station are skipped — niebla is a cold-air-pool
 *   phenomenon, never on hilltops (user requirement S124).
 * - Coastal stations (≤50m altitude) extend the halo over water; interior
 *   stations don't (no advective component to fall back on).
 *
 * Distinct from FogOverlay (which is detector-based: webcams + solar
 * signature). This one is the OFFICIAL AEMET METAR signal — they
 * complement, never overlap visually because each uses its own color.
 */

import { memo, useEffect, useState, useCallback, useRef } from 'react';
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import type { GeoJSON } from 'geojson';
import { useWeatherStore } from '../../store/weatherStore';
import {
  haloRadiusKm,
  densityForCell,
  haloBbox,
  HALO_VIS_THRESHOLD_KM,
} from '../../services/visibilityHaloService';

const SOURCE_ID = 'aemet-visibility-halo';
const FADE_IN_MS = 2_000;
const FADE_OUT_MS = 5_000;
const GRID_RESOLUTION = 18; // cells per side (324 cells / station max)

type ElevQuery = (lngLat: { lng: number; lat: number }) => number | null;

function buildHaloGeoJSON(
  queryElev: ElevQuery,
  stations: { id: string; name: string; lat: number; lon: number; vis: number }[],
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const s of stations) {
    const radius = haloRadiusKm(s.vis);
    if (radius <= 0) continue;
    const stationElev = queryElev({ lng: s.lon, lat: s.lat });
    if (stationElev === null || stationElev === undefined) continue;

    const bbox = haloBbox(s.lat, s.lon, radius);
    const cellW = (bbox.east - bbox.west) / GRID_RESOLUTION;
    const cellH = (bbox.north - bbox.south) / GRID_RESOLUTION;

    for (let row = 0; row < GRID_RESOLUTION; row++) {
      for (let col = 0; col < GRID_RESOLUTION; col++) {
        const lng = bbox.west + (col + 0.5) * cellW;
        const lat = bbox.south + (row + 0.5) * cellH;

        // Equirectangular distance (good enough at <10km)
        const dLat = (lat - s.lat) * 111;
        const dLon = (lng - s.lon) * 111 * Math.cos((s.lat * Math.PI) / 180);
        const dKm = Math.hypot(dLat, dLon);
        if (dKm > radius) continue;

        const cellElev = queryElev({ lng, lat });
        const density = densityForCell(dKm, radius, cellElev, stationElev, s.vis);
        if (density === 0) continue;

        const x1 = bbox.west + col * cellW;
        const x2 = x1 + cellW;
        const y1 = bbox.south + row * cellH;
        const y2 = y1 + cellH;

        features.push({
          type: 'Feature',
          properties: {
            density,
            stationId: s.id,
            stationName: s.name,
            visibilityKm: s.vis,
          },
          geometry: {
            type: 'Polygon',
            coordinates: [[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]],
          },
        });
      }
    }
  }
  return { type: 'FeatureCollection', features };
}

function AemetVisibilityHaloInner() {
  const { current: mapRef } = useMap();
  const visibilityReadings = useWeatherStore((s) => s.visibilityReadings);

  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [opacity, setOpacity] = useState(0);
  const lastRef = useRef<GeoJSON.FeatureCollection | null>(null);

  // Filter visibilityReadings → list of stations with vis<threshold
  const fogStations = (() => {
    const out: { id: string; name: string; lat: number; lon: number; vis: number }[] = [];
    for (const v of visibilityReadings.values()) {
      if (v.visibility < HALO_VIS_THRESHOLD_KM) {
        out.push({ id: v.stationId, name: v.name, lat: v.lat, lon: v.lon, vis: v.visibility });
      }
    }
    return out;
  })();

  const buildHalo = useCallback(() => {
    const map = mapRef?.getMap();
    if (!map || fogStations.length === 0) {
      // Fade out when there's no data
      setOpacity(0);
      return;
    }

    const queryElev: ElevQuery = (lngLat) => {
      try { return map.queryTerrainElevation?.(lngLat) ?? null; }
      catch { return null; }
    };

    const data = buildHaloGeoJSON(queryElev, fogStations);
    if (data.features.length > 0) {
      setGeojson(data);
      lastRef.current = data;
      // Trigger fade-in
      setTimeout(() => setOpacity(1), 16);
    } else {
      // Terrain not loaded yet — defer (don't clear last frame)
      setOpacity(0);
    }
  }, [mapRef, fogStations]);

  // Rebuild halos when readings change. Tied to length + visibility values
  // so we don't spam re-renders on no-op map prop changes.
  const fogStationsKey = fogStations
    .map((s) => `${s.id}:${s.vis.toFixed(2)}`)
    .sort()
    .join('|');

  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;

    if (fogStations.length === 0) {
      setOpacity(0);
      // Hold last frame during fade-out, then clear
      const t = setTimeout(() => { setGeojson(null); lastRef.current = null; }, FADE_OUT_MS);
      return () => clearTimeout(t);
    }

    if (map.getTerrain && map.queryTerrainElevation) {
      buildHalo();
    } else {
      // Wait for terrain to load
      map.once?.('terrain', buildHalo);
    }
  }, [fogStationsKey, buildHalo, mapRef, fogStations.length]);

  if (!geojson || geojson.features.length === 0) return null;

  return (
    <Source id={SOURCE_ID} type="geojson" data={geojson}>
      <Layer
        id="aemet-vis-halo-fill"
        type="fill"
        source={SOURCE_ID}
        paint={{
          'fill-color': '#dbeafe', // very pale blue-white (distinct from FogOverlay's dynamic colors)
          'fill-opacity': [
            'interpolate', ['linear'], ['get', 'density'],
            0, 0,
            0.25, 0.18 * opacity,
            0.5, 0.32 * opacity,
            0.75, 0.45 * opacity,
            1, 0.55 * opacity,
          ],
          'fill-antialias': false,
        }}
      />
    </Source>
  );
}

export const AemetVisibilityHalo = memo(AemetVisibilityHaloInner);
