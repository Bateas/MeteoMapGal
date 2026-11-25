/**
 * The spot card keeps the place of its wind chart while the forecast is on its way, and marks it as the end of the
 * first look (`data-peek-end`), so the sheet of a phone opens at its final height instead of growing a second later.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

const { pending, forecast } = vi.hoisted(() => ({
  pending: () => new Promise<never>(() => {}),
  forecast: { reject: null as null | ((e: Error) => void) },
}));

vi.mock('../../services/spotForecastFetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/spotForecastFetch')>()),
  fetchSpotForecast: vi.fn(() => new Promise((_, reject) => { forecast.reject = reject; })),
}));
vi.mock('../../api/marineClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/marineClient')>()),
  fetchMarineForecast: vi.fn(pending),
  fetchMarineData: vi.fn(pending),
}));
vi.mock('../../api/meteoSixClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/meteoSixClient')>()),
  fetchMeteoSixSeaTemp: vi.fn(pending),
}));
vi.mock('../../api/swanGetFeatureInfo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/swanGetFeatureInfo')>()),
  fetchSwanHsAt: vi.fn(pending),
}));
vi.mock('../../api/tideClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/tideClient')>()),
  fetchTidePredictions: vi.fn(pending),
  fetchTides48h: vi.fn(pending),
}));

import { SpotPopup } from './SpotPopup';
import { ALL_SPOTS } from '../../config/spots';
import { useSpotStore } from '../../store/spotStore';
import type { SpotScore } from '../../services/spotScoringEngine';

const spot = ALL_SPOTS.find((s) => s.id === 'castrelo')!;
const surf = ALL_SPOTS.find((s) => s.category === 'surf')!;

function score(spotId: string, over: Partial<SpotScore> = {}): SpotScore {
  return {
    spotId, spotName: spotId, verdict: 'light', score: 30, summary: '',
    wind: { stationCount: 3, avgSpeedKt: 7, rawAvgSpeedKt: 7, dominantDir: 'SW', dirDeg: 225 },
    waves: null, effectiveWindKt: 7, gustKt: 9, windDirDeg: 225, provisional: false, hardGateTriggered: null, thermal: null,
    computedAt: new Date(), ...over,
  } as unknown as SpotScore;
}

const place = () => document.querySelector('.gf-plotwait');

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(pending));
  forecast.reject = null;
  useSpotStore.setState({ spotForecasts: new Map(), scores: new Map() } as never);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('the place of the wind chart in the spot card', () => {
  it('is kept while the forecast is being asked for, and marks where the first look ends', () => {
    render(<SpotPopup spot={spot} score={score(spot.id)} />);
    expect(place()).not.toBeNull();
    expect(place()!.hasAttribute('data-peek-end')).toBe(true);
    expect(place()!.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelectorAll('[data-peek-end]')).toHaveLength(1);
  });

  it('is kept while the figure is still «calculando»', () => {
    render(<SpotPopup spot={spot} score={score(spot.id, { provisional: true })} />);
    expect(place()).not.toBeNull();
  });

  it('goes when the forecast fails: no empty box left behind', async () => {
    render(<SpotPopup spot={spot} score={score(spot.id)} />);
    expect(place()).not.toBeNull();
    await act(async () => { forecast.reject!(new Error('sin respuesta')); await Promise.resolve(); });
    expect(place()).toBeNull();
  });

  it('a surf beach keeps no place for it: its own chart ends the first look', () => {
    render(<SpotPopup spot={surf} score={score(surf.id)} />);
    expect(place()).toBeNull();
  });
});
