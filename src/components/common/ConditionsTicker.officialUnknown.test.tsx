/**
 * MeteoGalicia down (18-nov): the strip over the map used to stay empty, which reads as «no warnings». It says
 * that we do not know, in the place the warnings would be, and only when there is no warning to show.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const mg = vi.hoisted(() => ({ lastOk: 0 }));
vi.mock('../../api/mgWarningsClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/mgWarningsClient')>()),
  mgWarningsLastOkMs: () => mg.lastOk,
}));
vi.mock('../../hooks/useMeteoTide', () => ({ useMeteoTide: () => null }));

import { ConditionsTicker } from './ConditionsTicker';
import { useWarningsStore } from '../../hooks/useWarnings';
import { useSectorStore } from '../../store/sectorStore';
import { useSpotStore } from '../../store/spotStore';
import { useForecastStore } from '../../hooks/useForecastTimeline';
import { useLightningStore } from '../../hooks/useLightningData';
import { SECTORS } from '../../config/sectors';
import { officialWarningsKnown, OFFICIAL_MAX_SILENCE_MS } from '../../services/alerts/officialKnown';

describe('do we know the official warnings', () => {
  it('before the first poll nothing has failed; after it, an answer within the hour', () => {
    const now = Date.now();
    expect(officialWarningsKnown(null, 0, now)).toBe(true);
    expect(officialWarningsKnown(new Date(now), now - 10 * 60_000, now)).toBe(true);
    expect(officialWarningsKnown(new Date(now), now - OFFICIAL_MAX_SILENCE_MS - 1, now)).toBe(false);
    expect(officialWarningsKnown(new Date(now), 0, now)).toBe(false);
  });
});

describe('the strip over the map with MeteoGalicia down', () => {
  beforeEach(() => {
    useSectorStore.setState({ activeSectorId: 'embalse', activeSector: SECTORS.find((s) => s.id === 'embalse')! });
    useSpotStore.setState({ scores: new Map(), surfWaveCache: new Map() });
    useForecastStore.setState({ hourly: [], convectionData: [] });
    useLightningStore.setState({ strikes: [], lastFetch: null, stormAlert: { ...useLightningStore.getState().stormAlert, level: 'none' } });
    useWarningsStore.setState({ sectorWarnings: [], ipmaSectorWarnings: [] });
  });

  it('polled and never answered: says the warnings are not known, never stays empty', () => {
    mg.lastOk = 0;
    useWarningsStore.setState({ lastFetch: new Date() });
    render(<ConditionsTicker />);
    expect(screen.getByRole('status').textContent).toMatch(/Avisos oficiales sin dato.*MeteoGalicia no responde/);
  });

  it('answering: nothing to say, nothing drawn', () => {
    mg.lastOk = Date.now();
    useWarningsStore.setState({ lastFetch: new Date() });
    const { container } = render(<ConditionsTicker />);
    expect(container.innerHTML).toBe('');
  });
});
