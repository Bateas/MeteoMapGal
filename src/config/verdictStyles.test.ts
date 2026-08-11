/**
 * Tests for the provisional-score helpers.
 *
 * These exist because the decision was previously made independently by each
 * surface, and six of eight got it wrong — producing two different answers to
 * the same question on the same screen at the same second. The point of the
 * helpers is that a new surface cannot forget, so what is pinned here is the
 * contract every caller now shares.
 */

import { describe, it, expect } from 'vitest';
import {
  displayVerdict,
  verdictLabel,
  displayWindKt,
  PROVISIONAL_LABEL,
  VERDICT_STYLE,
  VERDICT_HEX,
} from './verdictStyles';
import type { SpotVerdict } from '../services/spotScoringEngine';

describe('displayVerdict', () => {
  it('collapses a provisional score to the neutral verdict', () => {
    expect(displayVerdict({ verdict: 'good', provisional: true })).toBe('unknown');
  });

  it('passes a settled verdict straight through', () => {
    expect(displayVerdict({ verdict: 'good', provisional: false })).toBe('good');
    expect(displayVerdict({ verdict: 'strong' })).toBe('strong');
  });

  it('treats a missing score as unknown rather than throwing', () => {
    // Surfaces render before scoring has run at all.
    expect(displayVerdict(undefined)).toBe('unknown');
    expect(displayVerdict(null)).toBe('unknown');
    expect(displayVerdict({})).toBe('unknown');
  });

  it('returns a verdict every Record in the codebase already covers', () => {
    // The reason for reusing 'unknown' instead of adding a value to
    // SpotVerdict: a new key would be missing from VERDICT_STYLE, VERDICT_HEX
    // and the comparator's sort order, and the last one fails silently — the
    // spot would sink to the bottom of the list with no error anywhere.
    const out = displayVerdict({ verdict: 'good', provisional: true });
    expect(VERDICT_STYLE[out]).toBeDefined();
    expect(VERDICT_HEX[out]).toBeDefined();
  });
});

describe('verdictLabel', () => {
  it('says calculating, not "sin datos"', () => {
    // There ARE data; they are not yet enough. Someone deciding whether to
    // drive to the water reads those two very differently.
    expect(verdictLabel({ verdict: 'good', provisional: true })).toBe(PROVISIONAL_LABEL);
    expect(verdictLabel({ verdict: 'good', provisional: true })).not.toBe(VERDICT_STYLE.unknown.label);
  });

  it('uses the normal label once the score settles', () => {
    expect(verdictLabel({ verdict: 'sailing' })).toBe(VERDICT_STYLE.sailing.label);
  });

  it('falls back to "sin datos" when there is genuinely nothing', () => {
    expect(verdictLabel(undefined)).toBe(VERDICT_STYLE.unknown.label);
  });
});

describe('displayWindKt', () => {
  it('shows nothing at all while provisional', () => {
    // A number here is the raw consensus before the detectors have spoken, and
    // it moves once they do. That is the figure that reached a shared image and
    // kept circulating after the app had corrected itself.
    expect(displayWindKt({ verdict: 'good', provisional: true, effectiveWindKt: 14, wind: { avgSpeedKt: 6 } })).toBeNull();
  });

  it('prefers the CALIBRATED value over the station reading', () => {
    // The sidebar badge showed "BUENO 6kt" while 'good' starts at 12, because
    // the verdict came from the boosted wind and the number from the raw one.
    expect(displayWindKt({ verdict: 'good', effectiveWindKt: 14, wind: { avgSpeedKt: 6 } })).toBe(14);
  });

  it('falls back to the station reading when no boost was applied', () => {
    expect(displayWindKt({ verdict: 'sailing', wind: { avgSpeedKt: 9 } })).toBe(9);
  });

  it('returns null rather than zero when there is no wind figure', () => {
    // Zero is a real reading — dead calm — and must not be manufactured out of
    // an absent one. That distinction has already cost this project a week of
    // a stopped anemometer voting for calm.
    expect(displayWindKt({ verdict: 'calm' })).toBeNull();
    expect(displayWindKt(undefined)).toBeNull();
  });

  it('keeps a genuine zero when the engine really measured one', () => {
    expect(displayWindKt({ verdict: 'calm', effectiveWindKt: 0 })).toBe(0);
  });
});

describe('the styles stay complete', () => {
  it('covers every verdict, so no surface can render a hole', () => {
    const all: SpotVerdict[] = ['calm', 'light', 'sailing', 'good', 'strong', 'unknown'];
    for (const v of all) {
      expect(VERDICT_STYLE[v]?.label).toBeTruthy();
      expect(VERDICT_HEX[v]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
