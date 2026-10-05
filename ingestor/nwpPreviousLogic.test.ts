import { describe, it, expect } from 'vitest';
import {
  buildPreviousRunsUrl,
  nwpAllPoints,
  nwpFetchPlan,
  nwpFetchWindow,
  nwpModelPoints,
  nwpPoints,
  nwpSpotPoints,
  nwpStationPoints,
  parsePreviousRuns,
  NWP_BACKFILL_MAX_POINTS,
  NWP_BACKFILL_MAX_REQUESTS,
  NWP_BUOYS,
  NWP_BACKFILL_START,
  NWP_MAX_AHEAD_H,
  NWP_STATION_BACKFILL_START,
  NWP_TMIN_STATIONS,
} from './nwpPreviousLogic';

const points = nwpPoints();

/** The shape Open-Meteo returned on 28-sep for one coordinate (timezone=GMT, knots). */
const payload = (kts: (number | null)[], start = '2026-09-28T00:00') => {
  const t0 = Date.parse(`${start}:00Z`);
  const time = kts.map((_, i) => new Date(t0 + i * 3_600_000).toISOString().slice(0, 16));
  return {
    latitude: 42.25, longitude: -8.75, timezone: 'GMT',
    hourly: {
      time,
      wind_speed_10m_previous_day1: kts,
      wind_direction_10m_previous_day1: kts.map(() => 225),
      wind_gusts_10m_previous_day1: kts.map((k) => (k == null ? null : k * 1.5)),
      temperature_2m_previous_day1: kts.map(() => 14.5),
      cloud_cover_previous_day1: kts.map(() => 30),
    },
  };
};

describe('nwpPoints', () => {
  it('uses the five buoys the wind model predicts, with their coordinates', () => {
    expect(points.map((p) => p.id)).toEqual(NWP_BUOYS.map((id) => `boya:${id}`));
    expect(points[0]).toMatchObject({ id: 'boya:3221', lat: 42.24, lon: -8.73 });
  });

  it('adds every spot of both sectors, latitude and longitude the right way round', () => {
    const spots = nwpSpotPoints();
    expect(spots.length).toBeGreaterThanOrEqual(14);
    expect(spots.find((p) => p.id === 'spot:cesantes')).toMatchObject({ lat: 42.307, lon: -8.619 });
    expect(spots.find((p) => p.id === 'spot:castrelo')).toMatchObject({ lat: 42.2991, lon: -8.1087 });
    // A swapped [lon, lat] would put every point in the Indian Ocean: all must fall in Galicia.
    for (const p of spots) {
      expect(p.lat).toBeGreaterThan(41.8); expect(p.lat).toBeLessThan(43.9);
      expect(p.lon).toBeGreaterThan(-9.4); expect(p.lon).toBeLessThan(-6.7);
    }
  });

  it('keeps the buoys first and every id unique', () => {
    const all = nwpAllPoints();
    expect(all.slice(0, 5).map((p) => p.id)).toEqual(NWP_BUOYS.map((id) => `boya:${id}`));
    expect(new Set(all.map((p) => p.id)).size).toBe(all.length);
  });
});

describe('buildPreviousRunsUrl', () => {
  it('asks for the day-before series of every point in one request, in knots and UTC', () => {
    const url = new URL(buildPreviousRunsUrl(points, '2026-09-26', '2026-09-29'));
    expect(url.hostname).toBe('previous-runs-api.open-meteo.com');
    expect(url.searchParams.get('latitude')!.split(',')).toHaveLength(5);
    expect(url.searchParams.get('hourly')).toBe('wind_speed_10m_previous_day1,wind_direction_10m_previous_day1,wind_gusts_10m_previous_day1,temperature_2m_previous_day1,cloud_cover_previous_day1');
    expect(url.searchParams.get('wind_speed_unit')).toBe('kn');
    expect(url.searchParams.get('timezone')).toBe('GMT');
    expect(url.searchParams.has('models')).toBe(false);   // the default model: what the buoys have always stored
  });

  it('names the model for the extra-model points and refuses to mix models in one request', () => {
    const ecmwf = nwpModelPoints().filter((p) => p.id.startsWith('ecmwf@'));
    expect(new URL(buildPreviousRunsUrl(ecmwf, '2026-10-01', '2026-10-03')).searchParams.get('models')).toBe('ecmwf_ifs025');
    expect(() => buildPreviousRunsUrl([points[0], ecmwf[0]], '2026-10-01', '2026-10-03')).toThrow(/modelos distintos/);
  });
});

