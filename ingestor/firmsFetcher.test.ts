/**
 * Tests for ingestor/firmsFetcher.
 *
 * The CSV parser + filter (`parseFirmsCsv`, `filterRealFires`) is already
 * exhaustively covered in `src/services/fireService.test.ts` — no need to
 * re-test it here. We only test the integration shape:
 *   - the module imports cleanly without DB/network access at module load
 *   - the public surface is `runFirmsCycle: () => Promise<void>`
 *   - missing FIRMS_API_KEY produces a graceful skip (no exception)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('firmsFetcher module shape', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('exports runFirmsCycle as a function returning a Promise', async () => {
    delete process.env.FIRMS_API_KEY;
    const mod = await import('./firmsFetcher');
    expect(typeof mod.runFirmsCycle).toBe('function');
    const r = mod.runFirmsCycle();
    expect(r).toBeInstanceOf(Promise);
    await r; // should resolve, not reject
  });

  it('runs gracefully when FIRMS_API_KEY is missing (skips, no throw)', async () => {
    delete process.env.FIRMS_API_KEY;
    const mod = await import('./firmsFetcher');
    // Should resolve without error — fetcher logs a warn and returns
    await expect(mod.runFirmsCycle()).resolves.toBeUndefined();
  });
});
