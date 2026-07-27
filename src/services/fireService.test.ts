/**
 * Tests for fireService — NASA FIRMS CSV parser + filtering + aggregation.
 *
 * Pure functions. Bug here = wrong fire counts on the map / silenced alerts.
 */

import { describe, it, expect } from 'vitest';
import {
  parseFirmsCsv,
  parseConfidence,
  filterRealFires,
  aggregateFiresForSector,
  formatFireAge,
  mergeFirmsCsv,
} from './fireService';
import { clusterFires } from './fireClustering';
import type { ActiveFire } from '../types/fire';

const HEADER =
  'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,' +
  'instrument,confidence,version,bright_ti5,frp,daynight';

function row(parts: Partial<{
  lat: number; lon: number; bright: number; scan: number; track: number;
  date: string; time: string; sat: string; conf: string; frp: number; daynight: string;
}> = {}): string {
  return [
    parts.lat ?? 42.3,
    parts.lon ?? -8.5,
    parts.bright ?? 340,
    parts.scan ?? 0.41,
    parts.track ?? 0.41,
    parts.date ?? '2026-04-27',
    parts.time ?? '1242',
    parts.sat ?? 'N',
    'VIIRS',
    parts.conf ?? 'n',
    '2.0NRT',
    290,
    parts.frp ?? 12.5,
    parts.daynight ?? 'D',
  ].join(',');
}

// ── parseFirmsCsv ────────────────────────────────────

describe('parseFirmsCsv', () => {
  it('returns empty array for empty input', () => {
    expect(parseFirmsCsv('')).toEqual([]);
  });

  it('returns empty array when only header (no data rows)', () => {
    expect(parseFirmsCsv(HEADER)).toEqual([]);
  });

  it('parses a single row from the live API sample', () => {
    const csv = HEADER + '\n42.46383,-8.7895,327.06,0.41,0.61,2026-04-27,1242,N,VIIRS,n,2.0NRT,295.29,2.55,D';
    const fires = parseFirmsCsv(csv);
    expect(fires).toHaveLength(1);
    expect(fires[0].lat).toBeCloseTo(42.46383, 4);
    expect(fires[0].lon).toBeCloseTo(-8.7895, 4);
    expect(fires[0].brightness).toBeCloseTo(327.06, 2);
    expect(fires[0].frp).toBeCloseTo(2.55, 2);
    expect(fires[0].confidence).toBe('nominal');
    expect(fires[0].daynight).toBe('D');
    expect(fires[0].acquiredAt.toISOString()).toBe('2026-04-27T12:42:00.000Z');
  });

  it('handles HHMM time without leading zero (FIRMS quirk)', () => {
    // "258" means 02:58 UTC, NOT "258 minutes past midnight"
    const csv = HEADER + '\n' + row({ time: '258' });
    const fires = parseFirmsCsv(csv);
    expect(fires[0].acquiredAt.toISOString()).toBe('2026-04-27T02:58:00.000Z');
  });

  it('maps confidence letter h/n/l', () => {
    const csv = [HEADER, row({ conf: 'h' }), row({ conf: 'n' }), row({ conf: 'l' })].join('\n');
    const fires = parseFirmsCsv(csv);
    expect(fires.map((f) => f.confidence)).toEqual(['high', 'nominal', 'low']);
  });

  it('skips rows with non-numeric lat/lon', () => {
    const csv = [HEADER, row({ lat: NaN as never })].join('\n');
    expect(parseFirmsCsv(csv)).toEqual([]);
  });

  it('skips rows with too few columns', () => {
    const csv = HEADER + '\n42.3,-8.5,340,0.41,0.41,2026-04-27,1242';
    expect(parseFirmsCsv(csv)).toEqual([]);
  });

  it('generates stable composite IDs', () => {
    const csv = [HEADER, row(), row()].join('\n');
    const fires = parseFirmsCsv(csv);
    // Two identical rows → same ID (sensible: same pixel + same timestamp)
    expect(fires[0].id).toBe(fires[1].id);
  });

  it('parses multiple rows', () => {
    const csv = [HEADER, row(), row({ lat: 42.5 }), row({ lat: 42.7 })].join('\n');
    expect(parseFirmsCsv(csv)).toHaveLength(3);
  });

  it('handles trailing blank lines / CRLF', () => {
    const csv = HEADER + '\r\n' + row() + '\r\n\r\n';
    expect(parseFirmsCsv(csv)).toHaveLength(1);
  });
});

