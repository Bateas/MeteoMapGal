import { describe, it, expect } from 'vitest';
import { lightningUnknownAt, LIGHTNING_MAX_SILENCE_MS } from './useConditionsList';

describe('lightning «sin dato» (review, 18-nov)', () => {
  const now = Date.UTC(2026, 10, 18, 16, 0);
  it('a server that answered once and then went down becomes unknown after a quarter of an hour', () => {
    const lastOk = new Date(now - LIGHTNING_MAX_SILENCE_MS - 60_000);
    expect(lightningUnknownAt(lastOk, 'Sin respuesta del servidor de rayos', now)).toBe(true);
  });
  it('a short failure after a good answer is not unknown yet', () => {
    expect(lightningUnknownAt(new Date(now - 5 * 60_000), 'Sin respuesta', now)).toBe(false);
  });
  it('never answered and failing is unknown; answering is known', () => {
    expect(lightningUnknownAt(null, 'Sin datos', now)).toBe(true);
    expect(lightningUnknownAt(new Date(now - 3 * 3_600_000), null, now)).toBe(false);
  });
});
