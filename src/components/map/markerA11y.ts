import type { MarkerInstance } from 'react-map-gl/maplibre';

/**
 * Make a react-map-gl <Marker> wrapper a real, named, keyboard button.
 *
 * react-map-gl creates the wrapper <div> itself (document.createElement) and
 * portals the JSX children into it, so JSX props and a synthetic onKeyDown never
 * reach it. MapLibre's Marker.addTo() then stamps role="button" and
 * aria-label="Map marker" ONLY IF they are absent, and never sets tabindex (it
 * only does that in setPopup(), which we do not use). MarkerOptions has no
 * label/role/tabindex option, so the only handle is the Marker ref, whose
 * getElement() is that wrapper.
 *
 * Idempotent: attributes are overwritten and onkeydown is a property (replaced,
 * never stacked), so it is safe on every ref re-attach. It does not touch style
 * (the zIndex from <Marker style>) or pointer events; mouse and touch still go
 * through <Marker onClick>, and MapLibre's own mousedown preventDefault keeps a
 * click from ever focusing the wrapper, so no focus ring appears on tap.
 */
/** Keys MapLibre's KeyboardHandler turns into a pan or a zoom. */
const MAP_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '+', '=', '-', '_']);

export function makeMarkerButton(
  marker: MarkerInstance | null,
  label: string,
  onActivate: () => void,
): void {
  if (!marker) return; // ref detach, StrictMode, or test mocks that render no instance
  const el = marker.getElement();
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', label);
  el.tabIndex = 0;
  el.onkeydown = (e: KeyboardEvent) => {
    if (e.target !== el) return; // keys from descendants are not ours
    if (MAP_KEYS.has(e.key)) {
      // MapLibre's keyboard handler listens on the canvas container, in the
      // bubble phase. Arrows or +/- on a focused spot would pan or zoom the map;
      // while it moves, `.map-panning` hides every marker and the browser drops
      // focus to <body>. Keep them on the spot, where they mean nothing.
      e.stopPropagation();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      // Cancel BOTH keys, not only Space. Cancelling keydown means no keypress
      // follows: on desktop the MapLibre Popup focuses its first control
      // synchronously after the selection, and an uncancelled Enter would then
      // activate that control. For Space it also stops the page from scrolling.
      e.preventDefault();
      onActivate();
    }
  };
}
