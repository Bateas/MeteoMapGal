import { describe, it, expect } from 'vitest';
import {
  buildPreviousRunsUrl,
  nwpFetchWindow,
  nwpPoints,
  parsePreviousRuns,
  NWP_BUOYS,
  NWP_BACKFILL_START,
  NWP_MAX_AHEAD_H,
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
    },
  };
};

describe('nwpPoints', () => {
  it('uses the five buoys the wind model predicts, with their coordinates', () => {
    expect(points.map((p) => p.id)).toEqual(NWP_BUOYS.map((id) => `boya:${id}`));
    expect(points[0]).toMatchObject({ buoyId: 3221, lat: 42.24, lon: -8.73 });
  });
});

describe('buildPreviousRunsUrl', () => {
  it('asks for the day-before series of every point in one request, in knots and UTC', () => {
    const url = new URL(buildPreviousRunsUrl(points, '2026-09-26', '2026-09-29'));
    expect(url.hostname).toBe('previous-runs-api.open-meteo.com');
    expect(url.searchParams.get('latitude')!.split(',')).toHaveLength(5);
    expect(url.searchParams.get('hourly')).toBe('wind_speed_10m_previous_day1,wind_direction_10m_previous_day1,wind_gusts_10m_previous_day1');
    expect(url.searchParams.get('wind_speed_unit')).toBe('kn');
    expect(url.searchParams.get('timezone')).toBe('GMT');
  });
});

describe('parsePreviousRuns', () => {
  const now = Date.parse('2026-09-28T02:30:00Z');

  it('turns every point and hour into a row, times in UTC', () => {
    const rows = parsePreviousRuns(points.map(() => payload([5, 6, 7])), points, now);
    expect(rows).toHaveLength(15);
    expect(rows[0]).toMatchObject({ point: 'boya:3221', leadDays: 1, windKt: 5, windDir: 225, gustKt: 7.5 });
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
});
