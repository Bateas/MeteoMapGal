import { describe, it, expect } from 'vitest';
import { withServerPrecip, rainInWindowMm, precipSamplesFromHistory } from './precipSemantics';
import { classifyGauges } from './rainNowService';
import { parseRecentPrecip } from '../api/recentPrecipClient';
import type { NormalizedReading, NormalizedStation } from '../types/station';

const NOW = Date.parse('2026-10-20T21:00:00Z');
const min = (m: number) => NOW - m * 60_000;

const reading = (id: string, t: number, mm: number): NormalizedReading => ({
  stationId: id, timestamp: new Date(t), precipitation: mm,
  windSpeed: null, windGust: null, windDirection: null, temperature: 14, humidity: 95,
  solarRadiation: 0, pressure: null, dewPoint: null,
});
const station = (id: string, lon: number, lat: number) => ({ id, name: id, lon, lat }) as unknown as NormalizedStation;

describe('parseRecentPrecip', () => {
  it('reads the API shape and skips anything malformed', () => {
    const m = parseRecentPrecip({ windowMin: 75, stations: {
      wu_A: [[min(40), 1.0], [min(5), 2.5]],
      wu_B: [['x', 1], [min(5)], [min(5), -1]],
      wu_C: 'nada',
    } });
    expect([...m.keys()]).toEqual(['wu_A']);
    expect(m.get('wu_A')!.map((r) => r.precipitation)).toEqual([1.0, 2.5]);
    expect(parseRecentPrecip(null).size).toBe(0);
    expect(parseRecentPrecip({ stations: null }).size).toBe(0);
  });
});

describe('withServerPrecip', () => {
  it('without server data the page history is used as is', () => {
    const live = new Map([['wu_A', [reading('wu_A', min(10), 1)]]]);
    expect(withServerPrecip(live, new Map())).toBe(live);
  });

  it('never counts an interval twice: page readings only after the last server one', () => {
    const server = new Map([['mg_1', [reading('mg_1', min(20), 0.4), reading('mg_1', min(10), 0.6)]]]);
    const live = new Map([['mg_1', [reading('mg_1', min(10), 0.6), reading('mg_1', min(0), 0.2)]]]);
    const merged = withServerPrecip(live, server).get('mg_1')!;
    expect(merged.map((r) => r.timestamp.getTime())).toEqual([min(20), min(10), min(0)]);
    const mm = rainInWindowMm('mg_1', precipSamplesFromHistory(merged, undefined), NOW, 30);
    expect(mm).toBeCloseTo(1.2, 6);
  });
});

describe('cold start of the rain layer (20-oct: 1 wet gauge on a fresh page, ~20 on an old one)', () => {
  // Two amateur day counters 4 km apart, both growing: a pair, so both are rain.
  const stations = [station('wu_A', -8.95, 42.60), station('wu_B', -8.90, 42.61)];
  const current = new Map([
    ['wu_A', reading('wu_A', min(2), 3.0)],
    ['wu_B', reading('wu_B', min(2), 2.2)],
  ]);
  const server = new Map([
    ['wu_A', [reading('wu_A', min(50), 1.0), reading('wu_A', min(20), 2.0)]],
    ['wu_B', [reading('wu_B', min(50), 0.8), reading('wu_B', min(20), 1.5)]],
  ]);

  it('a page with no history cannot tell the counters grew', () => {
    const g = classifyGauges({ stations, readings: current, history: new Map(), nowMs: NOW });
    expect(g.filter((x) => x.verdict === 'rain')).toHaveLength(0);
  });

  it('with the server history the fresh page sees them wet, like an old one', () => {
    const g = classifyGauges({ stations, readings: current, history: withServerPrecip(new Map(), server), nowMs: NOW });
    expect(g.filter((x) => x.verdict === 'rain').map((x) => x.id).sort()).toEqual(['wu_A', 'wu_B']);
  });
});
