/**
 * A desktop window too narrow for the side panel and the map together.
 *
 * The desktop view starts at 768 px (the phone cut, shared with Tailwind's `md`). From there up to
 * 1024 px the open side panel (320 px) leaves about 450 px of map: a card covers most of it and the
 * tools at the bottom have no room. In that range the panel stays folded unless the reader opens it,
 * and it folds again when a card opens.
 */
export const DESKTOP_MIN_PX = 768;
export const NARROW_DESKTOP_MAX_PX = 1024;
export const NARROW_DESKTOP_QUERY = `(min-width: ${DESKTOP_MIN_PX}px) and (max-width: ${NARROW_DESKTOP_MAX_PX - 1}px)`;

export function isNarrowDesktop(widthPx: number): boolean {
  return widthPx >= DESKTOP_MIN_PX && widthPx < NARROW_DESKTOP_MAX_PX;
}
