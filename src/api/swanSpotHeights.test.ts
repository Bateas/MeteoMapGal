import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./swanGetFeatureInfo', () => ({ fetchSwanHsAt: vi.fn() }));
import { fetchSwanHsAt } from './swanGetFeatureInfo';
import { settledSwanHeights, swanHeightsFor, __resetSwanSpotHeightsForTests } from './swanSpotHeights';
import type { SailingSpot } from '../config/spots';

const spot = (id: string, waveBuoys?: number[]) => ({ id, center: [-8.86, 42.18], waveBuoys } as unknown as SailingSpot);

describe('swanSpotHeights', () => {
  beforeEach(() => { __resetSwanSpotHeightsForTests(); vi.mocked(fetchSwanHsAt).mockReset(); });

  it('asks only for the spots that decide on the sea', async () => {
    vi.mocked(fetchSwanHsAt).mockResolvedValue({ hs: 2.08, time: '', source: 'swan-wms' });
    const m = await settledSwanHeights([spot('cies-ria', [2248]), spot('cesantes')]);
    expect(m.get('cies-ria')).toBe(2.08);
    expect(m.has('cesantes')).toBe(false);
    expect(fetchSwanHsAt).toHaveBeenCalledTimes(1);
  });

  it('does not ask again within 30 min, and a failed answer keeps nothing', async () => {
    vi.mocked(fetchSwanHsAt).mockResolvedValue({ hs: null, time: '', source: 'swan-wms' });
    const m = await settledSwanHeights([spot('cies-ria', [2248])]);
    expect(m.size).toBe(0);
    swanHeightsFor([spot('cies-ria', [2248])]);
    expect(fetchSwanHsAt).toHaveBeenCalledTimes(1);
  });
});