describe('nwpModelPoints', () => {
  it('are the five buoys once per extra model, never starting with "boya" (the production model reads point LIKE boya%)', () => {
    const mp = nwpModelPoints();
    expect(mp).toHaveLength(15);
    expect(mp.map((p) => p.id)).toContain('ecmwf@boya:3221');
    expect(mp.map((p) => p.id)).toContain('ukmo@boya:4273');
    expect(mp.every((p) => !p.id.startsWith('boya'))).toBe(true);
    expect(new Set(mp.map((p) => p.model))).toEqual(new Set(['ecmwf_ifs025', 'gfs_seamless', 'ukmo_seamless']));
    expect(mp.find((p) => p.id === 'gfs@boya:3221')).toMatchObject({ lat: 42.24, lon: -8.73 });
  });
});

describe('nwpStationPoints', () => {
  it('keeps the overnight-minimum stations with coordinates in Galicia, with their short history start', () => {
    const rows = [
      { station_id: 'mg_19044', latitude: 42.24, longitude: -8.131 },
      { station_id: 'aemet_1690A', latitude: 42.3253, longitude: -7.8597 },
      { station_id: 'mg_99999', latitude: 42.3, longitude: -8.1 },     // not a station of the model
      { station_id: 'mg_19032', latitude: null, longitude: null },     // no coordinates
      { station_id: 'mg_19026', latitude: -8.118, longitude: 42.359 }, // swapped: out
    ];
    const pts = nwpStationPoints(rows);
    expect(pts.map((p) => p.id)).toEqual(['est:aemet_1690A', 'est:mg_19044']);
    expect(pts.every((p) => p.backfillStart === NWP_STATION_BACKFILL_START && p.model === undefined)).toBe(true);
    expect(NWP_TMIN_STATIONS).toHaveLength(47);
  });
});

describe('parsePreviousRuns', () => {
  const now = Date.parse('2026-09-28T02:30:00Z');

  it('turns every point and hour into a row, times in UTC', () => {
    const rows = parsePreviousRuns(points.map(() => payload([5, 6, 7])), points, now);
    expect(rows).toHaveLength(15);
    expect(rows[0]).toMatchObject({ point: 'boya:3221', leadDays: 1, windKt: 5, windDir: 225, gustKt: 7.5, tempC: 14.5, cloudPct: 30 });
    expect(rows[0].validTime.toISOString()).toBe('2026-09-28T00:00:00.000Z');
    expect(rows[5].point).toBe('boya:3223');
  });

  it('stores nothing further ahead than the archive has settled', () => {
    const hours = Array.from({ length: 48 }, () => 8);
    const rows = parsePreviousRuns(points.map(() => payload(hours)), points, now);
    const last = Math.max(...rows.map((r) => r.validTime.getTime()));
    expect(last).toBeLessThanOrEqual(now + NWP_MAX_AHEAD_H * 3_600_000);
  });

  it('skips hours without a value instead of storing a zero', () => {
    const rows = parsePreviousRuns(points.map(() => payload([null, 4])), points, now);
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.windKt === 4)).toBe(true);
  });

  it('refuses a reply with a different number of series: a wrong buoy is worse than none', () => {
    expect(() => parsePreviousRuns([payload([5])], points, now)).toThrow(/1 series para 5 puntos/);
  });

  it('accepts the single-object reply Open-Meteo gives for one coordinate', () => {
    expect(parsePreviousRuns(payload([5]), [points[0]], now)).toHaveLength(1);
  });

  it('leaves temperature and cloud empty when a reply does not bring them', () => {
    const p = payload([5]);
    delete (p.hourly as Record<string, unknown>).temperature_2m_previous_day1;
    expect(parsePreviousRuns(p, [points[0]], now)[0]).toMatchObject({ windKt: 5, tempC: null, cloudPct: 30 });
  });
});

