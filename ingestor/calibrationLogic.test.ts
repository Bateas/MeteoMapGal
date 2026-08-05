import { describe, it, expect } from 'vitest';
import {
  calibrateStations,
  directionSector,
  summariseCalibration,
  MIN_HOURS_GLOBAL,
  MIN_DAYS,
  isUsableReference,
  altitudeAllowsReference,
  MAX_REFERENCE_ALTITUDE_M,
  MIN_HOURS_SECTOR,
  type PairedHour,
} from './calibrationLogic';

/** N paired hours where the station sees `fraction` of the buoy, with the buoy
 *  varying so the pair has something to correlate. */
const pairs = (
  stationId: string,
  fraction: number,
  n: number,
  opts: { buoyDirDeg?: number | null; stationFixedMs?: number; buoyId?: number } = {},
): PairedHour[] =>
  Array.from({ length: n }, (_, i) => {
    // Nine hours a day, and the day-to-day level moves: the response test runs
    // on daily means, so a fixture where every day is identical would have
    // nothing to correlate.
    const day = 1 + Math.floor(i / 9);
    const buoyMs = 3 + (day % 9);
    return {
      stationId,
      day: `2026-06-${String(day).padStart(2, '0')}`,
      buoyId: opts.buoyId ?? 3221,
      buoyMs,
      stationMs: opts.stationFixedMs ?? buoyMs * fraction,
      buoyDirDeg: opts.buoyDirDeg === undefined ? 225 : opts.buoyDirDeg,
    };
  });

describe('directionSector', () => {
  it('centres north on zero rather than starting a bin there', () => {
    // 350 and 10 degrees are the same weather; a bin starting at 0 would split
    // a northerly in two and halve its sample count on both sides.
    expect(directionSector(0)).toBe(0);
    expect(directionSector(10)).toBe(0);
    expect(directionSector(350)).toBe(0);
  });

  it('maps the eight compass points', () => {
    expect(directionSector(45)).toBe(1);
    expect(directionSector(90)).toBe(2);
    expect(directionSector(225)).toBe(5);
    expect(directionSector(315)).toBe(7);
  });

  it('handles bearings outside 0-360 without wrapping into a wrong bin', () => {
    expect(directionSector(405)).toBe(1);
    expect(directionSector(-45)).toBe(7);
  });
});

describe('calibrateStations — the statistic', () => {
  it('uses the ratio of means, not the mean of ratios', () => {
    // The trap: one calm hour where the buoy barely moves gives a quotient of
    // 10, and averaging quotients lets that single hour set the answer. Summing
    // both sides first makes it one small contribution among many.
    const rows = calibrateStations([
      ...pairs('mg_x', 0.5, 200),
      { stationId: 'mg_x', day: '2026-06-01', buoyId: 3221, stationMs: 1.0, buoyMs: 0.1, buoyDirDeg: 225 },
    ]);

    // Mean of ratios would land near 0.55 or above; ratio of means stays put.
    expect(rows[0].ratio).toBeGreaterThan(0.49);
    expect(rows[0].ratio).toBeLessThan(0.52);
  });

  it('reports the real fraction a sheltered site sees', () => {
    const rows = calibrateStations(pairs('mg_shelter', 0.4, 200));
    expect(rows[0].ratio).toBeCloseTo(0.4, 2);
    expect(rows[0].status).toBe('sheltered');
  });

  it('calls a station that reads the free stream exposed', () => {
    const rows = calibrateStations(pairs('mg_cape', 0.97, 200));
    expect(rows[0].status).toBe('exposed');
  });

  it('drops hours where the buoy itself was calm', () => {
    // Those hours say nothing about how much wind the site sees, and they drag
    // the ratio around because the denominator is near zero.
    const rows = calibrateStations([
      ...pairs('mg_y', 0.5, 200),
      ...Array.from({ length: 20 }, () => ({
        stationId: 'mg_y', day: '2026-06-01', buoyId: 3221, stationMs: 0, buoyMs: 0, buoyDirDeg: 225,
      })),
    ]);
    expect(rows[0].hours).toBe(200);
    expect(rows[0].ratio).toBeCloseTo(0.5, 2);
  });
});

