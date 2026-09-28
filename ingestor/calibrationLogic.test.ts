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
  combinedReferenceAt,
  pairWithCombinedReference,
  summariseReference,
  shouldRunCalibration,
  confirmDeadByPeers,
  isBlindTo,
  type StationCalibration,
  COMBINED_REFERENCE_SITES,
  COMBINED_REFERENCE_ID,
  type PairedHour,
  type SiteHour,
  type StationHour,
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

// ── The combined reference ───────────────────────────────────────────────

const ONS = 'mg_10126', SALVORA = 'mg_10134', UDRA = 'mg_10905', LANZADA = 'mg_19069';
const site = (siteId: string, ms: number, dirDeg: number | null, t = 1000): SiteHour => ({ siteId, t, ms, dirDeg });

describe('combinedReferenceAt — the free stream from four exposed sites', () => {
  it('takes the median of the sites, so one odd site cannot set it', () => {
    const ref = combinedReferenceAt([site(ONS, 8, 225), site(SALVORA, 9, 220), site(UDRA, 7, 230), site(LANZADA, 20, 225)]);
    expect(ref!.ms).toBeCloseTo(8.5, 5);
    expect(ref!.sites).toBe(4);
    expect(ref!.dirDeg).toBeGreaterThan(215);
    expect(ref!.dirDeg).toBeLessThan(235);
  });

  it('drops Ons with a north-westerly, where the island shelters its mast', () => {
    const ref = combinedReferenceAt([site(ONS, 2, 315), site(SALVORA, 8, 315), site(UDRA, 7, 312), site(LANZADA, 9, 318)]);
    expect(ref!.sites).toBe(3);
    expect(ref!.ms).toBe(8);
  });

  it('drops Cabo Udra with a westerly and with a north-easterly', () => {
    expect(combinedReferenceAt([site(UDRA, 1, 270), site(SALVORA, 8, 270), site(LANZADA, 6, 268)])!.sites).toBe(2);
    expect(combinedReferenceAt([site(UDRA, 1, 45), site(SALVORA, 8, 45), site(ONS, 6, 48)])!.sites).toBe(2);
  });

  it('decides the blind sector on the direction everyone agrees on, not on the sheltered vane', () => {
    // Ons's own vane, bent by the island, says 280 (clear of its NW arc); the
    // other three say NW. Ons is blind to what is really blowing and goes.
    const ref = combinedReferenceAt([site(ONS, 2, 280), site(SALVORA, 8, 320), site(UDRA, 7, 318), site(LANZADA, 9, 322)]);
    expect(ref!.sites).toBe(3);
    expect(ref!.ms).toBe(8);
  });

  it('refuses an hour with fewer than two sites clear of their blind sector', () => {
    expect(combinedReferenceAt([site(SALVORA, 8, 225)])).toBeNull();
    // Two reported, but with a westerly Udra is blind: one site left.
    expect(combinedReferenceAt([site(UDRA, 3, 270), site(SALVORA, 8, 270)])).toBeNull();
  });

  it('ignores calm and direction-less readings rather than letting them pull the median', () => {
    expect(combinedReferenceAt([site(ONS, 0, 200), site(SALVORA, 8, null), site(UDRA, 6, 200)])).toBeNull();
  });

  it('can leave one site out, so a site is never measured against itself', () => {
    const rows = [site(ONS, 8, 225), site(SALVORA, 10, 225), site(UDRA, 6, 225)];
    expect(combinedReferenceAt(rows, COMBINED_REFERENCE_SITES, SALVORA)!.ms).toBe(7);
  });

  it('knows the blind arcs', () => {
    const udra = COMBINED_REFERENCE_SITES.find((s) => s.id === UDRA)!;
    expect(isBlindTo(udra, 270)).toBe(true);
    expect(isBlindTo(udra, 45 + 360)).toBe(true);
    expect(isBlindTo(udra, 225)).toBe(false);
  });
});

describe('pairWithCombinedReference', () => {
  const hours: SiteHour[] = [
    site(ONS, 8, 225, 1000), site(SALVORA, 10, 225, 1000), site(UDRA, 6, 225, 1000),
    // An hour with a single site: no reference, the station hour is dropped.
    site(SALVORA, 9, 225, 2000),
  ];
  const st = (stationId: string, t: number, ms: number): StationHour => ({ stationId, t, day: '2026-09-29', ms });

  it('pairs each station hour with that hour\'s reference and marks the row as combined', () => {
    const pairs = pairWithCombinedReference([st('mg_14001', 1000, 4), st('mg_14001', 2000, 4)], hours);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ stationId: 'mg_14001', buoyId: COMBINED_REFERENCE_ID, stationMs: 4, buoyMs: 8 });
    expect(COMBINED_REFERENCE_ID).toBe(0);
  });

  it('measures a reference site against the OTHER sites', () => {
    // Against a median that includes itself Salvora would read 10/8; against
    // Ons and Udra it is 10/7.
    const [p] = pairWithCombinedReference([st(SALVORA, 1000, 10)], hours);
    expect(p.buoyMs).toBe(7);
  });

  it('feeds calibrateStations: a station reading half the free stream comes out at 0.5', () => {
    const siteHours: SiteHour[] = [];
    const stationHours: StationHour[] = [];
    for (let i = 0; i < 200; i++) {
      const t = 3600 * i;
      const day = 1 + Math.floor(i / 9);
      const free = 3 + (day % 9);
      siteHours.push(site(ONS, free, 225, t), site(SALVORA, free, 225, t), site(LANZADA, free, 225, t));
      stationHours.push({ stationId: 'wu_X', t, day: `2026-07-${String(day).padStart(2, '0')}`, ms: free * 0.5 });
    }
    const [row] = calibrateStations(pairWithCombinedReference(stationHours, siteHours));
    expect(row.ratio).toBeCloseTo(0.5, 5);
    expect(row.buoyId).toBe(COMBINED_REFERENCE_ID);
    expect(row.status).toBe('sheltered');
  });

  it('says in the log how often each site made it into the reference', () => {
    const line = summariseReference(hours);
    expect(line).toMatch(/^1 reference hours of 2/);
    expect(line).toMatch(/Ons 1, Sálvora 1, Cabo Udra 1, A Lanzada 0/);
  });
});

