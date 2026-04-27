/**
 * Tests for ingestor/synopticFetcher — pure parser of Open-Meteo upper-air
 * + convection hourly response.
 *
 * The fetch + DB write paths are exercised in production. Here we lock the
 * payload-shape parser so a wire-format change can't silently corrupt the
 * historical dataset substrate.
 */

import { describe, it, expect } from 'vitest';
import { parseSynopticPayload } from './synopticFetcher';

const ISO = (h: string, d = '2026-04-27') => `${d}T${h}:00`;

// Build a minimal valid Open-Meteo response with N hours of values
function makePayload(n: number, opts: Partial<{
  cape: (number | null)[];
  windDir850: (number | null)[];
  windSpeed850: (number | null)[];
  temp850: (number | null)[];
  gph850: (number | null)[];
  windDir700: (number | null)[];
  windDir500: (number | null)[];
  cin: (number | null)[];
  li: (number | null)[];
  pwat: (number | null)[];
  blh: (number | null)[];
}> = {}) {
  const time: string[] = [];
  for (let i = 0; i < n; i++) {
    time.push(ISO(`${String(i).padStart(2, '0')}:00`));
  }
  const fill = (arr: (number | null)[] | undefined, fallback: number | null) =>
    arr ?? new Array(n).fill(fallback);
  return {
    hourly: {
      time,
      // Convection bundle
      cape: fill(opts.cape, 100),
      convective_inhibition: fill(opts.cin, -20),
      lifted_index: fill(opts.li, -2),
      precipitable_water: fill(opts.pwat, 25),
      boundary_layer_height: fill(opts.blh, 800),
      // 850 hPa
      wind_speed_850hPa: fill(opts.windSpeed850, 15),
      wind_direction_850hPa: fill(opts.windDir850, 270),
      temperature_850hPa: fill(opts.temp850, 5),
      geopotential_height_850hPa: fill(opts.gph850, 1500),
      // 700 hPa
      wind_speed_700hPa: new Array(n).fill(20),
      wind_direction_700hPa: fill(opts.windDir700, 280),
      temperature_700hPa: new Array(n).fill(-5),
      geopotential_height_700hPa: new Array(n).fill(3000),
      // 500 hPa
      wind_speed_500hPa: new Array(n).fill(35),
      wind_direction_500hPa: fill(opts.windDir500, 290),
      temperature_500hPa: new Array(n).fill(-25),
      geopotential_height_500hPa: new Array(n).fill(5500),
    },
  };
}

// ── Empty / malformed input ──────────────────────────

describe('parseSynopticPayload — empty inputs', () => {
  it('returns empty arrays on null payload', () => {
    // @ts-expect-error testing runtime defensive path
    const r = parseSynopticPayload(null, 'embalse');
    expect(r.upperAir).toEqual([]);
    expect(r.convection).toEqual([]);
  });

  it('returns empty arrays when hourly missing', () => {
    // @ts-expect-error testing missing-key defensive path
    const r = parseSynopticPayload({}, 'embalse');
    expect(r.upperAir).toEqual([]);
    expect(r.convection).toEqual([]);
  });

  it('returns empty arrays when time missing', () => {
    // @ts-expect-error testing missing time array defensive path
    const r = parseSynopticPayload({ hourly: {} }, 'embalse');
    expect(r.upperAir).toEqual([]);
    expect(r.convection).toEqual([]);
  });

  it('returns empty arrays for empty time array', () => {
    const r = parseSynopticPayload({ hourly: { time: [] } } as never, 'embalse');
    expect(r.upperAir).toEqual([]);
    expect(r.convection).toEqual([]);
  });
});

// ── Happy path ───────────────────────────────────────

