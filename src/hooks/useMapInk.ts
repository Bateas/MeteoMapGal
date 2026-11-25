/**
 * The colours of a word written on the map. A fixed light text with a dark halo turned to mud on the light
 * base maps, and a coloured one was unreadable on them. It depends on the map drawn, not on the theme: the
 * street and topographic maps are light under a dark theme too, and the aerial photo is dark under a light one.
 */
import { useMemo } from 'react';
import { useMapStyleStore, resolveStyleId, type MapStyleId } from '../store/mapStyleStore';
import { useThemeStore } from '../store/themeStore';

const DARK_MAPS: ReadonlySet<MapStyleId> = new Set<MapStyleId>(['dark', 'ign-ortho']);

export interface MapInk {
  text: string;
  halo: string;
  /** The same halo, for words in the DOM (spot markers) */
  shadow: string;
}

export function inkForMap(id: MapStyleId): MapInk {
  return DARK_MAPS.has(id)
    ? { text: '#f1f5f9', halo: '#0b0f14', shadow: '0 0 3px #0b0f14, 0 0 3px #0b0f14, 0 1px 2px #0b0f14' }
    : { text: '#14181f', halo: '#ffffff', shadow: '0 0 3px #ffffff, 0 0 3px #ffffff, 0 1px 2px #ffffff' };
}

/** Whether the map drawn now is a dark one, for what is painted on a canvas or registered as an image. */
export function mapIsDark(): boolean {
  return DARK_MAPS.has(resolveStyleId(useMapStyleStore.getState().activeStyleId, useThemeStore.getState().theme));
}

export function useMapInk(): MapInk {
  const choice = useMapStyleStore((s) => s.activeStyleId);
  const theme = useThemeStore((s) => s.theme);
  const id = resolveStyleId(choice, theme);
  return useMemo(() => inkForMap(id), [id]);
}
