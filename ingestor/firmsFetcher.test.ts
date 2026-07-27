/**
 * Tests for ingestor/firmsFetcher.
 *
 * The CSV parser + filter (`parseFirmsCsv`, `filterRealFires`) is already
 * exhaustively covered in `src/services/fireService.test.ts` — no need to
 * re-test it here. We test:
 *   - the integration shape (imports cleanly, graceful skip without API key)
 *   - `parseFirmsExtras`, the raw-archive companion parser, including the
 *     contract that binds its key to the shared `ActiveFire.id`
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseFirmsExtras, dedupeByPrimaryKey, type PersistedFire } from './firmsFetcher';
import { parseFirmsCsv, filterRealFires } from '../src/services/fireService';

// Area-API layout: has `instrument`, confidence as a letter.
const AREA_CSV = [
  'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight',
  '41.75732,-8.53578,308.24,0.43,0.38,2026-07-27,253,N,VIIRS,n,2.0NRT,292.74,1.2,N',
  '42.10000,-8.20000,335.50,0.52,0.47,2026-07-27,1242,N20,VIIRS,h,2.0NRT,301.10,45.6,D',
].join('\n');

// Public bulk-feed layout: NO `instrument` column, so every field after it
// shifts. A positional reader would mis-assign version/bright_ti5/frp here.
const BULK_CSV = [
  'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight',
  '41.75732,-8.53578,308.24,0.43,0.38,2026-07-27,253,N,n,2.0NRT,292.74,1.2,N',
].join('\n');

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

describe('parseFirmsExtras', () => {
  it('extracts the raw context columns from the Area-API layout', () => {
    const extras = parseFirmsExtras(AREA_CSV);
    expect(extras.size).toBe(2);

    const first = extras.get('41.75732_-8.53578_2026-07-27_0253_N');
    expect(first).toEqual({
      scan: 0.43,
      track: 0.38,
      brightTi5: 292.74,
      version: '2.0NRT',
      instrument: 'VIIRS',
      confidenceRaw: 'n',
    });
  });

  it('pads acq_time so the key matches the shared id format', () => {
    // "253" in the CSV is 02:53 UTC — FIRMS strips leading zeros.
    const extras = parseFirmsExtras(AREA_CSV);
    expect(extras.has('41.75732_-8.53578_2026-07-27_0253_N')).toBe(true);
    expect(extras.has('41.75732_-8.53578_2026-07-27_253_N')).toBe(false);
  });

  it('reads by header name, so a missing instrument column does not shift fields', () => {
    const extras = parseFirmsExtras(BULK_CSV);
    const row = extras.get('41.75732_-8.53578_2026-07-27_0253_N');
    expect(row?.instrument).toBeNull();
    // These would be garbage under a positional read of the shorter layout.
    expect(row?.version).toBe('2.0NRT');
    expect(row?.brightTi5).toBe(292.74);
    expect(row?.confidenceRaw).toBe('n');
  });

  it('keys every row exactly as `${ActiveFire.id}_${satellite}`', () => {
    // This is the contract the fetcher relies on to join extras onto parsed
    // fires. If the shared id format ever changes, this fails loudly instead
    // of silently persisting NULL context columns forever.
    const fires = parseFirmsCsv(AREA_CSV);
    const extras = parseFirmsExtras(AREA_CSV);
    expect(fires.length).toBe(2);
    for (const f of fires) {
      expect(extras.has(`${f.id}_${f.satellite}`)).toBe(true);
    }
  });

  it('distinguishes the two satellites seeing the same pixel', () => {
    const csv = [
      'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight',
      '42.00000,-8.00000,330.00,0.40,0.36,2026-07-27,1200,N,VIIRS,n,2.0NRT,300.00,10.0,D',
      '42.00000,-8.00000,340.00,0.41,0.37,2026-07-27,1200,N20,VIIRS,h,2.0NRT,305.00,20.0,D',
    ].join('\n');
    const extras = parseFirmsExtras(csv);
    expect(extras.size).toBe(2);
    expect(extras.get('42.00000_-8.00000_2026-07-27_1200_N')?.brightTi5).toBe(300);
    expect(extras.get('42.00000_-8.00000_2026-07-27_1200_N20')?.brightTi5).toBe(305);
  });

  it('returns an empty map for empty, header-only or malformed input', () => {
    expect(parseFirmsExtras('').size).toBe(0);
    expect(parseFirmsExtras('latitude,longitude,acq_date,acq_time,satellite').size).toBe(0);
    // Identity columns missing entirely -> nothing to join on
    expect(parseFirmsExtras('foo,bar\n1,2').size).toBe(0);
  });

  it('yields nulls instead of NaN when optional columns are absent or blank', () => {
    const csv = [
      'latitude,longitude,acq_date,acq_time,satellite,scan,version',
      '42.50000,-8.10000,2026-07-27,930,N,,',
    ].join('\n');
    const row = parseFirmsExtras(csv).get('42.50000_-8.10000_2026-07-27_0930_N');
    expect(row).toEqual({
      scan: null,
      track: null,
      brightTi5: null,
      version: null,
      instrument: null,
      confidenceRaw: null,
    });
  });

  it('skips rows with unparseable coordinates', () => {
    const csv = [
      'latitude,longitude,acq_date,acq_time,satellite,scan',
      'n/a,-8.10000,2026-07-27,930,N,0.4',
      '42.50000,-8.10000,2026-07-27,930,N,0.4',
    ].join('\n');
    expect(parseFirmsExtras(csv).size).toBe(1);
  });
});

describe('passes_display_filter join contract', () => {
  it('filterRealFires returns the SAME objects it was given', () => {
    // runFirmsCycle flags each archived detection with
    // `new Set(filterRealFires(all)).has(f)` — object identity, so the flag can
    // never drift from the shared filter's logic. That only holds while
    // filterRealFires narrows the array (.filter) instead of rebuilding it
    // (.map / spread). If someone refactors it to return copies, every row
    // would be archived as passes_display_filter=false and nobody would
    // notice: the writes still succeed. This test is that alarm.
    const fires = parseFirmsCsv(AREA_CSV);
    const kept = filterRealFires(fires);
    expect(kept.length).toBeGreaterThan(0);
    for (const f of kept) {
      expect(fires.some((original) => original === f)).toBe(true);
    }
  });
});

describe('dedupeByPrimaryKey', () => {
  const base = (over: Partial<PersistedFire> = {}): PersistedFire => ({
    time: new Date('2026-07-27T02:53:00Z'),
    lat: 41.75732,
    lon: -8.53578,
    satellite: 'N',
    brightness: 308.24,
    frp: 1.2,
    confidence: 'nominal',
    daynight: 'N',
    scan: 0.43,
    track: 0.38,
    brightTi5: 292.74,
    version: '2.0NRT',
    instrument: 'VIIRS',
    confidenceRaw: 'n',
    passesDisplayFilter: false,
    ...over,
  });

  it('collapses rows sharing the primary key, keeping the first', () => {
    const out = dedupeByPrimaryKey([base({ frp: 1.2 }), base({ frp: 99 })]);
    expect(out).toHaveLength(1);
    expect(out[0].frp).toBe(1.2);
  });

  it('keeps the same pixel seen by two satellites', () => {
    const out = dedupeByPrimaryKey([base(), base({ satellite: 'N20' })]);
    expect(out).toHaveLength(2);
  });

  it('keeps the same pixel at different acquisition times', () => {
    const out = dedupeByPrimaryKey([
      base(),
      base({ time: new Date('2026-07-27T12:42:00Z') }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('handles an empty batch', () => {
    expect(dedupeByPrimaryKey([])).toEqual([]);
  });
});
