/**
 * What the map says without saying it: the figure, the ring that fills, the notch of the wind and the shape. Each test
 * here was added because the same break went through the whole suite green on 5-nov (see _herramientas/mutantes.mjs).
 * They read what is drawn, not the props: a person sees the arc, not the fraction.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

vi.mock('react-map-gl/maplibre', async () => {
  const React = await import('react');
  const { createPortal } = await import('react-dom');
  const Marker = React.forwardRef<unknown, { children?: React.ReactNode }>(function Marker({ children }, ref) {
    const el = React.useMemo(() => document.createElement('div'), []);
    React.useImperativeHandle(ref, () => ({ getElement: () => el }), [el]);
    React.useEffect(() => {
      document.body.appendChild(el);
      return () => { el.remove(); };
    }, [el]);
    return createPortal(children, el);
  });
  return { Marker, useMap: () => ({ current: null }) };
});

import { SpotMarkers } from './SpotMarker';
import { SpotShape, gaugeArcs } from './SpotShape';
import { useSpotStore } from '../../store/spotStore';
import { useSectorStore } from '../../store/sectorStore';
import { SECTORS } from '../../config/sectors';
import { VERDICT_LINE } from '../../config/verdictStyles';
import { ALL_SPOTS } from '../../config/spots';
import { buildSurfEntry } from '../../services/surfVerdictEngine';
import type { MarineForecastHour } from '../../api/marineClient';
import type { SpotScore } from '../../services/spotScoringEngine';

const HOUR = 3_600_000;
const VAO = ALL_SPOTS.find((s) => s.id === 'vao')!;
const CORRUBEDO = ALL_SPOTS.find((s) => s.id === 'surf-corrubedo')!;

function score(spotId: string, over: Record<string, unknown> = {}): SpotScore {
  return {
    spotId, spotName: spotId, verdict: 'sailing', score: 50, summary: '',
    wind: { stationCount: 3, avgSpeedKt: 10, rawAvgSpeedKt: 10, dominantDir: 'NE', dirDeg: 45 },
    waves: null, effectiveWindKt: 10, windDirDeg: 45, provisional: false, hardGateTriggered: null, thermal: null,
    computedAt: new Date(), ...over,
  } as unknown as SpotScore;
}

/** 1.3 m of NW swell, 9 s: SURF OK at Corrubedo, 1.14 m on the beach (same case as surfConsistency.test). */
function swell(): MarineForecastHour[] {
  const start = Math.floor(Date.now() / HOUR) * HOUR - HOUR;
  return Array.from({ length: 30 }, (_, i) => ({
    time: new Date(start + i * HOUR), waveHeight: 1.3, wavePeriod: 9, waveDirection: 315,
    swellHeight: 1.3, swellPeriod: 9, swellDirection: 315,
  }));
}

function seed(s: SpotScore, surfEntry?: ReturnType<typeof buildSurfEntry>) {
  useSpotStore.setState({
    scores: new Map([[s.spotId, s]]), lastScored: Date.now(),
    surfWaveCache: surfEntry ? new Map([[s.spotId, surfEntry]]) : new Map(),
  } as never);
}

const marker = (shortName: string) => screen.getByRole('button', { name: new RegExp(`^Spot ${shortName}`) });
const shapeOf = (el: Element) => [...el.querySelectorAll('svg')].find((s) => s.querySelector('text'))!;

/** Degrees clockwise from the top at which the filled arc ends. */
function arcEnd(svg: Element): number {
  const c = Number(svg.getAttribute('width')) / 2;
  const nums = svg.querySelector('path')!.getAttribute('d')!.trim().split(/\s+/);
  const [x, y] = [Number(nums[nums.length - 2]), Number(nums[nums.length - 1])];
  return (Math.atan2(x - c, c - y) * 180 / Math.PI + 360) % 360;
}

const sides = (polygon: Element) => polygon.getAttribute('points')!.trim().split(/\s+/).length;

beforeEach(() => {
  useSectorStore.setState({ activeSectorId: 'rias', activeSector: SECTORS.find((s) => s.id === 'rias')! } as never);
  useSpotStore.getState().selectSpot('');
});

afterEach(() => {
  cleanup();
  useSpotStore.setState({ scores: new Map(), surfWaveCache: new Map(), lastScored: 0 } as never);
});

