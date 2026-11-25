/**
 * Which spot the lightning band names. With a storm over several spots it named the first of the list: someone looking
 * at Cesantes read «RAYO A 6 KM — LOURIDO» (25-nov, on a phone, with the demo storm).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

const lightning = vi.hoisted(() => ({ risks: [] as unknown[], waits: [] as unknown[] }));
vi.mock('../../hooks/useSpotLightningRisk', () => ({
  useSpotLightningRisk: () => lightning.risks,
  useSpotLightningWait: () => lightning.waits,
}));

import { LightningProximityBanner } from './LightningProximityBanner';
import { namedFirst } from '../../services/lightningProximityService';
import { useSpotStore } from '../../store/spotStore';

const risk = (spotId: string, level: 'peligro' | 'aviso', nearestKm: number) =>
  ({ spotId, spotName: spotId, level, nearestKm, count25: 5, approaching: false });

beforeEach(() => {
  lightning.risks = [risk('lourido', 'peligro', 6), risk('cesantes', 'peligro', 6), risk('vao', 'aviso', 14)];
  lightning.waits = [];
  useSpotStore.setState({ activeSpotId: '', favoriteSpotId: null } as never);
});
afterEach(() => cleanup());

describe('namedFirst', () => {
  const list = [risk('lourido', 'peligro', 6), risk('cesantes', 'peligro', 6), risk('vao', 'aviso', 14)];
  it('keeps the worst of the list when the reader has no spot in it', () => {
    expect(namedFirst(list, '', null).spotId).toBe('lourido');
    expect(namedFirst(list, 'castrelo', 'belesar').spotId).toBe('lourido');
  });
  it('names the open spot, then the favourite, when it is as bad as the worst', () => {
    expect(namedFirst(list, 'cesantes', null).spotId).toBe('cesantes');
    expect(namedFirst(list, '', 'cesantes').spotId).toBe('cesantes');
    expect(namedFirst(list, 'cesantes', 'lourido').spotId).toBe('cesantes');
  });
  it('never puts «aviso» in my spot before «peligro» next door', () => {
    expect(namedFirst(list, 'vao', null).spotId).toBe('lourido');
  });
});

describe('the lightning band', () => {
  it('names the spot whose card is open, and still counts the others', () => {
    useSpotStore.setState({ activeSpotId: 'cesantes' } as never);
    render(<LightningProximityBanner />);
    const band = screen.getByRole('alert');
    expect(band.textContent).toContain('RAYO A 6 KM — CESANTES');
    expect(band.textContent).toContain('+2 spots');
  });

  it('with no spot of the reader in danger it names the worst', () => {
    render(<LightningProximityBanner />);
    expect(screen.getByRole('alert').textContent).toContain('RAYO A 6 KM — LOURIDO');
  });

  it('danger does not rest on its colour: it wears another sign than the lower levels', () => {
    const { unmount } = render(<LightningProximityBanner />);
    const danger = screen.getByRole('alert').querySelector('button')!;
    expect(danger.dataset.level).toBe('peligro');
    const dangerSign = danger.querySelector('svg')!.innerHTML;
    unmount();

    lightning.risks = [risk('vao', 'aviso', 14)];
    render(<LightningProximityBanner />);
    const warn = screen.getByRole('alert').querySelector('button')!;
    expect(warn.dataset.level).toBe('aviso');
    expect(warn.querySelector('svg')!.innerHTML).not.toBe(dangerSign);
    // and the words differ too: capitals and «sal del agua» only in danger
    expect(warn.textContent).toContain('Rayos a 14 km');
    expect(warn.textContent).not.toContain('sal del agua');
  });

  it('the wait after the storm names the open spot too', () => {
    lightning.risks = [];
    lightning.waits = [
      { spotId: 'lourido', spotName: 'Lourido', untilMs: Date.now() + 9 * 60_000, lastKm: 5, lastAgeMin: 21 },
      { spotId: 'cesantes', spotName: 'Cesantes', untilMs: Date.now() + 8 * 60_000, lastKm: 5, lastAgeMin: 22 },
    ];
    useSpotStore.setState({ activeSpotId: 'cesantes' } as never);
    render(<LightningProximityBanner />);
    expect(screen.getByRole('status').textContent).toMatch(/ESPERA HASTA LAS [0-9]{2}:[0-9]{2} — CESANTES/);
    // the wait says its level too, and wears the bolt, not the triangle of danger
    const band = screen.getByRole('status').querySelector('button')!;
    expect(band.dataset.level).toBe('espera');
    expect(band.querySelector('svg')).toBeTruthy();
  });
});