describe('calibrateStations — broken is not the same as sheltered', () => {
  it('calls a frozen sensor dead even though its number looks like calm', () => {
    // The six real ones read 0.00 to 0.43 m/s for hundreds of hours. By ratio
    // alone they are indistinguishable from a walled courtyard.
    const rows = calibrateStations(pairs('wu_frozen', 0, 300, { stationFixedMs: 0.3 }));
    expect(rows[0].status).toBe('dead');
  });

  it('does NOT call a genuinely sheltered station dead, however little it reads', () => {
    // This is the test that matters. A courtyard reading a tenth of the free
    // stream is still measuring, and marking it broken would throw away a real
    // observation and hide nothing.
    const rows = calibrateStations(pairs('mg_courtyard', 0.1, 300));
    expect(rows[0].status).toBe('very_sheltered');
    expect(rows[0].correlation).toBeGreaterThan(0.9);
  });

  it('does NOT call a station dead just for ignoring the sea, if it reads real wind', () => {
    // This test used to assert 'dead', on the reasoning that plausible
    // magnitude with no relationship meant a vane spinning on its own. The
    // first live run overturned it: Illas Cíes and a station on a 681m summit
    // both landed here, reading 78% and 83% of the free stream with correlations
    // of 0.00 and 0.17. Neither is faulty. An ocean island and a mountain top
    // do not follow a tide gauge inside a harbour, and no statistic will make
    // them. The expectation was changed because the data said so, not to make
    // the suite pass.
    const noise = Array.from({ length: 300 }, (_, i) => ({
      stationId: 'wu_noise',
      day: `2026-06-${String(1 + Math.floor(i / 9)).padStart(2, '0')}`,
      buoyId: 3221,
      buoyMs: 3 + (Math.floor(i / 9) % 9),
      // Deliberately anti-phase with the buoy so correlation collapses.
      stationMs: 3 + ((Math.floor(i / 9) * 7) % 9) * 0.5,
      buoyDirDeg: 225,
    }));
    const rows = calibrateStations(noise);
    expect(rows[0].correlation!).toBeLessThan(0.25);
    expect(rows[0].status).toBe('unreferenced');
  });

  it('publishes no sector table for a station it just called dead', () => {
    // Shipping per-sector numbers for a broken instrument invites someone to
    // use them.
    const rows = calibrateStations(pairs('wu_frozen', 0, 300, { stationFixedMs: 0.3 }));
    expect(rows[0].sectors).toEqual([]);
  });
});

describe('calibrateStations — sectors', () => {
  it('bins by the buoy direction, so shelter shows up where it really is', () => {
    // Same station, open to the south-west and blocked from the north. Binning
    // by the station's own vane would sort the hours by the distortion instead.
    const rows = calibrateStations([
      ...pairs('mg_split', 0.85, 200, { buoyDirDeg: 225 }),
      ...pairs('mg_split', 0.20, 200, { buoyDirDeg: 0 }),
    ]);

    const sw = rows[0].sectors.find((s) => s.sector === 5);
    const n = rows[0].sectors.find((s) => s.sector === 0);
    expect(sw!.ratio).toBeCloseTo(0.85, 1);
    expect(n!.ratio).toBeCloseTo(0.20, 1);
    // And the global figure hides exactly that: it sits between the two.
    expect(rows[0].ratio!).toBeGreaterThan(0.3);
    expect(rows[0].ratio!).toBeLessThan(0.8);
  });

  it('withholds a sector that has not earned its sample floor', () => {
    const rows = calibrateStations([
      ...pairs('mg_z', 0.5, 200, { buoyDirDeg: 225 }),
      ...pairs('mg_z', 0.9, MIN_HOURS_SECTOR - 1, { buoyDirDeg: 90 }),
    ]);
    expect(rows[0].sectors.map((s) => s.sector)).toEqual([5]);
  });

  it('keeps an hour with no buoy direction in the global figure', () => {
    // Losing it from the sector table is right; losing it from the ratio would
    // throw away a real pair for a missing field the ratio does not need.
    const rows = calibrateStations(pairs('mg_w', 0.5, 200, { buoyDirDeg: null }));
    expect(rows[0].hours).toBe(200);
    expect(rows[0].ratio).toBeCloseTo(0.5, 2);
    expect(rows[0].sectors).toEqual([]);
  });
});

describe('calibrateStations — refusing to answer', () => {
  it('says insufficient rather than guessing from a handful of hours', () => {
    const rows = calibrateStations(pairs('mg_new', 0.5, MIN_HOURS_GLOBAL - 1));
    expect(rows[0].status).toBe('insufficient');
    expect(rows[0].ratio).toBeNull();
  });

  it('refuses when the hours are many but the days are few', () => {
    // 180 hours spread over six days is plenty of readings and almost no
    // weather: the response test correlates DAILY means, and six points
    // cannot tell a working anemometer from a lucky one.
    const packed = Array.from({ length: 180 }, (_, i) => ({
      stationId: 'mg_packed',
      day: `2026-06-0${1 + Math.floor(i / 30)}`,
      buoyId: 3221,
      buoyMs: 3 + (i % 9),
      stationMs: (3 + (i % 9)) * 0.5,
      buoyDirDeg: 225,
    }));
    const rows = calibrateStations(packed);
    expect(rows[0].hours).toBeGreaterThanOrEqual(MIN_HOURS_GLOBAL);
    expect(rows[0].days).toBeLessThan(MIN_DAYS);
    expect(rows[0].status).toBe('insufficient');
  });

  it('records which buoy the answer came from', () => {
    // The reference is part of the measurement: a dead buoy invalidates every
    // row that leaned on it, and without this we could not tell which.
    const rows = calibrateStations(pairs('mg_a', 0.5, 200, { buoyId: 2248 }));
    expect(rows[0].buoyId).toBe(2248);
  });

  it('survives an empty input without inventing a network', () => {
    expect(calibrateStations([])).toEqual([]);
  });
});