// ── filterRealFires ──────────────────────────────────

describe('filterRealFires', () => {
  it('drops low-confidence detections', () => {
    const csv = [HEADER, row({ conf: 'l' }), row({ conf: 'n' }), row({ conf: 'h' })].join('\n');
    const fires = parseFirmsCsv(csv);
    expect(filterRealFires(fires)).toHaveLength(2);
  });

  it('applies the 320K floor by day', () => {
    const csv = [HEADER, row({ bright: 310 }), row({ bright: 320 }), row({ bright: 350 })].join('\n');
    // 320K is the boundary (>=)
    expect(filterRealFires(parseFirmsCsv(csv))).toHaveLength(2);
  });

  it('does NOT apply the daytime floor at night', () => {
    // Against a cold background the same fire reads ~30K cooler. The live feed
    // has its nocturnal median at 313K, so 320K would delete most night fires.
    const csv = [
      HEADER,
      row({ bright: 300, daynight: 'N' }),
      row({ bright: 313, daynight: 'N' }),
      row({ bright: 319, daynight: 'N' }),
    ].join('\n');
    expect(filterRealFires(parseFirmsCsv(csv))).toHaveLength(3);
  });

  it('keeps the real Galician hotspot that the old blanket floor threw away', () => {
    // 43.346,-8.436 at 303.78K — a genuine night detection inside Galicia,
    // discarded for months for being "too cool".
    const csv = HEADER + '\n' + row({ lat: 43.346, lon: -8.436, bright: 303.78, daynight: 'N' });
    expect(filterRealFires(parseFirmsCsv(csv))).toHaveLength(1);
  });

  it('still floors the night at the VIIRS nocturnal threshold', () => {
    const csv = [HEADER, row({ bright: 290, daynight: 'N' }), row({ bright: 295, daynight: 'N' })].join('\n');
    expect(filterRealFires(parseFirmsCsv(csv))).toHaveLength(1);
  });

  it('keeps high-confidence + hot signature', () => {
    const csv = HEADER + '\n' + row({ conf: 'h', bright: 400 });
    expect(filterRealFires(parseFirmsCsv(csv))).toHaveLength(1);
  });
});

// ── parseConfidence ──────────────────────────────────

describe('parseConfidence', () => {
  it('reads the Area-API letters', () => {
    expect(parseConfidence('h')).toBe('high');
    expect(parseConfidence('n')).toBe('nominal');
    expect(parseConfidence('l')).toBe('low');
  });

  it('reads the whole words the bulk regional CSVs use', () => {
    // Verified live: the Europe 24h bulk feed ships "nominal"/"high"/"low".
    expect(parseConfidence('high')).toBe('high');
    expect(parseConfidence('nominal')).toBe('nominal');
    expect(parseConfidence('LOW')).toBe('low');
  });

  it('maps the MODIS 0-100 percentage', () => {
    expect(parseConfidence('95')).toBe('high');
    expect(parseConfidence('80')).toBe('high');
    expect(parseConfidence('50')).toBe('nominal');
    expect(parseConfidence('12')).toBe('low');
  });

  it('treats an unknown format as nominal, never silently switching the layer off', () => {
    expect(parseConfidence('confianza-alta')).toBe('nominal');
    expect(parseConfidence('')).toBe('nominal');
  });
});

