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

describe('icaEpisodeStep — a cut of the source is said once', () => {
  it('first bad poll is a WARN with the reason, the next ones DEBUG, the return an INFO', async () => {
    const { icaEpisodeStep } = await import('./icaFetcher');
    const t0 = Date.parse('2026-10-21T09:00:00Z');
    let ep = { failingSince: null as number | null, failures: 0 };

    let step = icaEpisodeStep(ep, { kind: 'error', reason: 'HTTP 503' }, t0);
    expect(step.line?.level).toBe('warn');
    expect(step.line?.msg).toContain('HTTP 503');
    ep = step.next;

    step = icaEpisodeStep(ep, { kind: 'empty' }, t0 + 30 * 60_000);
    expect(step.line?.level).toBe('debug');
    ep = step.next;
    expect(ep.failures).toBe(2);

    step = icaEpisodeStep(ep, { kind: 'ok', count: 46 }, t0 + 60 * 60_000);
    expect(step.line).toEqual({ level: 'info', msg: expect.stringContaining('2 bad poll(s) (60 min)') });
    expect(step.next).toEqual({ failingSince: null, failures: 0 });
  });

  it('an empty answer opens an episode too: 0 observations is not «ok»', async () => {
    const { icaEpisodeStep } = await import('./icaFetcher');
    const step = icaEpisodeStep({ failingSince: null, failures: 0 }, { kind: 'empty' }, 0);
    expect(step.line?.level).toBe('warn');
    expect(step.line?.msg).toContain('0 observations');
  });

  it('good polls in a row say nothing extra', async () => {
    const { icaEpisodeStep } = await import('./icaFetcher');
    const ep = { failingSince: null, failures: 0 };
    expect(icaEpisodeStep(ep, { kind: 'ok', count: 46 }, 0)).toEqual({ next: ep, line: null });
  });
});
