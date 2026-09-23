/**
 * On-demand terrain, purely as an ELEVATION SOURCE — never as a visual.
 *
 * The map is flat 2D: no terrain mesh, no tilt, no sky. But MapLibre only
 * answers `queryTerrainElevation()` while terrain is set, and two fog surfaces
 * genuinely need real ground elevation:
 *
 *   - AemetVisibilityHalo — `visibilityHaloService` FAILS SAFE on a null
 *     station elevation (density 0), so without terrain the halo silently
 *     renders nothing at all.
 *   - FogOverlay — a null cell elevation reads as water and is ALLOWED, so
 *     without terrain every cell passes and the blobs over-paint onto hills.
 *
 * Terrain is expensive even on a flat map: besides the extra render pass,
 * MapLibre reads pixels back from the GPU (readPixels) on every pointer move
 * while it is set — 5 s of a 10 s pan trace on 24-Sep. So it is on only while
 * a consumer is `enabled`, i.e. while there is fog to draw. It used to be on
 * for every visitor from the first render: this note assumed the two
 * consumers only mount when fog is detected, but they are always mounted
 * (lazy only delays loading the code), and the hook had no condition.
 * Refcounted so both consumers can ask at once and the last one to stop
 * asking turns it back off.
 *
 * Exaggeration stays at 1.2 — the same value the style used before the map
 * went flat — so the elevations the fog code sees are identical to the ones
 * its thresholds were calibrated against.
 */

import { useEffect } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';

const TERRAIN_SPEC = { source: 'terrainDEM', exaggeration: 1.2 } as const;

/** Number of mounted consumers currently needing elevation queries. */
let consumers = 0;

export function useElevationTerrain(mapRef: MapRef | undefined, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const map = mapRef?.getMap();
    if (!map) return;

    consumers += 1;

    // Idempotent: safe to call from several consumers and on every style swap.
    const enable = () => {
      try {
        if (!map.getTerrain()) map.setTerrain({ ...TERRAIN_SPEC });
      } catch { /* style mid-swap — the next style.load retries */ }
    };

    // 'style.load', never 'load': 'load' fires once per map, so a consumer
    // mounting later (these are lazy, they only mount when fog appears) onto a
    // map whose style is still settling would wait for an event that already
    // happened — terrain never turns on and elevation queries answer null for
    // the rest of the session. 'style.load' also re-fires after every
    // setStyle (base map / sector switch), which wipes the terrain setting.
    map.on('style.load', enable);
    if (map.isStyleLoaded()) enable();

    return () => {
      // Per-consumer listener, removed with its own closure, so an unmount
      // never strips the listener another live consumer is relying on.
      map.off('style.load', enable);
      consumers = Math.max(0, consumers - 1);
      if (consumers === 0) {
        try { map.setTerrain(null); } catch { /* map already torn down */ }
      }
    };
  }, [mapRef, enabled]);
}
