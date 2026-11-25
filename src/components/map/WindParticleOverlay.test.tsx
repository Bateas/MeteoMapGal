import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { WindParticleOverlay } from './WindParticleOverlay';
import { WIND_LEGEND_STOPS } from './WeatherLayerSelector';
import { useWeatherLayerStore } from '../../store/weatherLayerStore';
import { useWeatherStore } from '../../store/weatherStore';
import { useBuoyStore } from '../../store/buoyStore';
import { msToKnots, windSpeedColor } from '../../services/windUtils';
import type { NormalizedStation, NormalizedReading } from '../../types/station';

vi.mock('../../api/stationExposureClient', () => ({ fetchStationExposure: () => Promise.resolve(new Map()) }));

const fakeCtx = () => ({
  clearRect: vi.fn(), fillRect: vi.fn(), drawImage: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
});

const map = {
  getBounds: () => ({ getWest: () => -9, getEast: () => -8, getSouth: () => 42, getNorth: () => 43 }),
  project: ([lon, lat]: [number, number]) => ({ x: (lon + 9) * 800, y: (43 - lat) * 800 }),
  getZoom: () => 10,
  on: vi.fn(),
  off: vi.fn(),
};
const mapRef = { current: { getMap: () => map } } as never;

const station: NormalizedStation = { id: 'mg_1', name: 'Uno', source: 'meteogalicia', lat: 42.5, lon: -8.5, altitude: 10 };
const reading: NormalizedReading = {
  stationId: 'mg_1', timestamp: new Date(), temperature: 15, humidity: 70, pressure: 1015,
  windSpeed: 6, windGust: 8, windDirection: 90, precipitation: 0, solarRadiation: null, dewPoint: null,
};

describe('WindParticleOverlay, saved on across a reload', () => {
  let frames: FrameRequestCallback[];
  let ctx: ReturnType<typeof fakeCtx>;

  const runFrames = (n: number) => {
    for (let i = 0; i < n; i++) {
      vi.advanceTimersByTime(40);
      const due = frames;
      frames = [];
      for (const f of due) f(performance.now());
    }
  };

  beforeEach(() => {
    vi.useFakeTimers();
    frames = [];
    ctx = fakeCtx();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', () => { frames = []; });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as never);
    useWeatherLayerStore.setState({ activeLayer: 'wind-particles', layerOpacity: 0.7 });
    useWeatherStore.setState({ stations: [], currentReadings: new Map() });
    useBuoyStore.setState({ buoys: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Every value the loop gives to shadowBlur and lineWidth. */
  function watchStroke() {
    const blurs: number[] = [];
    const widths: number[] = [];
    // A canvas measures 0 here and the loop drops what falls off it: the whole view has to land within its 50 px margin
    vi.spyOn(map, 'project').mockImplementation((([lon, lat]: [number, number]) => ({ x: (lon + 9) * 40, y: (43 - lat) * 40 })) as never);
    Object.defineProperty(ctx, 'shadowBlur', { configurable: true, get: () => 0, set: (v: number) => { blurs.push(v); } });
    Object.defineProperty(ctx, 'lineWidth', { configurable: true, get: () => 1, set: (v: number) => { widths.push(v); } });
    return { blurs, widths };
  }
  const blowing = (ms: number) => act(() => {
    useWeatherStore.setState({ stations: [station], currentReadings: new Map([[station.id, { ...reading, windSpeed: ms }]]) });
  });

  // 18-nov: a station with a lot of wind threw long, thick, glowing streaks among calm ones. Now every particle moves
  // and draws the same; only its colour says how much.
  it('strong wind does not glow', () => {
    const { blurs, widths } = watchStroke();
    render(<WindParticleOverlay mapRef={mapRef} />);
    blowing(15);
    runFrames(30);
    expect(widths.length).toBeGreaterThan(0);
    expect(Math.max(0, ...blurs)).toBe(0);
  });

  it('a strong and a moderate wind draw the same width', () => {
    const strong = watchStroke();
    const { unmount } = render(<WindParticleOverlay mapRef={mapRef} />);
    blowing(15);
    runFrames(30);
    unmount();
    vi.restoreAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as never);
    const moderate = watchStroke();
    render(<WindParticleOverlay mapRef={mapRef} />);
    blowing(5);
    runFrames(30);
    expect(strong.widths.length).toBeGreaterThan(0);
    expect(new Set([...strong.widths, ...moderate.widths]).size).toBe(1);
  });

  it('a page nobody touches stops drawing, and starts again with the first gesture', () => {
    render(<WindParticleOverlay mapRef={mapRef} />);
    blowing(6);
    runFrames(5);
    expect(ctx.drawImage).toHaveBeenCalled();
    ctx.drawImage.mockClear();
    document.documentElement.setAttribute('data-idle', '');
    try {
      runFrames(10);
      expect(ctx.drawImage).not.toHaveBeenCalled();
    } finally {
      document.documentElement.removeAttribute('data-idle');
    }
    runFrames(5);
    expect(ctx.drawImage).toHaveBeenCalled();
  });

  it('starts animating when the readings arrive after the layer mounted', () => {
    render(<WindParticleOverlay mapRef={mapRef} />);
    runFrames(5);
    expect(ctx.drawImage).not.toHaveBeenCalled();

    act(() => {
      useWeatherStore.setState({ stations: [station], currentReadings: new Map([[station.id, reading]]) });
    });
    runFrames(5);
    expect(ctx.drawImage).toHaveBeenCalled();
  });

  it('stops and clears when the readings go away (sector switch)', () => {
    useWeatherStore.setState({ stations: [station], currentReadings: new Map([[station.id, reading]]) });
    render(<WindParticleOverlay mapRef={mapRef} />);
    runFrames(3);
    expect(ctx.drawImage).toHaveBeenCalled();

    ctx.drawImage.mockClear();
    ctx.clearRect.mockClear();
    act(() => { useWeatherStore.setState({ stations: [], currentReadings: new Map() }); });
    expect(ctx.clearRect).toHaveBeenCalled();
    runFrames(3);
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });
});

describe('wind legend', () => {
  it('names every colour windSpeedColor paints, with the knots where it starts', () => {
    const colours = WIND_LEGEND_STOPS.map((s) => windSpeedColor(s.ms));
    expect(new Set(colours).size).toBe(WIND_LEGEND_STOPS.length);
    for (let ms = 0; ms < 20; ms += 0.1) expect(colours).toContain(windSpeedColor(ms));
  });

  it('labels each stop with its speed in knots, rounded', () => {
    for (const s of WIND_LEGEND_STOPS.slice(1)) {
      expect(Math.abs(parseInt(s.label, 10) - msToKnots(s.ms))).toBeLessThanOrEqual(1);
    }
  });
});
