/**
 * Fixed clock slots for the sources that publish slower than our 5-min poll.
 *
 * IPMA publishes hourly and SkyX reports every 10 min, yet both were asked every 5 min:
 * most answers repeated the one before (IPMA's is the GeoJSON of every station in
 * Portugal, for four of them). Each source now gets ONE good answer per slot of the
 * clock; between slots the poll hands back the last batch (the upsert ignores rows it
 * already has). A failed or empty answer does not use up the slot, so the next cycle
 * tries again, as with AEMET (aemetCadence.ts).
 *
 * Slots are of the clock, not of the process: a restart or a crash loop inside a slot
 * that already got its answer does not ask again. Pure, so the arithmetic is tested
 * without a clock.
 */

/** IPMA: two slots an hour (its data is hourly; two looks bound the delay to ~30 min). */
export const IPMA_SLOT_MS = 30 * 60_000;
export const IPMA_SLOT_OFFSET_MS = 5 * 60_000;

/** SkyX: the unit reports at :00, :10, ...; a slot starting 2 min later finds the new report. */
export const SKYX_SLOT_MS = 10 * 60_000;
export const SKYX_SLOT_OFFSET_MS = 2 * 60_000;

/** Index of the clock slot `now` falls in (slots start `offsetMs` past each multiple of `slotMs`). */
export function slotOf(now: number, slotMs: number, offsetMs = 0): number {
  return Math.floor((now - offsetMs) / slotMs);
}

/** True when no good answer has been taken in the slot `now` falls in. */
export function slotPollDue(lastGoodSlot: number | null, now: number, slotMs: number, offsetMs = 0): boolean {
  return lastGoodSlot == null || slotOf(now, slotMs, offsetMs) !== lastGoodSlot;
}
