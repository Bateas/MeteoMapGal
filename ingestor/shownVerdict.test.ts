import { describe, it, expect } from 'vitest';
import { settleShown } from './shownVerdict';
import { scoreAllSpots, type SpotScore } from '../src/services/spotScoringEngine';
import type { VerdictHoldState } from '../src/services/verdictHold';
import type { NormalizedStation, NormalizedReading } from '../src/types/station';
import { RIAS_SPOTS } from '../src/config/spots';

const MIN = 60_000;
const T0 = Date.parse('2026-11-10T12:00:00Z');
const spot = RIAS_SPOTS.find((s) => s.id === 'centro-ria')!;
const station: NormalizedStation = { id: 'h1', name: 'h1', lat: spot.center[1], lon: spot.center[0], altitude: 10, source: 'meteogalicia', tempOnly: false };
const reading = (kt: number): NormalizedReading => ({
  stationId: 'h1', timestamp: new Date(), windSpeed: kt / 1.94384, windGust: (kt * 1.2) / 1.94384, windDirection: 45,
  temperature: 18, humidity: 55, precipitation: null, solarRadiation: null, pressure: 1015, dewPoint: 12,
});
// The raw engine score, as the server computes it (no hold state).
const raw = (kt: number): SpotScore => scoreAllSpots([spot], [station], new Map([['h1', reading(kt)]]), []).get(spot.id)!;
// What the map computes with its own hold state.
const mapShown = (kt: number, states: Map<string, VerdictHoldState>, nowMs: number) =>
  scoreAllSpots([spot], [station], new Map([['h1', reading(kt)]]), [], undefined, undefined, undefined, undefined, undefined, { states, nowMs }).get(spot.id)!.verdict;

let onLine = 11;
while (raw(onLine).verdict !== 'good' && onLine < 16) onLine = Math.round((onLine + 0.1) * 10) / 10;

describe('settleShown: the server records what the map shows', () => {
  it('follows the map cycle by cycle over a wind that sits on the 12 kt line', () => {
    const seq = [onLine - 1.5, onLine, onLine - 0.3, onLine + 0.4, onLine + 1.2, onLine + 0.2, onLine - 0.5, onLine - 1.4];
    const server = new Map<string, VerdictHoldState>();
    const map = new Map<string, VerdictHoldState>();
    seq.forEach((kt, i) => {
      const at = T0 + i * 5 * MIN;
      expect(settleShown(raw(kt), at, server).verdict, `cycle ${i}, ${kt} kt`).toBe(mapShown(kt, map, at));
    });
  });

  it('holds the colour on the line and names the doubt', () => {
    const states = new Map<string, VerdictHoldState>();
    expect(settleShown(raw(onLine - 1.5), T0, states)).toEqual({ verdict: 'sailing', doubt: null });
    expect(settleShown(raw(onLine), T0 + 5 * MIN, states)).toEqual({ verdict: 'sailing', doubt: 'sailing-good' });
    expect(settleShown(raw(onLine + 1.2), T0 + 10 * MIN, states).verdict).toBe('good');
  });

  it('never holds back a rise to strong, and states no doubt over it', () => {
    const states = new Map<string, VerdictHoldState>();
    settleShown(raw(15), T0, states);
    expect(settleShown(raw(19), T0 + 5 * MIN, states)).toEqual({ verdict: 'strong', doubt: null });
  });

  it('a provisional score is «unknown» and leaves no state behind', () => {
    const states = new Map<string, VerdictHoldState>();
    settleShown(raw(onLine - 1.5), T0, states);
    expect(settleShown({ ...raw(onLine), provisional: true }, T0 + 5 * MIN, states)).toEqual({ verdict: 'unknown', doubt: null });
    expect(states.has(spot.id)).toBe(false);
    expect(settleShown(raw(onLine), T0 + 10 * MIN, states).verdict).toBe('good');
  });
});
