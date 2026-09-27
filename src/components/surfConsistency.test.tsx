/**
 * One beach, one answer — on every surface.
 *
 * Before this, a surf spot's verdict was computed four ways: the marker from a
 * copy without wind, the popup from its own download at another hour, the
 * spot list from the WIND verdict next to a tide gauge's «Olas 0.0m», and the
 * ticker from whatever the last writer left. On 27-Sep none of the three
 * beaches said the same thing on the marker and in its own card.
 *
 * Here the store holds ONE cache entry, built by the same function the hook
 * uses, and the surfaces are rendered from it: marker, list row and header,
 * ticker (simple mode), the popup and the mobile pill. They must print the
 * same label and the same height, say the height is a model value, none may
 * state a firm verdict while the spot's wind is still pending, and over the
 * engine's hard gate all of them must read the engine's danger verdict — never
 * a surf verdict that ignores wind speed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, within } from '@testing-library/react';

// Markers: render their children so the badge can be read (the shared setup
// stubs Marker as `() => null`).
vi.mock('react-map-gl/maplibre', () => ({
  Marker: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Popup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  useMap: () => ({ current: null }),
}));

// Every network source the popup and the ticker touch on mount. A promise that
// never settles keeps the test offline and leaves no update after unmount.
const { pending } = vi.hoisted(() => ({ pending: () => new Promise<never>(() => {}) }));
vi.mock('../services/spotForecastFetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/spotForecastFetch')>()),
  fetchSpotForecast: vi.fn(pending),
  isSpotForecastStale: vi.fn(() => false),
}));
vi.mock('../api/marineClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/marineClient')>()),
  fetchMarineForecast: vi.fn(pending),
  fetchMarineData: vi.fn(pending),
}));
vi.mock('../api/meteoSixClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/meteoSixClient')>()),
  fetchMeteoSixSeaTemp: vi.fn(pending),
  fetchMeteoSixMarine: vi.fn(pending),
}));
vi.mock('../api/swanGetFeatureInfo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/swanGetFeatureInfo')>()),
  fetchSwanHsAt: vi.fn(pending),
}));
vi.mock('../api/tideClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/tideClient')>()),
  fetchTidePredictions: vi.fn(pending),
  fetchTides48h: vi.fn(pending),
}));

import { SpotMarkers } from './map/SpotMarker';
import { SpotSelector } from './dashboard/SpotSelector';
import { ConditionsTicker } from './common/ConditionsTicker';
import { SpotPopup } from './map/SpotPopup';
import { MobileSailingBanner } from './dashboard/MobileSailingBanner';
import { ALL_SPOTS } from '../config/spots';
import { SECTORS } from '../config/sectors';
import { useSpotStore } from '../store/spotStore';
import { useSectorStore } from '../store/sectorStore';
import { useUIStore } from '../store/uiStore';
import { useWeatherStore } from '../store/weatherStore';
import { useBuoyStore } from '../store/buoyStore';
import { useWarningsStore } from '../hooks/useWarnings';
import { buildSurfEntry, formatSurfWave } from '../services/surfVerdictEngine';
import type { MarineForecastHour } from '../api/marineClient';
import type { SpotScore } from '../services/spotScoringEngine';

const CORRUBEDO = ALL_SPOTS.find((s) => s.id === 'surf-corrubedo')!;
const HOUR = 3_600_000;
/** Every surf label, and every summary the surf engine can write. */
const SURF_LABELS = /SURF OK|PEQUE|FLAT|CLÁSICO|GRANDE/;
const SURF_SUMMARIES = /Olas surfeables|Olas pequeñas|Mar plano|Sin olas surfeables|Día clásico|Mar grande/;

/** 1.3 m of NW swell, 9 s: 1.3 × 0.88 × 1.0 = 1.14 m at Corrubedo → SURF OK. */
function hours(): MarineForecastHour[] {
  const start = Math.floor(Date.now() / HOUR) * HOUR - HOUR;
  return Array.from({ length: 30 }, (_, i) => ({
    time: new Date(start + i * HOUR),
    waveHeight: 1.3, wavePeriod: 9, waveDirection: 315,
    swellHeight: 1.3, swellPeriod: 9, swellDirection: 315,
  }));
}

interface ScoreOpts {
  /** null = the engine found no wind consensus (every reading under 1 kt, or no source) */
  dirDeg: number | null;
  kt?: number;
  hardGate?: string | null;
}

/** A real-shaped score whose "waves" come from a tide gauge — what the sailing
 *  engine attached to surf spots, and what the list used to print. */
