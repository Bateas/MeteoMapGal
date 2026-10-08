import { describe, it, expect } from 'vitest';
import { settleVerdict, VERDICT_HOLD_MS, HOLD_STATE_TTL_MS, type VerdictHoldState } from './verdictHold';
import { scoreAllSpots } from './spotScoringEngine';
import type { NormalizedStation, NormalizedReading } from '../types/station';
import { RIAS_SPOTS } from '../config/spots';

const MIN = 60_000;
const T0 = Date.parse('2026-10-08T10:00:00Z');

function run(seq: Array<{ raw: Parameters<typeof settleVerdict>[1]; at: number; clearly?: boolean }>) {
  let state: VerdictHoldState | undefined;
  return seq.map(({ raw, at, clearly }) => {
    const out = settleVerdict(state, raw, at, clearly ?? false);
    state = out.state;
    return out.shown;
  });
}

describe('settleVerdict', () => {
  it('shows the first verdict at once', () => {
    expect(run([{ raw: 'good', at: T0 }])).toEqual(['good']);
  });

  it('does not follow a wind that flips on the line every cycle (8-oct pattern)', () => {
    const seq = ['sailing', 'good', 'sailing', 'sailing', 'good', 'sailing', 'good', 'sailing'] as const;
    const shown = run(seq.map((raw, i) => ({ raw, at: T0 + i * 5 * MIN })));
    expect(new Set(shown)).toEqual(new Set(['sailing']));
  });

  it('changes once the new verdict has lasted the hold time', () => {
    const shown = run([
      { raw: 'sailing', at: T0 },
      { raw: 'good', at: T0 + 5 * MIN },
      { raw: 'good', at: T0 + 10 * MIN },
      { raw: 'good', at: T0 + 5 * MIN + VERDICT_HOLD_MS },
    ]);
    expect(shown).toEqual(['sailing', 'sailing', 'sailing', 'good']);
  });

  it('changes at once when the wind is clearly past the line', () => {
    expect(run([{ raw: 'sailing', at: T0 }, { raw: 'good', at: T0 + MIN, clearly: true }])).toEqual(['sailing', 'good']);
  });

  it('never holds back strong, unknown or a jump of two levels', () => {
    expect(run([{ raw: 'good', at: T0 }, { raw: 'strong', at: T0 + MIN }])).toEqual(['good', 'strong']);
    expect(run([{ raw: 'strong', at: T0 }, { raw: 'good', at: T0 + MIN }])).toEqual(['strong', 'good']);
    expect(run([{ raw: 'sailing', at: T0 }, { raw: 'unknown', at: T0 + MIN }])).toEqual(['sailing', 'unknown']);
    expect(run([{ raw: 'calm', at: T0 }, { raw: 'sailing', at: T0 + MIN }])).toEqual(['calm', 'sailing']);
  });

  it('forgets a state nobody refreshed (tab asleep)', () => {
    expect(run([{ raw: 'sailing', at: T0 }, { raw: 'good', at: T0 + HOLD_STATE_TTL_MS + MIN }])).toEqual(['sailing', 'good']);
  });
});

describe('scoreAllSpots with the verdict hold', () => {
  const spot = RIAS_SPOTS.find((s) => s.id === 'centro-ria')!;
  const station: NormalizedStation = { id: 'h1', name: 'h1', lat: spot.center[1], lon: spot.center[0], altitude: 10, source: 'meteogalicia', tempOnly: false };
  const reading = (kt: number): NormalizedReading => ({
    stationId: 'h1', timestamp: new Date(), windSpeed: kt / 1.94384, windGust: (kt * 1.2) / 1.94384, windDirection: 45,
    temperature: 18, humidity: 55, precipitation: null, solarRadiation: null, pressure: 1015, dewPoint: 12,
  });
  const score = (kt: number, hold?: { states: Map<string, VerdictHoldState>; nowMs: number }) =>
    scoreAllSpots([spot], [station], new Map([['h1', reading(kt)]]), [], undefined, undefined, undefined, undefined, undefined, hold).get(spot.id)!;

  // The lowest measured kt that reads BUENO here (calibrations move the line a little).
  let onLine = 11;
  while (score(onLine).verdict !== 'good' && onLine < 16) onLine = Math.round((onLine + 0.1) * 10) / 10;

  it('keeps NAVEGABLE through one cycle on the line, with a summary that matches', () => {
    expect(score(onLine).verdict).toBe('good');
    const states = new Map<string, VerdictHoldState>();
    expect(score(onLine - 1.5, { states, nowMs: T0 }).verdict).toBe('sailing');
    const held = score(onLine, { states, nowMs: T0 + 5 * MIN });
    expect(held.verdict).toBe('sailing');
    expect(held.summary).not.toMatch(/Buenas condiciones/);
    expect(score(onLine, { states, nowMs: T0 + 5 * MIN + VERDICT_HOLD_MS }).verdict).toBe('good');
  });

  it('goes up at once when the wind is well past the line', () => {
    const states = new Map<string, VerdictHoldState>();
    expect(score(onLine - 1.5, { states, nowMs: T0 }).verdict).toBe('sailing');
    expect(score(onLine + 2, { states, nowMs: T0 + MIN }).verdict).toBe('good');
  });

  it('without the hold state (server) it keeps the raw verdict', () => {
    expect(score(onLine).verdict).toBe('good');
    expect(score(onLine - 1.5).verdict).toBe('sailing');
  });
});