describe('nwpFetchPlan', () => {
  const now = Date.parse('2026-09-28T12:00:00Z');
  const all = nwpAllPoints();
  const full = Date.parse('2026-03-01T00:00:00Z');

  it('asks the recent window for the buoys and the whole history only for the new spots, in chunks', () => {
    const oldest = new Map(nwpPoints().map((p) => [p.id, full]));
    const plan = nwpFetchPlan(all, oldest, now);
    expect(plan[0]).toMatchObject({ backfill: false, start: '2026-09-26', end: '2026-09-29', model: 'best_match' });
    expect(plan[0].points.map((p) => p.id)).toEqual(NWP_BUOYS.map((id) => `boya:${id}`));
    const hist = plan.slice(1);
    expect(hist.length).toBeGreaterThanOrEqual(1);
    expect(hist.every((r) => r.backfill && r.start === NWP_BACKFILL_START && r.points.length <= NWP_BACKFILL_MAX_POINTS)).toBe(true);
    expect(hist.flatMap((r) => r.points).every((p) => p.id.startsWith('spot:'))).toBe(true);
  });

  it('puts the default model first and caps the history requests of one cycle', () => {
    const stations = nwpStationPoints(NWP_TMIN_STATIONS.map((id, i) => ({ station_id: id, latitude: 42 + i / 100, longitude: -8 })));
    const pts = [...all, ...nwpModelPoints(), ...stations];
    const oldest = new Map(all.map((p) => [p.id, full]));
    const plan = nwpFetchPlan(pts, oldest, now);
    expect(plan[0].model).toBe('best_match');
    expect(plan[0].backfill).toBe(false);
    const hist = plan.filter((r) => r.backfill);
    expect(hist.length).toBe(NWP_BACKFILL_MAX_REQUESTS);
    expect(hist[0].model).toBe('best_match');                       // the stations before the other models
    expect(hist[0]).toMatchObject({ start: NWP_STATION_BACKFILL_START });
    // Everything asked in a cycle respects the per-minute budget: no request above the chunk size.
    expect(hist.every((r) => r.points.length <= NWP_BACKFILL_MAX_POINTS)).toBe(true);
  });

  it('once every point has its history: one recent request per model', () => {
    const pts = [...all, ...nwpModelPoints()];
    const oldest = new Map(pts.map((p) => [p.id, full]));
    const plan = nwpFetchPlan(pts, oldest, now);
    expect(plan.map((r) => r.model)).toEqual(['best_match', 'ecmwf_ifs025', 'gfs_seamless', 'ukmo_seamless']);
    expect(plan.every((r) => !r.backfill)).toBe(true);
    expect(plan[1].points.map((p) => p.id)).toEqual(NWP_BUOYS.map((id) => `ecmwf@boya:${id}`));
  });

  it('is a single recent request once every point has its history', () => {
    const oldest = new Map(all.map((p) => [p.id, full]));
    const plan = nwpFetchPlan(all, oldest, now);
    expect(plan).toHaveLength(1);
    expect(plan[0].backfill).toBe(false);
    expect(plan[0].points).toHaveLength(all.length);
  });

  it('is only history requests, chunked, on an empty table', () => {
    const plan = nwpFetchPlan(all, new Map(), now);
    expect(plan.length).toBe(Math.min(NWP_BACKFILL_MAX_REQUESTS, Math.ceil(all.length / NWP_BACKFILL_MAX_POINTS)));
    expect(plan.every((r) => r.backfill)).toBe(true);
    expect(plan[0].points.map((p) => p.id).slice(0, 5)).toEqual(NWP_BUOYS.map((id) => `boya:${id}`));
  });
});

describe('nwpFetchWindow', () => {
  const now = Date.parse('2026-09-28T12:00:00Z');

  it('brings the whole training history when the table is empty or does not reach it', () => {
    expect(nwpFetchWindow(null, now)).toEqual({ start: NWP_BACKFILL_START, end: '2026-09-29', backfill: true });
    expect(nwpFetchWindow(Date.parse('2026-09-20T00:00:00Z'), now).backfill).toBe(true);
  });

  it('then only the last two days and tomorrow', () => {
    expect(nwpFetchWindow(Date.parse('2026-03-01T00:00:00Z'), now)).toEqual({ start: '2026-09-26', end: '2026-09-29', backfill: false });
  });

  it('measures the history against the point own start', () => {
    expect(nwpFetchWindow(Date.parse('2026-08-15T00:00:00Z'), now, NWP_STATION_BACKFILL_START).backfill).toBe(false);
    expect(nwpFetchWindow(Date.parse('2026-09-01T00:00:00Z'), now, NWP_STATION_BACKFILL_START))
      .toEqual({ start: NWP_STATION_BACKFILL_START, end: '2026-09-29', backfill: true });
  });
});