describe('parseSynopticPayload — happy path', () => {
  it('emits 3 upper-air rows per hour (one per pressure level)', () => {
    const r = parseSynopticPayload(makePayload(2), 'embalse');
    expect(r.upperAir).toHaveLength(6); // 2 hours × 3 levels
  });

  it('emits 1 convection row per hour', () => {
    const r = parseSynopticPayload(makePayload(2), 'embalse');
    expect(r.convection).toHaveLength(2);
  });

  it('preserves sector tag on every row', () => {
    const r = parseSynopticPayload(makePayload(1), 'rias');
    for (const row of r.upperAir) expect(row.sector).toBe('rias');
    for (const row of r.convection) expect(row.sector).toBe('rias');
  });

  it('exposes all 3 pressure levels (850/700/500) per hour', () => {
    const r = parseSynopticPayload(makePayload(1), 'embalse');
    const levels = new Set(r.upperAir.map((x) => x.pressureHpa));
    expect(levels).toEqual(new Set([850, 700, 500]));
  });

  it('parses 850hPa wind direction correctly', () => {
    const r = parseSynopticPayload(makePayload(1, { windDir850: [320] }), 'embalse');
    const row = r.upperAir.find((x) => x.pressureHpa === 850)!;
    expect(row.windDirDeg).toBe(320);
  });

  it('parses convection bundle values (precipitable_water always null — not provided by Open-Meteo)', () => {
    const r = parseSynopticPayload(
      makePayload(1, { cape: [1500], cin: [-100], li: [-5], blh: [1200] }),
      'embalse',
    );
    expect(r.convection[0]).toMatchObject({
      cape: 1500, cin: -100, liftedIndex: -5,
      precipitableWater: null, // hardcoded null after S125 hotfix
      boundaryLayerM: 1200,
    });
  });
});

// ── Null handling — sparse data (model gaps) ─────────

describe('parseSynopticPayload — null handling', () => {
  it('keeps rows when SOME values are null but not all', () => {
    // 850hPa has wind dir but no temp/geopot
    const r = parseSynopticPayload(makePayload(1, {
      windDir850: [270], temp850: [null], gph850: [null],
    }), 'embalse');
    const row850 = r.upperAir.find((x) => x.pressureHpa === 850)!;
    expect(row850.windDirDeg).toBe(270);
    expect(row850.temperatureC).toBeNull();
    expect(row850.geopotentialM).toBeNull();
  });

  it('skips a level entirely if all 4 values null at that hour', () => {
    const r = parseSynopticPayload(makePayload(1, {
      windDir850: [null], windSpeed850: [null], temp850: [null], gph850: [null],
    }), 'embalse');
    const row850 = r.upperAir.find((x) => x.pressureHpa === 850);
    expect(row850).toBeUndefined();
    // 700 + 500 still present (their values come from defaults)
    const others = r.upperAir.map((x) => x.pressureHpa).sort();
    expect(others).toEqual([500, 700]);
  });

  it('skips convection row entirely if all 4 indices null', () => {
    const r = parseSynopticPayload(makePayload(1, {
      cape: [null], cin: [null], li: [null], blh: [null],
    }), 'embalse');
    expect(r.convection).toHaveLength(0);
  });

  it('keeps convection row if ANY index has a value', () => {
    const r = parseSynopticPayload(makePayload(1, {
      cape: [1200], cin: [null], li: [null], blh: [null],
    }), 'embalse');
    expect(r.convection).toHaveLength(1);
    expect(r.convection[0].cape).toBe(1200);
    expect(r.convection[0].precipitableWater).toBeNull();
  });
});

// ── Time parsing ─────────────────────────────────────

describe('parseSynopticPayload — time parsing', () => {
  it('skips rows with unparseable timestamps', () => {
    const payload = makePayload(2);
    payload.hourly.time[1] = 'not-a-date';
    const r = parseSynopticPayload(payload, 'embalse');
    // Hour 0 valid (3 levels) + hour 1 skipped → only 3 upper-air rows
    expect(r.upperAir).toHaveLength(3);
    expect(r.convection).toHaveLength(1);
  });

  it('parses ISO timestamps to Date objects', () => {
    const r = parseSynopticPayload(makePayload(1), 'embalse');
    expect(r.upperAir[0].time).toBeInstanceOf(Date);
    expect(r.convection[0].time).toBeInstanceOf(Date);
  });
});
