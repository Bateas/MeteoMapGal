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
/**
 * The marker a card was last opened from with the keyboard. A card that peeks on a phone does not take the focus
 * from a tap (the map is still in use), but from Enter or Space it must: the marker re-renders as the selected one,
 * the browser drops the focus to <body>, and a screen reader is left saying nothing (P4, 18-nov). Read once.
 */
let keyboardOpener: { el: HTMLElement; at: number } | null = null;
/** How long a key press counts as what opened the card: a card that never mounted must not take a later tap's. */
const OPENER_FRESH_MS = 1500;
export function takeKeyboardOpener(nowMs = Date.now()): HTMLElement | null {
  const held = keyboardOpener;
  keyboardOpener = null;
  return held && nowMs - held.at <= OPENER_FRESH_MS ? held.el : null;
}

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
      keyboardOpener = { el, at: Date.now() };
      onActivate();
    }
  };
}

/**
 * The order the Tab key walks the markers in: what is in view first, the nearest to the centre of the map
 * leading; what is out of view keeps its place after. Ties keep the order they came in.
 */
export function tabOrder<T>(
  items: readonly { item: T; x: number; y: number }[],
  box: { width: number; height: number },
): T[] {
  const cx = box.width / 2;
  const cy = box.height / 2;
  const seen = (p: { x: number; y: number }) => p.x >= 0 && p.x <= box.width && p.y >= 0 && p.y <= box.height;
  const far = (p: { x: number; y: number }) => (p.x - cx) ** 2 + (p.y - cy) ** 2;
  const inView = items.filter(seen).map((p, i) => ({ p, i })).sort((a, b) => far(a.p) - far(b.p) || a.i - b.i);
  return [...inView.map((e) => e.p.item), ...items.filter((p) => !seen(p)).map((p) => p.item)];
}

/**
 * Put the keyboard markers of a map in that order. MapLibre appends each marker to the map as it mounts, so
 * the first Tab on the map always went to the first spot of the list, wherever the map was looking (25-nov:
 * Castrelo inland and Cesantes on the coast, even out of view). Markers are placed by transform: their order
 * in the document moves nothing on screen.
 *
 * Nothing moves while a marker holds the focus: a node taken out and put back loses it, and the reader in
 * the middle of the row would be thrown out of it. Returns whether anything moved.
 */
export function orderMarkersForTab(container: HTMLElement | null | undefined): boolean {
  if (!container) return false;
  const markers = Array.from(container.children).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains('maplibregl-marker') && el.tabIndex === 0,
  );
  if (markers.length < 2) return false;
  const active = document.activeElement;
  if (active && markers.some((m) => m.contains(active))) return false;
  // The view is the canvas: the box MapLibre keeps the markers in has no size of its own (0 x 0 in a
  // browser), and measured by it every marker counted as out of view and nothing was ever put in order.
  const box = (container.querySelector('canvas') ?? container).getBoundingClientRect();
  const sorted = tabOrder(
    markers.map((el) => {
      const r = el.getBoundingClientRect();
      return { item: el, x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top };
    }),
    box,
  );
  if (sorted.every((el, i) => el === markers[i])) return false;
  container.append(...sorted);
  return true;
}
