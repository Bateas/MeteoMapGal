import { describe, it, expect } from 'vitest';
import {
  computeFieldCoherence,
  assessAfternoonCeiling,
  describeCeiling,
  MIN_STATIONS,
  COHERENCE_CEILING,
  LOCAL_CEILING_KT,
  WINDOW_START_HOUR,
  WINDOW_END_HOUR,
  MIN_STEADINESS,
} from './fieldCoherence';

/** A station holding one heading, with a little natural wobble. */
const steady = (stationId: string, heading: number, wobble = 8): { stationId: string; directions: number[] } => ({
  stationId,
  directions: Array.from({ length: 24 }, (_, i) => heading + (i % 2 ? wobble : -wobble)),
});

describe('computeFieldCoherence', () => {
  it('scores an organised field high', () => {
    // Everyone on the same south-westerly: this is what a real regime looks
    // like, and every one of the eight windiest afternoons measured scored
    // 0.68 or above.
    const f = computeFieldCoherence([steady('a', 225), steady('b', 230), steady('c', 220)]);
    expect(f!.coherence).toBeGreaterThan(0.95);
    expect(f!.stations).toBe(3);
  });

  it('scores the scattered field low — the afternoon that prompted this', () => {
    // Measured 5-Aug at Castrelo: Cartelle west, San Amaro north-west,
    // Remuíño east, Ribadavia east-north-east. Four stations inside eight
    // kilometres, four different answers, and one to two knots on the water.
    const f = computeFieldCoherence([
      steady('cartelle', 270), steady('sanamaro', 315),
      steady('remuino', 90), steady('ribadavia', 68),
    ]);
    expect(f!.coherence).toBeLessThan(COHERENCE_CEILING);
  });

  it('averages each station FIRST, so the chattiest one cannot decide', () => {
    // One station reporting every five minutes must not outvote two hourly
    // ones. The question is whether the SITES agree, not the samples.
    const chatty = { stationId: 'chatty', directions: Array.from({ length: 200 }, () => 90) };
    const f = computeFieldCoherence([chatty, steady('b', 270, 2), steady('c', 265, 2)]);
    // Two of three sites point west, so the field leans west despite the
    // eastward station carrying a hundred times the readings.
    const heading = Math.atan2(
      Math.sin((f!.perStation[0].headingDeg * Math.PI) / 180), 1,
    );
    expect(f!.coherence).toBeLessThan(0.6);
    expect(heading).toBeDefined();
  });

  it('handles the wrap at north instead of averaging it to south', () => {
    // 350 and 10 degrees are the same weather. Arithmetic would put their
    // mean at 180 — the exact opposite.
    const f = computeFieldCoherence([steady('a', 350, 0), steady('b', 10, 0), steady('c', 0, 0)]);
    expect(f!.coherence).toBeGreaterThan(0.98);
    const north = f!.perStation.map((p) => p.headingDeg);
    for (const h of north) expect(Math.min(h, 360 - h)).toBeLessThan(15);
  });

  it('refuses to answer with fewer than three stations', () => {
    expect(computeFieldCoherence([steady('a', 225), steady('b', 225)])).toBeNull();
    expect(computeFieldCoherence([])).toBeNull();
  });

  it('drops a station whose own directions cancel out entirely', () => {
    // Opposite headings in equal measure leave no heading to contribute. Note
    // this cannot be tested against exact zero: sin(pi) is 1.2e-16, so the
    // leftover vector is tiny but non-zero, and normalising it would promote
    // rounding noise to a confident arrow. Hence a physical floor, not an
    // arithmetic one.
    const cancelled = { stationId: 'spinning', directions: [0, 180, 0, 180] };
    expect(computeFieldCoherence([cancelled, steady('b', 225), steady('c', 225)])).toBeNull();
    const four = computeFieldCoherence([cancelled, steady('b', 225), steady('c', 225), steady('d', 225)]);
    expect(four!.stations).toBe(3);
  });

  it('reports each station steadiness, which is informative on its own', () => {
    // On 5-Aug not one station even held its own direction: 0.22 to 0.45.
    const f = computeFieldCoherence([
      { stationId: 'wandering', directions: [0, 90, 200, 300, 45, 170] },
      steady('b', 225), steady('c', 225),
    ]);
    expect(f!.perStation.find((p) => p.stationId === 'wandering')!.steadiness).toBeLessThan(0.5);
    expect(f!.perStation[0].steadiness).toBeGreaterThan(0.9);
  });

  it('keeps the genuinely wobbly stations, which is the whole point', () => {
    // The four around Castrelo on 5-Aug scored 0.22 to 0.45 — unsteady, but
    // each had a heading and each deserved its vote. A floor set carelessly
    // high would have thrown away the very afternoon that motivated this.
    const wobbly = [
      { stationId: 'a', directions: [250, 300, 200, 280, 240] },
      { stationId: 'b', directions: [ 20,  70, 340,  50, 359] },
      { stationId: 'c', directions: [120, 160,  80, 140, 100] },
    ];
    const f = computeFieldCoherence(wobbly);
    expect(f!.stations).toBe(3);
    for (const p of f!.perStation) expect(p.steadiness).toBeGreaterThan(MIN_STEADINESS);
  });
});

