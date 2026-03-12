import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

// ── Map style definitions ─────────────────────────────────

export type MapStyleId = 'osm' | 'positron' | 'dark' | 'voyager' | 'ign-topo' | 'ign-grey';

export interface MapStyleDef {
  id: MapStyleId;
  name: string;
  shortName: string;
  tiles: string[];
  tileSize: number;
  attribution: string;
  maxzoom: number;
  /** Preview swatch colors for the selector UI */
  swatch: [string, string];
}

export const MAP_STYLES: MapStyleDef[] = [
  {
    id: 'osm',
    name: 'OpenStreetMap',
    shortName: 'OSM',
    tiles: [
      'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
      'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
    ],
    tileSize: 256,
    attribution: '&copy; OpenStreetMap contributors',
    maxzoom: 19,
    swatch: ['#aad3df', '#f2efe9'],
  },
  {
    id: 'positron',
    name: 'Positron (Claro)',
    shortName: 'Claro',
    tiles: [
      'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
      'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
      'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
    ],
    tileSize: 256,
    attribution: '&copy; CARTO &copy; OSM contributors',
    maxzoom: 20,
    swatch: ['#e6e5e3', '#ffffff'],
  },
  {
    id: 'dark',
    name: 'Dark Matter',
    shortName: 'Oscuro',
    tiles: [
      'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
    ],
    tileSize: 256,
    attribution: '&copy; CARTO &copy; OSM contributors',
    maxzoom: 20,
    swatch: ['#2b2b2b', '#1a1a2e'],
  },
  {
    id: 'voyager',
    name: 'Voyager',
    shortName: 'Voyager',
    tiles: [
      'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
      'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
      'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
    ],
    tileSize: 256,
    attribution: '&copy; CARTO &copy; OSM contributors',
    maxzoom: 20,
    swatch: ['#d9e8e3', '#faf5ef'],
  },
  {
    id: 'ign-topo',
    name: 'IGN Topográfico',
    shortName: 'Topo',
    tiles: [
      'https://www.ign.es/wmts/mapa-raster?service=WMTS&request=GetTile&version=1.0.0&format=image/jpeg&layer=MTN&style=default&tilematrixset=GoogleMapsCompatible&tilematrix={z}&tilerow={y}&tilecol={x}',
    ],
    tileSize: 256,
    attribution: '&copy; IGN España',
    maxzoom: 17,
    swatch: ['#d4c9a8', '#e8dfc6'],
  },
  {
    id: 'ign-grey',
    name: 'IGN Base Gris',
    shortName: 'Gris',
    tiles: [
      'https://www.ign.es/wmts/ign-base?service=WMTS&request=GetTile&version=1.0.0&format=image/png&layer=IGNBaseGris&style=default&tilematrixset=GoogleMapsCompatible&tilematrix={z}&tilerow={y}&tilecol={x}',
    ],
    tileSize: 256,
    attribution: '&copy; IGN España',
    maxzoom: 17,
    swatch: ['#c5c5c5', '#e0e0e0'],
  },
];

// ── Store ─────────────────────────────────────────────────

interface MapStyleState {
  activeStyleId: MapStyleId;
  /** OpenSeaMap nautical overlay (buoys, lights, seamarks) */
  showSeamarks: boolean;
  /** IHM Electronic Navigational Chart overlay */
  showNauticalChart: boolean;
  /** IGN MDT hillshade — pre-rendered terrain relief */
  showIGNHillshade: boolean;
  /** IGN MDT contour lines — 25m spacing from BTN25 */
  showIGNContours: boolean;
  /** IGN PNOA aerial orthophotos — 25cm resolution */
  showIGNOrtho: boolean;

  setStyle: (id: MapStyleId) => void;
  toggleSeamarks: () => void;
  toggleNauticalChart: () => void;
  toggleIGNHillshade: () => void;
  toggleIGNContours: () => void;
  toggleIGNOrtho: () => void;
}

export const useMapStyleStore = create<MapStyleState>()(
  devtools(
    persist(
      (set, get) => ({
        activeStyleId: 'osm' as MapStyleId,
        showSeamarks: false,
        showNauticalChart: false,
        showIGNHillshade: false,
        showIGNContours: false,
        showIGNOrtho: false,

        setStyle: (activeStyleId) =>
          set({ activeStyleId }, undefined, 'setStyle'),

        toggleSeamarks: () =>
          set({ showSeamarks: !get().showSeamarks }, undefined, 'toggleSeamarks'),

        toggleNauticalChart: () =>
          set({ showNauticalChart: !get().showNauticalChart }, undefined, 'toggleNauticalChart'),

        toggleIGNHillshade: () =>
          set({ showIGNHillshade: !get().showIGNHillshade }, undefined, 'toggleIGNHillshade'),

        toggleIGNContours: () =>
          set({ showIGNContours: !get().showIGNContours }, undefined, 'toggleIGNContours'),

        toggleIGNOrtho: () =>
          set({ showIGNOrtho: !get().showIGNOrtho }, undefined, 'toggleIGNOrtho'),
      }),
      {
        name: 'meteomap-map-style',
        partialize: (state) => ({
          activeStyleId: state.activeStyleId,
          showSeamarks: state.showSeamarks,
          showNauticalChart: state.showNauticalChart,
          showIGNHillshade: state.showIGNHillshade,
          showIGNContours: state.showIGNContours,
          showIGNOrtho: state.showIGNOrtho,
        }),
      },
    ),
    { name: 'MapStyleStore' },
  ),
);

/** Get the full style definition for the current active style */
export function getStyleDef(id: MapStyleId): MapStyleDef {
  return MAP_STYLES.find((s) => s.id === id) ?? MAP_STYLES[0];
}