describe('shouldRunCalibration — once a night, in the small hours', () => {
  const H = 3_600_000;
  const now = Date.UTC(2026, 8, 29, 2, 0); // 04:00 in Madrid

  it('runs the first time ever, whatever the hour', () => {
    expect(shouldRunCalibration(null, now, 13)).toBe(true);
  });

  it('runs inside the slot once a night has passed', () => {
    expect(shouldRunCalibration(now - 24 * H, now, 4)).toBe(true);
  });

  it('does not run at midday just because the ingestor restarted', () => {
    expect(shouldRunCalibration(now - 24 * H, now, 13)).toBe(false);
  });

  it('does not run twice in the same slot', () => {
    expect(shouldRunCalibration(now - 1 * H, now, 4)).toBe(false);
  });

  it('runs at any hour once two nights were missed', () => {
    expect(shouldRunCalibration(now - 45 * H, now, 13)).toBe(true);
  });
});

describe('confirmDeadByPeers — a second witness before calling an anemometer dead', () => {
  // 30 days of afternoons; the local breeze at the head of the ría has its own
  // day-to-day rhythm, unrelated to the open coast.
  const local = (d: number) => 2 + ((d * 7) % 5);
  const hoursOf = (stationId: string, f: (d: number) => number): StationHour[] =>
    Array.from({ length: 30 }, (_, d) => ({ stationId, t: d * 86400, day: `2026-08-${String(d + 1).padStart(2, '0')}`, ms: f(d) }));
  const row = (stationId: string, status: StationCalibration['status']): StationCalibration => ({
    stationId, buoyId: 0, status, ratio: 0.3, hours: 300, correlation: 0.1, days: 30, stationMeanMs: 1, buoyMeanMs: 3, sectors: [],
  });
  const positions = new Map([
    ['wu_IREDON16', { lat: 42.283, lon: -8.609 }],
    ['aemet_1495', { lat: 42.29, lon: -8.63 }],      // ~2 km
    ['far_station', { lat: 42.45, lon: -8.9 }],      // ~30 km
  ]);

  it('turns dead into unreferenced when a working neighbour moves with it (Redondela, 28-sep)', () => {
    const hours = [...hoursOf('wu_IREDON16', (d) => 0.4 * local(d)), ...hoursOf('aemet_1495', local)];
    const { rows, rescued } = confirmDeadByPeers([row('wu_IREDON16', 'dead'), row('aemet_1495', 'sheltered')], hours, positions);
    expect(rows.find((r) => r.stationId === 'wu_IREDON16')!.status).toBe('unreferenced');
    expect(rescued[0]).toMatchObject({ stationId: 'wu_IREDON16', peerId: 'aemet_1495' });
    expect(rescued[0].correlation).toBeGreaterThan(0.99);
  });

  it('keeps it dead when it follows nobody', () => {
    const hours = [...hoursOf('wu_IREDON16', (d) => 0.3 + ((d * 13) % 3) * 0.1), ...hoursOf('aemet_1495', local)];
    const { rows, rescued } = confirmDeadByPeers([row('wu_IREDON16', 'dead'), row('aemet_1495', 'sheltered')], hours, positions);
    expect(rows[0].status).toBe('dead');
    expect(rescued).toHaveLength(0);
  });

  it('cannot rescue a frozen sensor: a constant series correlates with nothing', () => {
    const hours = [...hoursOf('wu_IREDON16', () => 0), ...hoursOf('aemet_1495', local)];
    expect(confirmDeadByPeers([row('wu_IREDON16', 'dead'), row('aemet_1495', 'sheltered')], hours, positions).rows[0].status).toBe('dead');
  });

  it('only listens to neighbours that respond themselves, and only nearby ones', () => {
    const hours = [...hoursOf('wu_IREDON16', local), ...hoursOf('aemet_1495', local), ...hoursOf('far_station', local)];
    // Two dead stations cannot vouch for each other...
    expect(confirmDeadByPeers([row('wu_IREDON16', 'dead'), row('aemet_1495', 'dead')], hours, positions).rows[0].status).toBe('dead');
    // ...and a responder 30 km away answers to another wind.
    expect(confirmDeadByPeers([row('wu_IREDON16', 'dead'), row('far_station', 'sheltered')], hours, positions).rows[0].status).toBe('dead');
  });
});
