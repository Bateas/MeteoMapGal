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
 * Rendering terrain costs a full extra render pass, so we pay for it only
 * while a fog surface is actually mounted (fog is rare — these components are
 * lazy and only mount when fog is detected). Refcounted so both consumers can
 * ask at once and the last one to unmount turns it back off.
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

export function useElevationTerrain(mapRef: MapRef | undefined): void {
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;

    consumers += 1;
    if (consumers === 1) {
      const enable = () => {
        try {
          if (!map.getTerrain()) map.setTerrain({ ...TERRAIN_SPEC });
        } catch { /* style not ready — the next consumer mount retries */ }
      };
      if (map.isStyleLoaded()) enable();
      else map.once('load', enable);
    }

    return () => {
      consumers = Math.max(0, consumers - 1);
      if (consumers === 0) {
        try { map.setTerrain(null); } catch { /* map already torn down */ }
      }
    };
  }, [mapRef]);
}
