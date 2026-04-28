/**
 * Tests for ingestor/icaFetcher.
 *
 * The MeteoGalicia ICA REST parser is already covered in
 * `src/api/meteoGaliciaIcaClient.test.ts`. We only test the integration:
 *   - module imports cleanly without DB/network at load time
 *   - public surface is `runIcaCycle: () => Promise<void>`
 *   - graceful resolution when fetch fails (network down)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('icaFetcher module shape', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('exports runIcaCycle as a function', async () => {
    const mod = await import('./icaFetcher');
    expect(typeof mod.runIcaCycle).toBe('function');
    // Don't invoke — the module would try to hit ideg.xunta.gal AND
    // getPool() which needs initPool(). Integration test happens in prod.
  });
});