function score(spotId: string, { dirDeg, kt = 4, hardGate = null }: ScoreOpts): SpotScore {
  return {
    spotId, spotName: spotId,
    verdict: hardGate ? 'strong' : 'calm',
    score: hardGate ? 0 : 10,
    summary: hardGate ? `Viento excesivo (${kt}kt). Peligroso.` : 'Calma — viento flojo',
    wind: dirDeg == null ? null : { stationCount: 2, avgSpeedKt: kt, rawAvgSpeedKt: kt, dominantDir: 'NW', dirDeg, dirSteadiness: 0.9, matchedPattern: null, contributions: [] },
    waves: { waveHeight: 0.01, wavePeriod: null, waveDir: null, sourceBuoy: 'Vilagarcía (marea)' },
    waterTemp: 17, airTemp: 19, humidity: 70, windChill: null, heatIndex: null, windDirDeg: dirDeg,
    hardGateTriggered: hardGate, thermal: null, hasStormAlert: false, thermalBoosted: false,
    effectiveWindKt: dirDeg == null ? null : kt, scoringConfidence: 'medium', provisional: false, windTrend: null, gustKt: null,
    dewPoint: null, humiditySignal: null, thetaVGradient: null, computedAt: new Date(),
  } as SpotScore;
}

/**
 * Seed the store as the hook would. `score: null` = no score yet (cold load);
 * `readingsArriving` = the sector's reading set is still partial, the case in
 * which a missing wind consensus means «not landed yet».
 */
function seed(opts: ScoreOpts | null, readingsArriving = false) {
  const sc = opts ? score('surf-corrubedo', opts) : undefined;
  const entry = buildSurfEntry(CORRUBEDO, hours(), sc, Date.now(), Date.now(), readingsArriving);
  useSpotStore.setState({
    scores: sc ? new Map([['surf-corrubedo', sc]]) : new Map(),
    lastScored: Date.now(),
    surfWaveCache: new Map([['surf-corrubedo', entry]]),
  });
  useSpotStore.getState().selectSpot('surf-corrubedo');
  return entry;
}

/** Render every surface from the store and return their text. */
function renderSurfaces() {
  const marker = render(<SpotMarkers />);
  const markerText = marker.container.textContent ?? '';

  const list = render(<SpotSelector />);
  // Expand: the header is the button that carries the Beta badge.
  const header = list.container.querySelector('button');
  fireEvent.click(header!);
  const row = within(list.container).getAllByRole('button')
    .find((b) => b !== header && /Corrubedo/.test(b.textContent ?? ''));
  const headerText = header!.textContent ?? '';
  const rowText = row?.textContent ?? '';

  const ticker = render(<ConditionsTicker simple />);
  const tickerText = ticker.container.textContent ?? '';

  useUIStore.setState({ isMobile: true });
  const popup = render(<SpotPopup spot={CORRUBEDO} />);
  const popupText = popup.container.textContent ?? '';

  const pill = render(<MobileSailingBanner />);
  const pillText = pill.container.textContent ?? '';

  return { markerText, headerText, rowText, tickerText, popupText, pillText };
}

beforeEach(() => {
  // Daytime: the ticker only promotes surf to simple mode by day. 12:00Z is
  // daytime in UTC (CI) and in CEST (dev machine). Only Date is faked.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-27T12:00:00Z'));
  vi.stubGlobal('fetch', vi.fn(pending));
  useSectorStore.setState({ activeSectorId: 'rias', activeSector: SECTORS.find((s) => s.id === 'rias')! });
  useWeatherStore.setState({ stations: [], currentReadings: new Map() });
  useBuoyStore.setState({ buoys: [] });
  useWarningsStore.setState({ sectorWarnings: [] });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.useRealTimers();
  useUIStore.setState({ isMobile: false });
  useSpotStore.setState({ scores: new Map(), surfWaveCache: new Map(), lastScored: 0 });
  useSpotStore.getState().selectSpot('');
});

