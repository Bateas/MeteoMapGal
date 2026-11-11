/**
 * Official warnings belong to a sector. Seen 11-nov: after a change from Rías to Interior the strip
 * kept «Pontevedra (provincia), Suroeste de A Coruña» over Ourense until the next poll (15 min),
 * because the lists were picked once, when the download landed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import type { MGWarning } from '../api/mgWarningsClient';
import type { IpmaWarning } from '../api/ipmaWarningsClient';

const mg = vi.hoisted(() => ({ pending: [] as Array<(w: unknown[]) => void> }));
vi.mock('../api/mgWarningsClient', async (orig) => ({
  ...(await orig<typeof import('../api/mgWarningsClient')>()),
  fetchMGWarnings: () => new Promise((resolve) => { mg.pending.push(resolve as (w: unknown[]) => void); }),
}));
vi.mock('../api/ipmaWarningsClient', async (orig) => ({
  ...(await orig<typeof import('../api/ipmaWarningsClient')>()),
  fetchIpmaWarnings: () => Promise.resolve([]),
}));

import { useWarnings, useWarningsStore } from './useWarnings';
import { useSectorStore } from '../store/sectorStore';
import { useAlertStore } from '../store/alertStore';
import { SECTORS } from '../config/sectors';

const soon = () => new Date(Date.now() + 6 * 3_600_000);
function warning(id: string, zone: string): MGWarning {
  return {
    id, type: 'Chuvia', typeId: 1, maxLevel: 1, publishedAt: new Date(), link: '',
    zones: [{ name: zone, id: 1, level: 1, startTime: new Date(), endTime: soon(), comment: '' }],
  } as unknown as MGWarning;
}
const COAST = warning('coast', 'Pontevedra (provincia)');
const INLAND = warning('inland', 'Sur de Ourense');
const sector = (id: string) => SECTORS.find((s) => s.id === id)!;
const go = (id: string) => act(() => { useSectorStore.setState({ activeSectorId: id, activeSector: sector(id) }); });
const zonesShown = () => useWarningsStore.getState().sectorWarnings.flatMap((w) => w.zones.map((z) => z.name));

function Host() { useWarnings(); return null; }

describe('official warnings follow the sector on screen', () => {
  beforeEach(() => {
    mg.pending.length = 0;
    useSectorStore.setState({ activeSectorId: 'rias', activeSector: sector('rias') });
    useWarningsStore.setState({ allWarnings: [], sectorWarnings: [], ipmaSectorWarnings: [], allIpmaWarnings: [], sectorId: null });
  });

  it('a change of sector picks its own warnings at once, from what is already downloaded', async () => {
    render(<Host />);
    await act(async () => { mg.pending.shift()?.([COAST, INLAND]); await Promise.resolve(); await Promise.resolve(); });
    expect(zonesShown()).toEqual(['Pontevedra (provincia)']);

    go('embalse');
    // No new download has landed: the list is already the one of the inland sector
    expect(zonesShown()).toEqual(['Sur de Ourense']);
    expect(useWarningsStore.getState().sectorId).toBe('embalse');

    go('rias');
    expect(zonesShown()).toEqual(['Pontevedra (provincia)']);
  });

  it('a download that lands after the change is read for the sector on screen, not for the one that asked', async () => {
    render(<Host />);
    go('embalse'); // the request went out in Rías and is still in the air
    await act(async () => { mg.pending.shift()?.([COAST, INLAND]); await Promise.resolve(); await Promise.resolve(); });
    expect(zonesShown()).toEqual(['Sur de Ourense']);
  });

  it('the IPMA list follows too', () => {
    const vct = { districtCode: 'VCT' } as unknown as IpmaWarning;
    const vrl = { districtCode: 'VRL' } as unknown as IpmaWarning;
    useWarningsStore.getState().setDownloaded([], [vct, vrl], 'embalse');
    expect(useWarningsStore.getState().ipmaSectorWarnings).toHaveLength(2);
    useWarningsStore.getState().pickSector('rias');
    expect(useWarningsStore.getState().ipmaSectorWarnings).toEqual([vct]);
  });
});

describe('the alert list does not outlive its sector', () => {
  it('empties inside the change of sector', async () => {
    const { useUnifiedAlertPipeline } = await import('./useUnifiedAlertPipeline');
    function Pipe() {
      useUnifiedAlertPipeline({ stations: [], forecastHourly: [], teleconnectionsRef: { current: [] } } as never);
      return null;
    }
    useSectorStore.setState({ activeSectorId: 'rias', activeSector: sector('rias') });
    render(<Pipe />);
    act(() => {
      useAlertStore.getState().setAlerts(
        [{ id: 'fog-rias', category: 'fog', severity: 'high', title: 'Niebla en la ría' } as never],
        { score: 60, severity: 'high', color: 'orange', activeCount: 1 } as never,
      );
    });
    go('embalse');
    expect(useAlertStore.getState().alerts).toEqual([]);
    expect(useAlertStore.getState().risk.activeCount).toBe(0);
  });
});