describe('the figure inside the shape', () => {
  it('is the calibrated wind, the one the card shows, not the raw mean of the stations', () => {
    seed(score(VAO.id, { wind: { stationCount: 3, avgSpeedKt: 6, rawAvgSpeedKt: 6, dominantDir: 'NE', dirDeg: 45 }, effectiveWindKt: 11 }));
    render(<SpotMarkers />);
    expect(shapeOf(marker(VAO.shortName)).querySelector('text')!.textContent).toBe('11');
  });

  it('a score still calculating shows a dash and no ring', () => {
    seed(score(VAO.id, { provisional: true, effectiveWindKt: 11 }));
    render(<SpotMarkers />);
    const svg = shapeOf(marker(VAO.shortName));
    expect(svg.querySelector('text')!.textContent).toBe('–');
    expect(svg.querySelector('path')).toBeNull();
  });

  it('a spot with no verdict shows no figure, whatever wind it has', () => {
    seed(score(VAO.id, { verdict: 'unknown', effectiveWindKt: 11 }));
    render(<SpotMarkers />);
    expect(shapeOf(marker(VAO.shortName)).querySelector('text')!.textContent).toBe('–');
  });

  it('a spot closed by the sea shows the sea, never a wind figure next to FUERTE', () => {
    seed(score(VAO.id, { verdict: 'strong', hardGateKind: 'wave', effectiveWindKt: 25, waves: { localHeight: 3, localSource: 'swan' } }));
    render(<SpotMarkers />);
    const svg = shapeOf(marker(VAO.shortName));
    expect(svg.querySelector('text')!.textContent).toBe('3,0');
    expect(marker(VAO.shortName).getAttribute('aria-label')).toContain('oleaje de 3,0 m');
  });
});

describe('the ring that fills', () => {
  it('10 kt is half of it, and half of 270° is 135°', () => {
    seed(score(VAO.id, { effectiveWindKt: 10 }));
    render(<SpotMarkers />);
    expect(arcEnd(shapeOf(marker(VAO.shortName)))).toBeCloseTo(135, 0);
  });

  it('20 kt fills it and more wind does not go round again', () => {
    seed(score(VAO.id, { effectiveWindKt: 20, verdict: 'strong' }));
    render(<SpotMarkers />);
    expect(arcEnd(shapeOf(marker(VAO.shortName)))).toBeCloseTo(270, 0);
    cleanup();
    seed(score(VAO.id, { effectiveWindKt: 34, verdict: 'strong' }));
    render(<SpotMarkers />);
    expect(arcEnd(shapeOf(marker(VAO.shortName)))).toBeCloseTo(270, 0);
  });

  it('a closed sea fills it on the wave scale: 1,25 m is half', () => {
    seed(score(VAO.id, { verdict: 'strong', hardGateKind: 'wave', effectiveWindKt: 25, waves: { localHeight: 1.25, localSource: 'swan' }, }));
    // The score's own wave height is what the marker reads for a sailing spot
    useSpotStore.setState({ scores: new Map([[VAO.id, score(VAO.id, { verdict: 'strong', hardGateKind: 'wave', effectiveWindKt: 25, waves: { localHeight: 1.25, waveHeight: 1.25, localSource: 'swan' } })]]) } as never);
    render(<SpotMarkers />);
    expect(arcEnd(shapeOf(marker(VAO.shortName)))).toBeCloseTo(135, 0);
  });
});

describe('a surf spot', () => {
  function surfSeed() {
    const s = score(CORRUBEDO.id, { verdict: 'calm', effectiveWindKt: 4, windDirDeg: 315 });
    const entry = buildSurfEntry(CORRUBEDO, swell(), s, Date.now(), Date.now(), false);
    expect(entry.verdict?.label).toBe('SURF OK');
    seed(s, entry);
    render(<SpotMarkers />);
    return { entry, svg: shapeOf(marker(CORRUBEDO.shortName)) };
  }

  it('is a pentagon, a wind spot a hexagon: the shape says what kind it is', () => {
    const { svg } = surfSeed();
    expect(sides(svg.querySelector('polygon')!)).toBe(5);
    cleanup();
    seed(score(VAO.id));
    render(<SpotMarkers />);
    expect(sides(shapeOf(marker(VAO.shortName)).querySelector('polygon')!)).toBe(6);
  });

  it('goes hollow: its wave is a model, nobody measures it on the beach', () => {
    const { svg } = surfSeed();
    expect(svg.querySelector('polygon')!.getAttribute('fill')).toBe('var(--g-bg)');
  });

  it('takes the colour of its wave, not of the wind: SURF OK reads like navegable, with calm wind', () => {
    const { svg } = surfSeed();
    expect(svg.querySelector('polygon')!.getAttribute('stroke')).toBe('var(--g-s-navegable)');
  });

  it('its ring follows the wave on the beach', () => {
    const { entry, svg } = surfSeed();
    expect(arcEnd(svg)).toBeCloseTo((entry.waveHeight! / 2.5) * 270, 0);
  });
});