describe('surf verdict: one answer on marker, list, ticker, popup and pill', () => {
  it('neutral wind: all of them say SURF OK and the same model height', () => {
    const entry = seed({ dirDeg: 60 }); // NE: neither offshore (SE/S) nor onshore (NW) at Corrubedo
    expect(entry.verdict?.label).toBe('SURF OK');
    const h = formatSurfWave(entry.waveHeight!); // «~1,1 m»
    const s = renderSurfaces();

    expect(s.markerText).toContain(`SURF OK ${h}`);
    expect(s.rowText).toContain('SURF OK');
    expect(s.rowText).toContain(`${h} (modelo)`);
    expect(s.headerText).toContain(`SURF OK ${h} (modelo)`);
    expect(s.headerText).toContain(entry.verdict!.summary);
    expect(s.tickerText).toContain(`Corrubedo: SURF OK ${h} (modelo)`);
    expect(s.popupText).toContain('SURF OK');
    expect(s.popupText).toContain(`${h} (modelo)`);
    expect(s.pillText).toContain(`SURF OK·${h}`); // compact: «~» on screen, «modelo» in its aria-label

    // The wind verdict, the tide gauge and the sailing window are gone.
    expect(s.rowText).not.toMatch(/Olas 0\.0m/);
    for (const t of [s.rowText, s.headerText, s.pillText]) expect(t).not.toMatch(/Calma/);
  });

  it('onshore wind from the consensus: all of them drop to PEQUE together', () => {
    const entry = seed({ dirDeg: 315 }); // NW straight onto a NW beach
    expect(entry.verdict?.label).toBe('PEQUE');
    const h = formatSurfWave(entry.waveHeight!);
    const s = renderSurfaces();

    expect(s.markerText).toContain(`PEQUE ${h}`);
    expect(s.rowText).toContain('PEQUE');
    expect(s.rowText).toContain(`${h} (modelo)`);
    expect(s.tickerText).not.toContain('Corrubedo:'); // simple mode: only SURF OK and up
    expect(s.popupText).toContain('PEQUE');
    expect(s.popupText).toMatch(/onshore/);
    expect(s.pillText).toContain('PEQUE');
    for (const t of [s.markerText, s.rowText, s.popupText, s.pillText]) expect(t).not.toContain('SURF OK');
  });

  it('no wind consensus yet while the readings arrive: none of them states a verdict, the header included', () => {
    const entry = seed({ dirDeg: null }, true);
    expect(entry.windPending).toBe(true);
    const s = renderSurfaces();

    for (const t of [s.markerText, s.rowText, s.headerText, s.tickerText, s.popupText, s.pillText]) {
      expect(t).not.toMatch(SURF_LABELS);
      expect(t).not.toMatch(SURF_SUMMARIES);
    }
    expect(s.rowText).toContain('Calculando');
    expect(s.headerText).toContain('Esperando el viento de las estaciones');
    // The waves are in; what the card waits for is the wind.
    expect(s.popupText).toContain('esperando el viento de las estaciones');
    expect(s.pillText).toContain('Calculando');
  });

  it('no score at all (cold load): «Calculando» everywhere, no verdict', () => {
    seed(null);
    const s = renderSurfaces();
    for (const t of [s.markerText, s.rowText, s.headerText, s.tickerText, s.popupText, s.pillText]) {
      expect(t).not.toMatch(SURF_LABELS);
      expect(t).not.toMatch(SURF_SUMMARIES);
    }
    expect(s.rowText).toContain('Calculando');
  });

  it('no wind consensus once the readings are in (calm): the verdict is final, without wind', () => {
    const entry = seed({ dirDeg: null }, false);
    expect(entry.windPending).toBe(false);
    expect(entry.verdict?.label).toBe('SURF OK');
    const s = renderSurfaces();
    expect(s.markerText).toContain('SURF OK');
    expect(s.rowText).toContain('SURF OK');
    // (the spot description itself says «viento SE (offshore)»: match the verdict wording only)
    expect(s.popupText).not.toMatch(/viento o(n|ff)shore/);
  });

  it('sharing a surf card: no wind image card, and the text says the surf verdict and model height', async () => {
    const entry = seed({ dirDeg: 60 });
    const share = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, share });
    useUIStore.setState({ isMobile: true });
    const popup = render(<SpotPopup spot={CORRUBEDO} />);
    expect(popup.container.querySelector('[aria-label="Compartir como imagen"]')).toBeNull();
    fireEvent.click(within(popup.container).getByTitle('Compartir condiciones'));
    await vi.waitFor(() => expect(share).toHaveBeenCalled());
    const text = (share.mock.calls[0] as unknown as [{ text: string }])[0].text;
    expect(text).toContain(`Corrubedo (Surf): SURF OK`);
    expect(text).toContain(`olas ${formatSurfWave(entry.waveHeight!)} (modelo)`);
    expect(text).not.toMatch(/CALMA|olas 0\.0m/);
  });

  it('over the engine hard gate every surface reads the danger verdict, never SURF OK', () => {
    // 30 kt NW over Corrubedo (limit 25). The waves alone would say SURF OK or
    // more; the engine says «Peligroso».
    seed({ dirDeg: 315, kt: 30, hardGate: 'Viento 30kt > 25kt' });
    const s = renderSurfaces();

    expect(s.markerText).toContain('FUERTE 30kt');
    expect(s.rowText).toContain('Fuerte 30kt');
    expect(s.rowText).toContain('Viento 30kt > 25kt');
    expect(s.headerText).toContain('Fuerte 30kt');
    expect(s.headerText).toContain('Peligroso');
    expect(s.popupText).toContain('FUERTE');
    expect(s.popupText).toContain('Peligroso');
    expect(s.pillText).toContain('Fuerte');
    // Simple mode never promotes a gated beach.
    expect(s.tickerText).not.toContain('Corrubedo:');
    for (const t of [s.markerText, s.rowText, s.headerText, s.popupText, s.pillText]) {
      expect(t).not.toMatch(SURF_LABELS);
    }
  });
});
