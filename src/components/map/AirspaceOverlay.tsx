/**
 * AirspaceOverlay — renders ENAIRE UAS zones and NOTAMs on the map.
 *
 * Only visible when the Dron tab is active in FieldDrawer.
 * Uses MapLibre GeoJSON source + fill/line/symbol layers.
 *
 * Zone colors by type:
 *   PROHIBITED → red (#ef4444)
 *   REQ_AUTHORIZATION → amber (#f59e0b)
 *   Other → blue (#3b82f6)
 *
 * Click zone polygon → popup with details.
 * Click NOTAM marker → popup with full NOTAM info.
 */

import { useEffect, useMemo, useState, useCallback, memo } from 'react';
import { Source, Layer, Popup, useMap } from 'react-map-gl/maplibre';
import { useAirspaceStore } from '../../store/airspaceStore';
import { useUIStore } from '../../store/uiStore';
import type { UasZone, ActiveNotam } from '../../api/enaireClient';

// ── Types ─────────────────────────────────────────────────

interface ZonePopupData {
  name: string;
  type: string;
  lowerAlt: number;
  upperAlt: number;
  altRef: string;
  reason: string;
  contact: string;
  lon: number;
  lat: number;
}

interface NotamPopupData {
  id: string;
  location: string;
  description: string;
  lowerFt: number;
  upperFt: number;
  start: string;
  end: string;
  lon: number;
  lat: number;
}

// ── Color helpers ─────────────────────────────────────────

/** Color by content: name + reasons + type determine the visual category */
function zoneLineColor(z: { type: string; name: string; reasons?: string; layerCategory: number }): string {
  const t = z.type.toUpperCase();
  const n = z.name.toUpperCase();
  const r = (z.reasons ?? '').toUpperCase();
  const all = n + ' ' + r;
  // Severity first
  if (t.includes('PROHIB')) return '#ef4444'; // red
  // Content-based classification
  if (all.includes('TMA') || all.includes('CTR') || all.includes('AERODROM') || all.includes('AEROPUERT')) return '#f59e0b'; // orange: real aviation
  if (all.includes('ADIF') || all.includes('FERROV') || all.includes('TREN') || all.includes('FFCC')) return '#8b5cf6'; // purple: railway
  if (all.includes('ZEPA') || all.includes('NATURA') || all.includes('PARQUE') || all.includes('LIC') || all.includes('ZEC') || all.includes('RESERVA') || all.includes('PROTEG')) return '#22c55e'; // green: nature
  if (all.includes('URBAN') || all.includes('CIUDAD') || all.includes('POBLAC')) return '#64748b'; // gray: urban
  // Layer-based fallback
  if (z.layerCategory === 2) return '#22c55e'; // green: environment layer
  if (z.layerCategory === 3) return '#64748b'; // gray: urban layer
  return '#f59e0b80'; // faded orange: generic UAS zones (most common, de-emphasize)
}

function zoneFillRgba(z: { type: string; name: string; reasons?: string; layerCategory: number }): string {
  const hex = zoneLineColor(z);
  const clean = hex.length > 7 ? hex.slice(0, 7) : hex; // strip alpha if present
  const r = parseInt(clean.slice(1, 3), 16);
  const g = parseInt(clean.slice(3, 5), 16);
  const b = parseInt(clean.slice(5, 7), 16);
  return `rgba(${r},${g},${b},0.06)`;
}

/** Should this zone show a text label on the map? Hide generic fallback names */
function shouldShowLabel(name: string): boolean {
  const generic = ['Zona aeroportuaria', 'Zona urbana', 'Zona infraestructura', 'Zona restringida', 'Zona protegida'];
  return !generic.includes(name);
}

// ── GeoJSON builders ──────────────────────────────────────

function buildZonesGeoJSON(zones: UasZone[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: zones
      .filter((z) => z.geometry && z.name)
      .map((z, i) => ({
        type: 'Feature' as const,
        id: i,
        properties: {
          name: z.name,
          showLabel: shouldShowLabel(z.name) ? 1 : 0,
          type: z.type,
          lowerAlt: z.lowerAltitude,
          upperAlt: z.upperAltitude,
          altRef: z.altitudeReference || 'AGL',
          reason: z.reasons || '',
          contact: [z.phone, z.email].filter(Boolean).join(' / '),
          fillColor: zoneFillRgba(z),
          lineColor: zoneLineColor(z),
        },
        geometry: z.geometry,
      })),
  };
}

function buildNotamsGeoJSON(notams: ActiveNotam[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: notams
      .filter((n) => n.geometry)
      .map((n, i) => ({
        type: 'Feature' as const,
        id: i,
        properties: {
          notamId: n.notamId,
          location: n.location,
          description: n.description,
          lowerFt: n.lowerAltitudeFt,
          upperFt: n.upperAltitudeFt,
          start: n.startDate.toISOString(),
          end: n.endDate.toISOString(),
        },
        geometry: n.geometry,
      })),
  };
}