// ── aggregateFiresForSector ──────────────────────────

const cesantesCenter: [number, number] = [-8.62, 42.31]; // Rías sector

const NOW = new Date('2026-07-26T18:00:00Z').getTime();

/** A detection, `ageMin` minutes before NOW. */
function fire(lat: number, lon: number, frp = 10, ageMin = 30): ActiveFire {
  return {
    id: `${lat}_${lon}_${ageMin}`,
    lat,
    lon,
    brightness: 340,
    frp,
    acquiredAt: new Date(NOW - ageMin * 60_000),
    satellite: 'N',
    confidence: 'nominal',
    daynight: 'D',
  };
}

/** Cluster the way production does, so the tests exercise the real path. */
function clustersAt(...fires: ActiveFire[]) {
  return clusterFires(fires);
}

describe('aggregateFiresForSector', () => {
  it('returns severity none for an empty list', () => {
    const r = aggregateFiresForSector([], cesantesCenter, undefined, undefined, NOW);
    expect(r.severity).toBe('none');
    expect(r.fireCount).toBe(0);
    expect(r.nearest).toBeNull();
  });

  it('stays SILENT about a fire beyond the mention range', () => {
    // The Bragança/Zamora case: ~178km away. Real, and none of our business.
    const r = aggregateFiresForSector(
      clustersAt(fire(41.8, -6.75)), cesantesCenter, undefined, undefined, NOW,
    );
    expect(r.severity).toBe('none');
    expect(r.fireCount).toBe(0);
    expect(r.relevant).toEqual([]);
  });

  it('mentions a mid-range fire as aviso, with distance and bearing', () => {
    // ~55km south — the Portugal case that was being announced as if local.
    const r = aggregateFiresForSector(
      clustersAt(fire(41.815, -8.62)), cesantesCenter, undefined, undefined, NOW,
    );
    expect(r.severity).toBe('aviso');
    expect(r.fireCount).toBe(1);
    expect(r.nearest?.distanceKm).toBeGreaterThan(45);
    expect(r.nearest?.distanceKm).toBeLessThan(65);
    expect(r.nearest?.bearing).toBe('sur');
  });

  it('escalates to alerta inside the near band', () => {
    const r = aggregateFiresForSector(
      clustersAt(fire(42.40, -8.62)), cesantesCenter, undefined, undefined, NOW,
    );
    expect(r.severity).toBe('alerta');
    expect(r.nearest!.distanceKm).toBeLessThan(15);
  });

  it('counts FIRES, not hotspot pixels — the bug this whole change is about', () => {
    // One fire: two satellites, two passes, several contiguous pixels. The old
    // code called this six "focos activos".
    const r = aggregateFiresForSector(
      clustersAt(
        fire(42.40, -8.620, 30, 20),
        fire(42.402, -8.620, 25, 20),
        fire(42.401, -8.618, 12, 20),
        fire(42.40, -8.620, 28, 70),
        fire(42.402, -8.620, 20, 70),
        fire(42.401, -8.617, 10, 70),
      ),
      cesantesCenter, undefined, undefined, NOW,
    );
    expect(r.fireCount).toBe(1);
    expect(r.hotspotCount).toBe(6);
    // Intensity = newest pass only (30+25+12), never the day's running total.
    expect(r.maxFrpMw).toBe(67);
  });

  it('ignores fires too old to still be called active', () => {
    const r = aggregateFiresForSector(
      clustersAt(fire(42.40, -8.62, 10, 20 * 60)), cesantesCenter, undefined, undefined, NOW,
    );
    expect(r.severity).toBe('none');
    expect(r.fireCount).toBe(0);
  });

  it('orders by distance and reports the nearest', () => {
    const r = aggregateFiresForSector(
      clustersAt(fire(42.75, -8.62, 5), fire(42.45, -8.62, 5), fire(40.0, -3.0, 5)),
      cesantesCenter, undefined, undefined, NOW,
    );
    expect(r.fireCount).toBe(2); // the Madrid one is out of range
    expect(r.nearest!.distanceKm).toBeLessThan(20);
    expect(r.relevant[0].distanceKm).toBeLessThan(r.relevant[1].distanceKm);
  });

  it('names the direction of the fire from the sector', () => {
    const north = aggregateFiresForSector(
      clustersAt(fire(42.75, -8.62)), cesantesCenter, undefined, undefined, NOW,
    );
    const east = aggregateFiresForSector(
      clustersAt(fire(42.31, -8.10)), cesantesCenter, undefined, undefined, NOW,
    );
    expect(north.nearest?.bearing).toBe('norte');
    expect(east.nearest?.bearing).toBe('este');
  });

  it('respects custom bands', () => {
    const far = clustersAt(fire(41.8, -6.75)); // ~178km
    expect(
      aggregateFiresForSector(far, cesantesCenter, 50, 200, NOW).severity,
    ).toBe('aviso');
  });
});