describe('a clean map', () => {
  it('the word of the state only on the selected spot: the colour says it for the rest', () => {
    seed(score(VAO.id, { verdict: 'good', effectiveWindKt: 13 }));
    render(<SpotMarkers />);
    expect(marker(VAO.shortName).textContent).not.toContain('Bueno');
    cleanup();
    useSpotStore.getState().selectSpot(VAO.id);
    render(<SpotMarkers />);
    expect(marker(VAO.shortName).textContent).toContain('Bueno');
  });
});

describe('SpotShape', () => {
  const draw = (props: Partial<React.ComponentProps<typeof SpotShape>> = {}) =>
    render(<SpotShape verdict="good" value="13" {...props} />).container.querySelector('svg')!;
  const notch = (svg: Element) => svg.querySelector('polygon[fill="var(--g-m-notch)"]');
  const points = (el: Element) => el.getAttribute('points')!.trim().split(/\s+/).map((p) => p.split(',').map(Number));

  it('a full gauge stops at 270° from the top, it does not close the circle', () => {
    expect(arcEnd(draw({ gauge: 1 }))).toBeCloseTo(270, 0);
  });

  it('in doubt with the level above, the dashes go on from the tip in the colour of that level', () => {
    const svg = draw({ verdict: 'sailing', value: '11', gauge: 11 / 20, doubt: { other: 'good', above: true } });
    const dashed = svg.querySelector('path[data-doubt="good"]')!;
    expect(dashed.getAttribute('stroke')).toBe(VERDICT_LINE.good);
    expect(dashed.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(gaugeArcs(11 / 20, { other: 'good', above: true })).toEqual({ solidEnd: 148.5, dashed: [148.5, 192.5] });
  });

  it('in doubt with the level below, the tip itself is dashed and the solid arc stops short', () => {
    expect(gaugeArcs(12 / 20, { other: 'sailing', above: false })).toEqual({ solidEnd: 118, dashed: [118, 162] });
  });

  it('the dashes never close the circle, and without doubt there are none', () => {
    expect(gaugeArcs(1, { other: 'strong', above: true }).dashed).toEqual([270, 310]);
    expect(gaugeArcs(0.5, null).dashed).toBeNull();
    expect(draw({ gauge: 0.5 }).querySelector('path[data-doubt]')).toBeNull();
  });

  it('no gauge, no ring; an empty gauge, the track without an arc', () => {
    expect(draw({ gauge: null }).querySelector('circle')).toBeNull();
    cleanup();
    const empty = draw({ gauge: 0 });
    expect(empty.querySelector('circle')).not.toBeNull();
    expect(empty.querySelector('path')).toBeNull();
  });

  it.each([
    [0, 'above', (_x: number, y: number, c: number) => y < c],
    [90, 'to the right', (x: number, _y: number, c: number) => x > c],
    [180, 'below', (_x: number, y: number, c: number) => y > c],
    [270, 'to the left', (x: number, _y: number, c: number) => x < c],
  ])('the notch is on the side the wind comes from: %i° is %s', (fromDeg, _where, onSide) => {
    const svg = draw({ fromDeg, gauge: 0.5 });
    const c = Number(svg.getAttribute('width')) / 2;
    for (const [x, y] of points(notch(svg)!)) expect(onSide(x, y, c)).toBe(true);
  });

  it('the notch points at the shape: its tip is its closest point to the centre', () => {
    const svg = draw({ fromDeg: 0, gauge: 0.5 });
    const c = Number(svg.getAttribute('width')) / 2;
    const dist = points(notch(svg)!).map(([x, y]) => Math.hypot(x - c, y - c));
    expect(dist[0]).toBe(Math.min(...dist));
  });

  it('a model has no notch of wind, nor does a shape with nothing yet', () => {
    expect(notch(draw({ fromDeg: 0, hollow: true }))).toBeNull();
    cleanup();
    expect(notch(draw({ fromDeg: 0, value: null }))).toBeNull();
  });
});
