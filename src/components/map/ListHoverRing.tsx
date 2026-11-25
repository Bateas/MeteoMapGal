/**
 * The ring that says where a row of the side panel is. Over whatever marker is there (or the cluster it fell into),
 * without touching the marker layers, and never in the way of a click. White with a dark edge: it reads on any base
 * map. Not a control, so it stays out of the accessibility tree.
 */
import { useCallback } from 'react';
import { Marker, type MarkerInstance } from 'react-map-gl/maplibre';
import { useUIStore } from '../../store/uiStore';

export function ListHoverRing() {
  const target = useUIStore((s) => s.listHover);
  const quiet = useCallback((mk: MarkerInstance | null) => {
    const el = mk?.getElement();
    if (!el) return;
    el.setAttribute('role', 'presentation');
    el.setAttribute('aria-hidden', 'true');
    el.removeAttribute('aria-label');
  }, []);
  if (!target) return null;
  return (
    <Marker ref={quiet} longitude={target.lon} latitude={target.lat} anchor="center" offset={[target.offsetX ?? 0, 0]} style={{ zIndex: 29, pointerEvents: 'none' }}>
      <span className="gc-maphover" />
    </Marker>
  );
}
