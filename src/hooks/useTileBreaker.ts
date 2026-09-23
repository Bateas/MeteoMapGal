/**
 * Takes a tile layer down when its tiles keep failing, and brings it back on
 * its own once the backoff runs out.
 *
 * Returns true while the layer must stay down: the caller unmounts its
 * <Source> for that time, so MapLibre is left with nothing to retry. Without
 * this a raster layer has no idea its server is failing — it re-asks for every
 * refused tile on each repaint and adds a new set on each pan.
 *
 * Any raster layer can use it; it is wired where the server behind the tiles
 * is known to be fragile (the CESGA wave model, the IHM charts).
 */
import { useEffect, useRef, useState } from 'react';
import { useMap } from 'react-map-gl/maplibre';
import { createTileBreaker, type TileBreaker } from '../services/tileErrorBreaker';

/** The two fields of MapLibre's events this needs; neither is in its typings. */
interface TileEventLike {
  sourceId?: string;
  tile?: unknown;
}

export function useTileBreaker(sourceId: string): boolean {
  const { current: mapRef } = useMap();
  const breakerRef = useRef<TileBreaker | null>(null);
  if (!breakerRef.current) breakerRef.current = createTileBreaker();
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;
    const breaker = breakerRef.current!;
    let reopen: ReturnType<typeof setTimeout> | undefined;

    const onError = (ev: unknown) => {
      if ((ev as TileEventLike).sourceId !== sourceId) return;
      if (!breaker.recordError()) return;
      setBlocked(true);
      clearTimeout(reopen);
      reopen = setTimeout(() => setBlocked(false), Math.max(0, breaker.backoffUntil() - Date.now()));
    };
    const onData = (ev: unknown) => {
      const e = ev as TileEventLike;
      if (e.sourceId === sourceId && e.tile) breaker.recordSuccess();
    };

    map.on('error', onError);
    map.on('sourcedata', onData);
    return () => {
      map.off('error', onError);
      map.off('sourcedata', onData);
      clearTimeout(reopen);
    };
  }, [mapRef, sourceId]);

  return blocked;
}
