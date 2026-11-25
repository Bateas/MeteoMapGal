import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

// ── Map style definitions ─────────────────────────────────

export type MapStyleId = 'positron' | 'dark' | 'voyager' | 'ign-topo' | 'ign-ortho';

/**
 * What the user has picked: one concrete base map, or 'auto', which follows
 * the app theme (grey light canvas with the light theme, grey dark canvas with
 * the dark one). 'auto' is the default: the street map, with its road shields
 * and coloured motorways, competed with the wind data and is now an option.
 */
export type MapStyleChoice = MapStyleId | 'auto';

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
  /**
   * Labels-only tiles drawn above the relief. Esri's grey canvases keep place
   * names in a separate "Reference" service: without it the base map shows the
   * coast and the rías but not Cangas, Moaña or Vigo.
   */
  labelTiles?: string[];
}

export const MAP_STYLES: MapStyleDef[] = [
  // CARTO's key-free basemaps ended, and not with a 403 — they answer 200 with a
  // perfectly valid PNG that has "API KEY REQUIRED / carto.com/basemaps/apikey"
  // burned into the image. A status check can never catch that; the giveaway is
  // the weight, 59KB against 9KB for the same tile elsewhere. Three of the six
  // base maps were watermarked, the default among them, so every first visit
  // landed on it.
  //
  // The ids stay exactly as they were: they are persisted in every user's
  // localStorage, and renaming them would silently reset the map for people who
  // had chosen one. Only the tiles behind them change, and each keeps its role —
  // minimal light, minimal dark, colourful streets.
  {
    id: 'positron',
    name: 'Gris claro, sin carreteras',
    shortName: 'Claro',
    tiles: [
      'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    attribution: 'Esri, HERE, Garmin, &copy; OSM contributors',
    maxzoom: 16,
    swatch: ['#e6e5e3', '#ffffff'],
    labelTiles: [
      'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
    ],
  },
  {
    id: 'dark',
    name: 'Gris oscuro, sin carreteras',
    shortName: 'Oscuro',
    tiles: [
      'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    attribution: 'Esri, HERE, Garmin, &copy; OSM contributors',
    maxzoom: 16,
    swatch: ['#2b2b2b', '#1a1a2e'],
    labelTiles: [
      'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
    ],
  },
  {
    id: 'voyager',
    name: 'Callejero',
    shortName: 'Calles',
    tiles: [
      'https://services.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    attribution: 'Esri, HERE, Garmin, &copy; OSM contributors',
    maxzoom: 19,
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
    id: 'ign-ortho',
    name: 'Foto aérea (IGN PNOA)',
    shortName: 'Foto',
    tiles: ['https://www.ign.es/wmts/pnoa-ma?service=WMTS&request=GetTile&version=1.0.0&format=image/jpeg&layer=OI.OrthoimageCoverage&style=default&tilematrixset=GoogleMapsCompatible&tilematrix={z}&tilerow={y}&tilecol={x}'],
    tileSize: 256,
    attribution: '&copy; IGN España, PNOA',
    maxzoom: 19,
    swatch: ['#5c6b4f', '#8a8f6c'],
  },
];

/** What the menu offers besides Auto. The grey canvases are Auto's: picked by the theme, not by hand. */
export const PICKABLE_STYLES: MapStyleId[] = ['voyager', 'ign-topo', 'ign-ortho'];

// ── Store ─────────────────────────────────────────────────

interface MapStyleState {
  /** The user's pick; resolve it with `resolveStyleId` before drawing. */
  activeStyleId: MapStyleChoice;
  /** IHM nautical chart (coastal sectors) */
  showNauticalChart: boolean;
  /** SWAN wave model (coastal sectors) */
  showSwan: boolean;
  setStyle: (id: MapStyleChoice) => void;
  toggleNauticalChart: () => void;
  toggleSwan: () => void;
}

export const useMapStyleStore = create<MapStyleState>()(
  devtools(
    persist(
      (set, get) => ({
        activeStyleId: 'auto' as MapStyleChoice,
        showNauticalChart: false,
        showSwan: false,

        setStyle: (activeStyleId) =>
          set({ activeStyleId }, undefined, 'setStyle'),

        toggleNauticalChart: () =>
          set({ showNauticalChart: !get().showNauticalChart }, undefined, 'toggleNauticalChart'),

        toggleSwan: () =>
          set({ showSwan: !get().showSwan }, undefined, 'toggleSwan'),
      }),
      {
        name: 'meteomap-map-style',
        version: 2,
        migrate: migrateMapStyle,
        partialize: (state) => ({
          activeStyleId: state.activeStyleId,
          showNauticalChart: state.showNauticalChart,
          showSwan: state.showSwan,
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

/** The base map to draw for a choice: 'auto' follows the app theme. */
export function resolveStyleId(choice: MapStyleChoice, theme: 'dark' | 'light'): MapStyleId {
  if (choice === 'auto') return theme === 'light' ? 'positron' : 'dark';
  return choice;
}

/**
 * v0 -> v1: the default used to be the street map ('voyager'). Everyone still
 * on it moves to 'auto'. There is no way to tell a deliberate pick from the old
 * default, so the few who chose the street map on purpose lose it once; any
 * other pick is theirs and stays.
 */
export function migrateMapStyle(persisted: unknown, version: number): MapStyleState {
  const state = { ...((persisted ?? {}) as Record<string, unknown>) };
  if (version < 1 && state.activeStyleId === 'voyager') state.activeStyleId = 'auto';
  if (version < 2) {
    // v1 -> v2: four base maps. The orthophoto was a layer and is now one of them; a map that is no longer
    // offered goes back to Auto. The wave model's switch had the name of another overlay.
    const pick = state.activeStyleId as MapStyleId | 'auto' | undefined;
    if (state.showIGNOrtho) state.activeStyleId = 'ign-ortho';
    else if (pick && pick !== 'auto' && !PICKABLE_STYLES.includes(pick)) state.activeStyleId = 'auto';
    if (state.showUpwelling !== undefined) state.showSwan = state.showUpwelling;
    for (const gone of ['showSeamarks', 'showIGNHillshade', 'showIGNContours', 'showIGNOrtho', 'showWaveCoast', 'showUpwelling']) {
      delete state[gone];
    }
  }
  return state as unknown as MapStyleState;
}