describe('summariseCalibration', () => {
  it('gives the cycle a line to print even when nothing is wrong', () => {
    const rows = calibrateStations([
      ...pairs('mg_a', 0.95, 200),
      ...pairs('mg_b', 0.40, 200),
      ...pairs('wu_c', 0, 200, { stationFixedMs: 0.2 }),
    ]);
    const line = summariseCalibration(rows);
    expect(line).toContain('3 stations');
    expect(line).toContain('1 exposed');
    expect(line).toContain('1 not measuring');
    expect(line).toContain('median ratio');
  });

  it('does not claim a median when nothing qualified', () => {
    const rows = calibrateStations(pairs('mg_new', 0.5, 10));
    expect(summariseCalibration(rows)).toContain('no median yet');
  });
});

describe('isUsableReference — the reference has to measure too', () => {
  // Real ninety-day figures from the Galician buoys, first run of the cycle.
  it('accepts the buoys that actually sample the free stream', () => {
    expect(isUsableReference({ meanMs: 3.29, stdevMs: 1.82, hours: 22707 })).toBe(true);  // Vigo
    expect(isUsableReference({ meanMs: 4.61, stdevMs: 2.76, hours: 6689 })).toBe(true);   // Silleiro
    expect(isUsableReference({ meanMs: 2.93, stdevMs: 1.86, hours: 24223 })).toBe(true);  // Vilagarcia
  });

  it('rejects the harbour buoy that broke the first run', () => {
    // 4271: mean 0.53 m/s, max 3.0 over ninety days. Every station measured
    // against it came out "broken" with a ratio of 3 to 5. The stations were
    // fine — the reference was as sheltered as they were.
    expect(isUsableReference({ meanMs: 0.53, stdevMs: 0.46, hours: 12030 })).toBe(false);
  });

  it('rejects a buoy with two hours of data however fast the wind looked', () => {
    expect(isUsableReference({ meanMs: 7.24, stdevMs: 0.44, hours: 2 })).toBe(false);
  });

  it('rejects a reference that does not vary, even at a healthy mean', () => {
    // Same reasoning applied to the reference as to the stations: a constant
    // series is an instrument at rest, not a calm sea.
    expect(isUsableReference({ meanMs: 4.0, stdevMs: 0.2, hours: 10000 })).toBe(false);
  });
});

describe('unreferenced is not broken — the live run that forced this apart', () => {
  /** A station reading a healthy fraction whose day-to-day swings simply do
   *  not follow the reference. Real cases: Illas Cíes at 0.78 with a daily
   *  correlation of 0.00, San Nomedio at 0.83 with 0.17. */
  const outOfStep = (stationId: string, fraction: number) =>
    Array.from({ length: 300 }, (_, i) => {
      const day = 1 + Math.floor(i / 9);
      const buoyMs = 3 + (day % 9);
      return {
        stationId,
        day: `2026-06-${String(day).padStart(2, '0')}`,
        buoyId: 3221,
        buoyMs,
        // Its own rhythm, uncorrelated with the buoy's.
        stationMs: (3 + ((day * 7) % 9)) * fraction,
        buoyDirDeg: 225,
      };
    });

  it('does NOT call a station broken when it reads 80% of the free stream', () => {
    // The test that this whole change exists for. An instrument returning
    // 3.7 m/s of real, varying wind is not faulty, whatever the correlation
    // says — it just has no comparable reference within reach.
    const rows = calibrateStations(outOfStep('mg_summit', 0.83));
    expect(rows[0].correlation!).toBeLessThan(0.25);
    expect(rows[0].status).toBe('unreferenced');
    expect(rows[0].status).not.toBe('dead');
  });

  it('still calls it dead when it neither follows nor reads anything', () => {
    // Poor correlation AND next to no wind: that combination is an
    // instrument, not a site.
    const rows = calibrateStations(outOfStep('wu_stopped', 0.05));
    expect(rows[0].correlation!).toBeLessThan(0.25);
    expect(rows[0].status).toBe('dead');
  });

  it('withholds the sector table for an unreferenced station too', () => {
    // Publishing them would look like a transfer function and be nothing of
    // the sort.
    const rows = calibrateStations(outOfStep('mg_summit', 0.83));
    expect(rows[0].sectors).toEqual([]);
  });

  it('keeps calling a responsive sheltered station sheltered', () => {
    // Guard against the reorder quietly promoting everything.
    const rows = calibrateStations(pairs('mg_valley', 0.4, 300));
    expect(rows[0].status).toBe('sheltered');
  });
});

describe('altitudeAllowsReference — a summit is not in the buoy layer', () => {
  it('rejects the summit that started this', () => {
    expect(altitudeAllowsReference(681)).toBe(false);   // San Nomedio
  });

  it('keeps the coastal and valley stations, which really do share the layer', () => {
    expect(altitudeAllowsReference(5)).toBe(true);
    expect(altitudeAllowsReference(122)).toBe(true);    // Prado, by the water
    expect(altitudeAllowsReference(MAX_REFERENCE_ALTITUDE_M)).toBe(true);
  });

  it('does not punish a station for not publishing its altitude', () => {
    // Most amateur stations never report one; excluding them would gut the
    // sample for no measured reason.
    expect(altitudeAllowsReference(null)).toBe(true);
  });
});