// ── formatFireAge ────────────────────────────────────

describe('formatFireAge', () => {
  it('says how long ago in plain Spanish', () => {
    expect(formatFireAge(new Date(NOW - 40 * 60_000), NOW)).toBe('hace 40 min');
    expect(formatFireAge(new Date(NOW - 30_000), NOW)).toBe('ahora mismo');
    expect(formatFireAge(new Date(NOW - 95 * 60_000), NOW)).toBe('hace 1 h 35 min');
    expect(formatFireAge(new Date(NOW - 8 * 3600_000), NOW)).toBe('hace 8 h');
  });

  it('never reports a negative age when clocks disagree', () => {
    expect(formatFireAge(new Date(NOW + 60_000), NOW)).toBe('ahora mismo');
  });
});

describe('mergeFirmsCsv', () => {
  const rowA = '42.10,-8.20,330.5,0.4,0.4,2026-07-25,1242,N,VIIRS,n,2.0NRT,290.1,12.5,D';
  const rowB = '42.11,-8.21,335.0,0.4,0.4,2026-07-25,0318,1,VIIRS,h,2.0NRT,295.0,20.0,N';

  it('merges rows from both platforms under a single header', () => {
    const merged = mergeFirmsCsv([`${HEADER}\n${rowA}`, `${HEADER}\n${rowB}`]);
    const lines = merged.split('\n');
    expect(lines[0]).toBe(HEADER);
    expect(lines).toHaveLength(3);
    // Both satellites survive the merge — parser sees two observations
    expect(parseFirmsCsv(merged)).toHaveLength(2);
  });

  it('keeps the surviving platform when the other returns nothing', () => {
    expect(parseFirmsCsv(mergeFirmsCsv([`${HEADER}\n${rowA}`, null]))).toHaveLength(1);
    expect(parseFirmsCsv(mergeFirmsCsv([null, `${HEADER}\n${rowB}`]))).toHaveLength(1);
  });

  it('header-only responses mean no fires, not a failure', () => {
    const merged = mergeFirmsCsv([HEADER, HEADER]);
    expect(merged).toBe(HEADER);
    expect(parseFirmsCsv(merged)).toEqual([]);
  });

  it('returns empty string when every platform failed', () => {
    expect(mergeFirmsCsv([null, null])).toBe('');
  });

  it('ignores a response that is not FIRMS CSV', () => {
    const merged = mergeFirmsCsv(['<html>rate limited</html>', `${HEADER}\n${rowA}`]);
    expect(parseFirmsCsv(merged)).toHaveLength(1);
  });

  it('tolerates CRLF and trailing newlines', () => {
    const merged = mergeFirmsCsv([`${HEADER}\r\n${rowA}\r\n`, `${HEADER}\n${rowB}\n`]);
    expect(parseFirmsCsv(merged)).toHaveLength(2);
  });
});