describe('assessAfternoonCeiling — it only ever says no', () => {
  const scattered = computeFieldCoherence([
    steady('a', 270), steady('b', 315), steady('c', 90), steady('d', 68),
  ]);
  const organised = computeFieldCoherence([steady('a', 225), steady('b', 230), steady('c', 220)]);

  it('states a ceiling when BOTH signals agree the afternoon is going nowhere', () => {
    const n = assessAfternoonCeiling({ localKt: 3.1, field: scattered, hour: 15 });
    expect(n).not.toBeNull();
    expect(n!.ceilingKt).toBe(9);
  });

  it('stays silent when the field is organised, however light it reads', () => {
    // A calm but coherent afternoon can still fill in. One low number is not
    // enough to write the day off.
    expect(assessAfternoonCeiling({ localKt: 2.0, field: organised, hour: 15 })).toBeNull();
  });

  it('stays silent when the local station already has wind, however scattered', () => {
    expect(assessAfternoonCeiling({ localKt: 7.0, field: scattered, hour: 15 })).toBeNull();
  });

  it('says nothing outside the window it was measured in', () => {
    // Extending an afternoon relationship to the morning would be inventing
    // skill the data does not support.
    for (const hour of [9, 11, WINDOW_START_HOUR - 1, WINDOW_END_HOUR + 1, 20]) {
      expect(assessAfternoonCeiling({ localKt: 3.1, field: scattered, hour })).toBeNull();
    }
    expect(assessAfternoonCeiling({ localKt: 3.1, field: scattered, hour: WINDOW_START_HOUR })).not.toBeNull();
    expect(assessAfternoonCeiling({ localKt: 3.1, field: scattered, hour: WINDOW_END_HOUR })).not.toBeNull();
  });

  it('says nothing when there is no field or no local reading', () => {
    expect(assessAfternoonCeiling({ localKt: 3.1, field: null, hour: 15 })).toBeNull();
    expect(assessAfternoonCeiling({ localKt: null, field: scattered, hour: 15 })).toBeNull();
  });

  it('treats the thresholds as exclusive, so a borderline day is not written off', () => {
    // Erring towards silence: the costly mistake is discouraging someone on a
    // day that turns out fine.
    expect(assessAfternoonCeiling({ localKt: LOCAL_CEILING_KT, field: scattered, hour: 15 })).toBeNull();
  });
});

describe('describeCeiling', () => {
  it('states a ceiling and never an absence', () => {
    // Two of the afternoons this flags still reached 8.6 kt, and there are
    // people who sail that. "No wind" would simply be false.
    const n = assessAfternoonCeiling({
      localKt: 3.1,
      field: computeFieldCoherence([steady('a', 270), steady('b', 315), steady('c', 90)]),
      hour: 15,
    })!;
    const text = describeCeiling(n);
    expect(text).toContain('9 kt');
    expect(text).not.toMatch(/no hay viento|sin viento|no salgas|imposible/i);
  });
});

describe('the constants match what was measured', () => {
  it('keeps the sample floor and thresholds the analysis used', () => {
    // If any of these move, the twenty-six-afternoon result no longer backs
    // the code and the whole thing needs re-measuring.
    expect(MIN_STATIONS).toBe(3);
    expect(COHERENCE_CEILING).toBe(0.65);
    expect(LOCAL_CEILING_KT).toBe(4.5);
    expect(WINDOW_START_HOUR).toBe(14);
    expect(WINDOW_END_HOUR).toBe(17);
  });
});
