/**
 * A wind spot and a surf spot on the same beach (A Lanzada, 320 m apart) were drawn one on top of the other at any
 * zoom. They go side by side, each a little off its point: same beach, so nothing is misplaced by it.
 */
import { ALL_SPOTS } from '../../config/spots';

/** Closer than this, they are the same beach. */
const TWIN_KM = 1;
const TWIN_OFFSET_PX = 42;

const OFFSETS = new Map<string, number>();
for (const wind of ALL_SPOTS) {
  if (wind.category === 'surf') continue;
  for (const surf of ALL_SPOTS) {
    if (surf.category !== 'surf') continue;
    if (Math.hypot((wind.center[0] - surf.center[0]) * 0.74, wind.center[1] - surf.center[1]) * 111 > TWIN_KM) continue;
    OFFSETS.set(wind.id, -TWIN_OFFSET_PX);
    OFFSETS.set(surf.id, TWIN_OFFSET_PX);
  }
}

/** Pixels sideways on screen for this spot's marker; 0 for nearly all of them. */
export function spotTwinOffset(spotId: string): number {
  return OFFSETS.get(spotId) ?? 0;
}
