import { describe, it, expect } from 'vitest';
import { slotOf, slotPollDue, IPMA_SLOT_MS, IPMA_SLOT_OFFSET_MS, SKYX_SLOT_MS, SKYX_SLOT_OFFSET_MS } from './sourceCadence';

const at = (iso: string) => Date.parse(iso);

describe('slotOf', () => {
  it('numbers the slots of the clock, starting offset past each multiple', () => {
    // SkyX slots start at :02, :12, :22...
    expect(slotOf(at('2026-10-21T09:01:59Z'), SKYX_SLOT_MS, SKYX_SLOT_OFFSET_MS))
      .toBe(slotOf(at('2026-10-21T08:52:00Z'), SKYX_SLOT_MS, SKYX_SLOT_OFFSET_MS));
    expect(slotOf(at('2026-10-21T09:02:00Z'), SKYX_SLOT_MS, SKYX_SLOT_OFFSET_MS))
      .toBe(slotOf(at('2026-10-21T08:52:00Z'), SKYX_SLOT_MS, SKYX_SLOT_OFFSET_MS) + 1);
  });
});

describe('slotPollDue', () => {
  it('asks when nothing good has arrived yet', () => {
    expect(slotPollDue(null, at('2026-10-21T09:00:00Z'), IPMA_SLOT_MS, IPMA_SLOT_OFFSET_MS)).toBe(true);
  });

  it('asks IPMA once per half hour of the clock, whatever the phase of the 5-min poll', () => {
    // Poll cycles every 5 min starting at an arbitrary second, over two hours.
    let lastGood: number | null = null;
    let asks = 0;
    const start = at('2026-10-21T09:05:17Z');
    for (let k = 0; k < 24; k++) {
      const now = start + k * 5 * 60_000;
      if (slotPollDue(lastGood, now, IPMA_SLOT_MS, IPMA_SLOT_OFFSET_MS)) {
        asks++;
        lastGood = slotOf(now, IPMA_SLOT_MS, IPMA_SLOT_OFFSET_MS);
      }
    }
    expect(asks).toBe(4);
  });

  it('asks SkyX once per 10 min: half of the 5-min cycles reuse the last reading', () => {
    let lastGood: number | null = null;
    let asks = 0;
    const start = at('2026-10-21T09:02:41Z');
    for (let k = 0; k < 12; k++) {
      const now = start + k * 5 * 60_000;
      if (slotPollDue(lastGood, now, SKYX_SLOT_MS, SKYX_SLOT_OFFSET_MS)) {
        asks++;
        lastGood = slotOf(now, SKYX_SLOT_MS, SKYX_SLOT_OFFSET_MS);
      }
    }
    expect(asks).toBe(6);
  });

  it('a restart inside a slot that already got its answer does not ask again', () => {
    const good = slotOf(at('2026-10-21T09:06:00Z'), IPMA_SLOT_MS, IPMA_SLOT_OFFSET_MS);
    expect(slotPollDue(good, at('2026-10-21T09:34:59Z'), IPMA_SLOT_MS, IPMA_SLOT_OFFSET_MS)).toBe(false);
    expect(slotPollDue(good, at('2026-10-21T09:35:00Z'), IPMA_SLOT_MS, IPMA_SLOT_OFFSET_MS)).toBe(true);
  });
});
