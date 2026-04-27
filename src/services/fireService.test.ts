/**
 * Tests for fireService — NASA FIRMS CSV parser + filtering + aggregation.
 *
 * Pure functions. Bug here = wrong fire counts on the map / silenced alerts.
 */

import { describe, it, expect } from 'vitest';
import {
  parseFirmsCsv,
  filterRealFires,
  aggregateFiresForSector,
} from './fireService';
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

  it('drops cool detections (industrial heat signatures <320K)', () => {
    const csv = [HEADER, row({ bright: 310 }), row({ bright: 320 }), row({ bright: 350 })].join('\n');
    const fires = parseFirmsCsv(csv);
    // 320K is the boundary (>=)
    expect(filterRealFires(fires)).toHaveLength(2);
  });

  it('keeps high-confidence + hot signature', () => {
    const csv = HEADER + '\n' + row({ conf: 'h', bright: 400 });
    expect(filterRealFires(parseFirmsCsv(csv))).toHaveLength(1);
  });
});

// ── aggregateFiresForSector ──────────────────────────

const cesantesCenter: [number, number] = [-8.62, 42.31]; // Rías sector
const castreloCenter: [number, number] = [-8.10, 42.30]; // Embalse sector

function fire(lat: number, lon: number, frp = 10): ActiveFire {
  return {
    id: `${lat}_${lon}`,
    lat,
    lon,
    brightness: 340,
    frp,
    acquiredAt: new Date('2026-04-27T12:00:00Z'),
    satellite: 'N',
    confidence: 'nominal',
    daynight: 'D',
  };
}

describe('aggregateFiresForSector', () => {
  it('returns severity none for empty list', () => {
    const r = aggregateFiresForSector([], cesantesCenter);
    expect(r.severity).toBe('none');
    expect(r.total).toBe(0);
    expect(r.nearestKm).toBeNull();
    expect(r.nearSector).toBe(false);
  });

  it('counts all fires regardless of distance (info)', () => {
    // Far away (Madrid-ish ~465km from Cesantes) → still counted, severity info
    const f = [fire(40.4, -3.7)];
    const r = aggregateFiresForSector(f, cesantesCenter);
    expect(r.total).toBe(1);
    expect(r.severity).toBe('info');
    expect(r.nearSector).toBe(false);
  });

  it('escalates to aviso when fire within warnKm (50km default)', () => {
    // ~30km north of Cesantes
    const f = [fire(42.58, -8.62)];
    const r = aggregateFiresForSector(f, cesantesCenter);
    expect(r.severity).toBe('aviso');
    expect(r.nearSector).toBe(true);
    expect(r.nearestKm).toBeLessThan(35);
  });

  it('escalates to alerta when fire within criticalKm (25km default)', () => {
    // ~10km from Cesantes
    const f = [fire(42.40, -8.62)];
    const r = aggregateFiresForSector(f, cesantesCenter);
    expect(r.severity).toBe('alerta');
    expect(r.nearestKm).toBeLessThan(15);
  });

  it('high FRP regional fire bumps info → aviso', () => {
    // Fire at ~150km but FRP 200MW
    const f = [fire(43.7, -8.62, 200)];
    const r = aggregateFiresForSector(f, cesantesCenter);
    expect(r.severity).toBe('aviso');
    expect(r.maxFrp).toBe(200);
  });

  it('tracks nearest among multiple fires', () => {
    const f = [fire(43.5, -8.62, 5), fire(42.45, -8.62, 5), fire(40.0, -3.0, 5)];
    const r = aggregateFiresForSector(f, cesantesCenter);
    expect(r.nearestKm).toBeLessThan(20); // 42.45 → ~16km
  });

  it('respects custom thresholds', () => {
    const f = [fire(42.58, -8.62)]; // ~30km away
    const r = aggregateFiresForSector(f, cesantesCenter, /*warn*/ 100, /*crit*/ 50);
    expect(r.severity).toBe('alerta'); // now within 50km critical
  });
});
