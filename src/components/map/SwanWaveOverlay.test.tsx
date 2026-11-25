import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

vi.mock('react-map-gl/maplibre', () => ({
  Source: ({ id, children }: { id: string; children?: React.ReactNode }) => <div data-source={id}>{children}</div>,
  Layer: () => null,
  useMap: () => ({ current: null }),
}));

const fetchMarineData = vi.fn();
vi.mock('../../api/marineClient', () => ({ fetchMarineData: (...a: unknown[]) => fetchMarineData(...a) }));

import { SwanWaveOverlay } from './SwanWaveOverlay';
import { useSectorStore } from '../../store/sectorStore';
import { useMapStyleStore } from '../../store/mapStyleStore';
import { useUIStore } from '../../store/uiStore';

const sourceIds = (c: HTMLElement) => [...c.querySelectorAll('[data-source]')].map((e) => e.getAttribute('data-source'));

describe('SwanWaveOverlay: three states of its server', () => {
  let answer: (r: { ok: boolean }) => void;
  let fail: (e: Error) => void;

  beforeEach(() => {
    useSectorStore.getState().switchSector('rias');
    useMapStyleStore.setState({ showSwan: true });
    useUIStore.setState({ isMobile: false });
    fetchMarineData.mockReset().mockResolvedValue({ waveHeight: 1.2 });
    vi.stubGlobal('fetch', vi.fn(() => new Promise((res, rej) => { answer = res; fail = rej; })));
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('says nothing and asks nobody else while the check is on its way', () => {
    const { container } = render(<SwanWaveOverlay />);
    expect(screen.queryByText(/sin servicio/)).toBeNull();
    expect(screen.queryByText('Oleaje (modelo)')).toBeNull();
    expect(fetchMarineData).not.toHaveBeenCalled();
    expect(sourceIds(container)).toEqual([]);
  });

  it('server up: tiles and the panel, never the fallback', async () => {
    const { container } = render(<SwanWaveOverlay />);
    await act(async () => { answer({ ok: true }); });
    expect(screen.getByText('Oleaje (modelo)')).toBeInTheDocument();
    expect(sourceIds(container)).toEqual(['swan-wave']);
    expect(fetchMarineData).not.toHaveBeenCalled();
    expect(screen.queryByText(/sin servicio/)).toBeNull();
  });

  it('server down: notice and points from the other model', async () => {
    const { container } = render(<SwanWaveOverlay />);
    await act(async () => { answer({ ok: false }); });
    expect(screen.getByText('Oleaje (modelo) sin servicio')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/en 6 puntos/)).toBeInTheDocument());
    expect(fetchMarineData).toHaveBeenCalledTimes(6);
    expect(sourceIds(container)).toEqual(['swan-fallback']);
  });

  it('a failed check counts as down', async () => {
    render(<SwanWaveOverlay />);
    await act(async () => { fail(new Error('timeout')); });
    expect(screen.getByText('Oleaje (modelo) sin servicio')).toBeInTheDocument();
  });

  it('says so on a phone too, which used to show dots with no explanation', async () => {
    useUIStore.setState({ isMobile: true });
    render(<SwanWaveOverlay />);
    await act(async () => { answer({ ok: false }); });
    expect(screen.getByText('Oleaje (modelo) sin servicio')).toBeInTheDocument();
  });

  it('never names the model or says forecast on screen', async () => {
    const { container } = render(<SwanWaveOverlay />);
    await act(async () => { answer({ ok: true }); });
    expect(container.textContent).not.toMatch(/SWAN|forecast/i);
    for (const el of container.querySelectorAll('[aria-label]')) {
      expect(el.getAttribute('aria-label')).not.toMatch(/SWAN|forecast/i);
    }
  });
});