/** Compute centroid of a GeoJSON polygon (average of exterior ring). */
function polygonCentroid(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number] {
  const ring =
    geom.type === 'MultiPolygon'
      ? geom.coordinates[0][0]
      : geom.coordinates[0];

  let lonSum = 0, latSum = 0;
  for (const coord of ring) {
    lonSum += coord[0];
    latSum += coord[1];
  }
  return [lonSum / ring.length, latSum / ring.length];
}

// ── Interactable layer IDs ────────────────────────────────

const ZONE_FILL_ID = 'airspace-zones-fill';
const NOTAM_CIRCLE_ID = 'airspace-notams-circle';
const NOTAM_FILL_ID = 'airspace-notams-fill';

// ── Component ─────────────────────────────────────────────

export const AirspaceOverlay = memo(function AirspaceOverlay() {
  const { current: mapInstance } = useMap();
  const droneTabActive = useUIStore((s) => s.droneTabActive);
  const zones = useAirspaceStore((s) => s.zones);
  const notams = useAirspaceStore((s) => s.notams);

  const [zonePopup, setZonePopup] = useState<ZonePopupData | null>(null);
  const [notamPopup, setNotamPopup] = useState<NotamPopupData | null>(null);

  // Build GeoJSON — empty when tab not active (hides layers)
  const zonesGeoJSON = useMemo(
    () => buildZonesGeoJSON(droneTabActive ? zones : []),
    [zones, droneTabActive],
  );

  const notamsGeoJSON = useMemo(
    () => buildNotamsGeoJSON(droneTabActive ? notams : []),
    [notams, droneTabActive],
  );

  // Close popups when tab deactivates
  useEffect(() => {
    if (!droneTabActive) {
      setZonePopup(null);
      setNotamPopup(null);
    }
  }, [droneTabActive]);

  // ── Map click/hover handlers (registered on the map instance) ──

  useEffect(() => {
    if (!mapInstance) return;
    const map = mapInstance.getMap();
    if (!map) return;

    function onZoneClick(e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) {
      const feature = e.features?.[0];
      if (!feature) return;

      const props = feature.properties;
      const geom = feature.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
      const [lon, lat] = polygonCentroid(geom);

      setNotamPopup(null);
      setZonePopup({
        name: props.name as string,
        type: props.type as string,
        lowerAlt: Number(props.lowerAlt) || 0,
        upperAlt: Number(props.upperAlt) || 0,
        altRef: (props.altRef as string) || 'AGL',
        reason: (props.reason as string) || '',
        contact: (props.contact as string) || '',
        lon,
        lat,
      });
    }

    function onNotamClick(e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) {
      const feature = e.features?.[0];
      if (!feature) return;

      const props = feature.properties;
      const geom = feature.geometry;

      let lon: number, lat: number;
      if (geom.type === 'Point') {
        [lon, lat] = (geom as GeoJSON.Point).coordinates as [number, number];
      } else {
        [lon, lat] = polygonCentroid(geom as GeoJSON.Polygon | GeoJSON.MultiPolygon);
      }

      setZonePopup(null);
      setNotamPopup({
        id: props.notamId as string,
        location: props.location as string,
        description: props.description as string,
        lowerFt: Number(props.lowerFt) || 0,
        upperFt: Number(props.upperFt) || 0,
        start: new Date(props.start as string).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }),
        end: new Date(props.end as string).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }),
        lon,
        lat,
      });
    }

    function setCursorPointer() { map.getCanvas().style.cursor = 'pointer'; }
    function resetCursor() { map.getCanvas().style.cursor = ''; }

    // Register handlers (MapLibre ignores if layer doesn't exist yet — safe)
    map.on('click', ZONE_FILL_ID, onZoneClick);
    map.on('click', NOTAM_CIRCLE_ID, onNotamClick);
    map.on('click', NOTAM_FILL_ID, onNotamClick);
    map.on('mouseenter', ZONE_FILL_ID, setCursorPointer);
    map.on('mouseleave', ZONE_FILL_ID, resetCursor);
    map.on('mouseenter', NOTAM_CIRCLE_ID, setCursorPointer);
    map.on('mouseleave', NOTAM_CIRCLE_ID, resetCursor);
    map.on('mouseenter', NOTAM_FILL_ID, setCursorPointer);
    map.on('mouseleave', NOTAM_FILL_ID, resetCursor);

    return () => {
      map.off('click', ZONE_FILL_ID, onZoneClick);
      map.off('click', NOTAM_CIRCLE_ID, onNotamClick);
      map.off('click', NOTAM_FILL_ID, onNotamClick);
      map.off('mouseenter', ZONE_FILL_ID, setCursorPointer);
      map.off('mouseleave', ZONE_FILL_ID, resetCursor);
      map.off('mouseenter', NOTAM_CIRCLE_ID, setCursorPointer);
      map.off('mouseleave', NOTAM_CIRCLE_ID, resetCursor);
      map.off('mouseenter', NOTAM_FILL_ID, setCursorPointer);
      map.off('mouseleave', NOTAM_FILL_ID, resetCursor);
    };
  }, [mapInstance]);

  // Always render Source/Layer (empty data when inactive hides them)
  return (
    <>
      {/* ── UAS Zone polygons ── */}
      <Source id="airspace-zones" type="geojson" data={zonesGeoJSON}>
        {/* Fill */}
        <Layer
          id={ZONE_FILL_ID}
          type="fill"
          paint={{
            'fill-color': ['get', 'fillColor'],
            'fill-opacity': 0.25,
          }}
        />
        {/* Dashed border */}
        <Layer
          id="airspace-zones-line"
          type="line"
          paint={{
            'line-color': ['get', 'lineColor'],
            'line-width': 2,
            'line-dasharray': [4, 2],
          }}
        />
        {/* Zone name labels */}
        <Layer
          id="airspace-zones-label"
          type="symbol"
          filter={['==', ['get', 'showLabel'], 1]}
          layout={{
            'text-field': ['get', 'name'],
            'text-size': 11,
            'text-font': ['Noto Sans Regular'],
            'text-anchor': 'center',
            'text-allow-overlap': false,
          }}
          paint={{
            'text-color': ['get', 'lineColor'],
            'text-halo-color': 'rgba(0,0,0,0.8)',
            'text-halo-width': 1.5,
          }}
        />
      </Source>

      {/* ── NOTAM markers (points → circles, polygons → fill) ── */}
      <Source id="airspace-notams" type="geojson" data={notamsGeoJSON}>
        <Layer
          id={NOTAM_CIRCLE_ID}
          type="circle"
          filter={['==', ['geometry-type'], 'Point']}
          paint={{
            'circle-radius': 8,
            'circle-color': 'rgba(59,130,246,0.3)',
            'circle-stroke-color': '#3b82f6',
            'circle-stroke-width': 2,
          }}
        />
        <Layer
          id={NOTAM_FILL_ID}
          type="fill"
          filter={['==', ['geometry-type'], 'Polygon']}
          paint={{
            'fill-color': 'rgba(59,130,246,0.1)',
            'fill-outline-color': '#3b82f6',
          }}
        />
      </Source>

      {/* ── Zone popup ── */}
      {zonePopup && (
        <Popup
          longitude={zonePopup.lon}
          latitude={zonePopup.lat}
          closeOnClick={false}
          onClose={() => setZonePopup(null)}
          maxWidth="280px"
        >
          <div className="p-1.5 text-xs">
            <h3 className="font-bold text-slate-200 text-sm mb-1">{zonePopup.name}</h3>
            <div className="space-y-0.5 text-slate-400">
              <p>
                <span
                  className="inline-block px-1.5 py-0.5 rounded text-[11px] font-bold mr-1"
                  style={{
                    background: zoneFillRgba(zonePopup.type),
                    color: zoneLineColor(zonePopup.type),
                    border: `1px solid ${zoneLineColor(zonePopup.type)}40`,
                  }}
                >
                  {zonePopup.type}
                </span>
              </p>
              <p>Altitud: {zonePopup.lowerAlt}m — {zonePopup.upperAlt}m {zonePopup.altRef}</p>
              {zonePopup.reason && <p>Motivo: {zonePopup.reason}</p>}
              {zonePopup.contact && <p>Contacto: {zonePopup.contact}</p>}
            </div>
          </div>
        </Popup>
      )}

      {/* ── NOTAM popup ── */}
      {notamPopup && (
        <Popup
          longitude={notamPopup.lon}
          latitude={notamPopup.lat}
          closeOnClick={false}
          onClose={() => setNotamPopup(null)}
          maxWidth="300px"
        >
          <div className="p-1.5 text-xs">
            <h3 className="font-bold text-slate-200 text-sm mb-1">
              NOTAM {notamPopup.id}
            </h3>
            <div className="space-y-0.5 text-slate-400">
              <p className="text-[11px] text-blue-400">ICAO: {notamPopup.location}</p>
              <p className="text-slate-300">{notamPopup.description}</p>
              <p>Altitud: {notamPopup.lowerFt} — {notamPopup.upperFt} ft</p>
              <p>Vigencia: {notamPopup.start} — {notamPopup.end}</p>
              <a
                href="https://aip.enaire.es"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 underline text-[11px] mt-1 inline-block"
              >
                Consultar en ENAIRE AIP
              </a>
            </div>
          </div>
        </Popup>
      )}
    </>
  );
});
