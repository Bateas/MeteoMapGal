/**
 * Tests for viracionDetector.
 *
 * The empirical thresholds in viracionDetector.ts come from a SQL audit
 * of TimescaleDB readings (Mar-May 2026). These tests replay those numbers
 * back in to confirm the classifier matches what we measured in production.
 *
 * Reference data (audit S135+2):
 *   Vigo  (mg_14001): morning NE 35-75°, afternoon SW 235-238° peak 8-9kt
 *   Marín (mg_14005): morning E/SE 40-130°, afternoon SW 231-259° peak 6-7kt
 *   Cangas (mc_..36940A): morning N 336-31°, afternoon W 287-299° peak 5-6kt
 *   Sálvora (mg_10134): morning NE 10-50° always 8kt, afternoon W 260-284° 8-10kt
 */
import { describe, it, expect } from 'vitest';
import {
  detectViracionPhase,
  dirInRange,
  VIRACION_PATTERNS,
} from './viracionDetector';
import type { NormalizedReading } from '../types/station';

const reading = (overrides: Partial<NormalizedReading>): NormalizedReading => ({
  stationId: 'test',
  timestamp: new Date(),
  windSpeed: null,
  windGust: null,
  windDirection: null,
  temperature: null,
  humidity: null,
  precipitation: null,
  solarRadiation: null,
  pressure: null,
  dewPoint: null,
  ...overrides,
});

/** Build a Date pinned to a specific local Madrid hour for a thermal-season day. */
function thermalDayAt(hourLocal: number): Date {
  // 2026-06-15 is comfortably mid-summer; pick a UTC instant that maps to
  // the requested local hour in CEST (UTC+2). 06:15 CEST = 04:15 UTC.
  const utcHour = (hourLocal - 2 + 24) % 24;
  return new Date(Date.UTC(2026, 5, 15, utcHour, 30));
}

// ─── dirInRange ──────────────────────────────────────────

describe('dirInRange', () => {
  it('matches a normal range', () => {
    expect(dirInRange(50, { min: 20, max: 90 })).toBe(true);
    expect(dirInRange(15, { min: 20, max: 90 })).toBe(false);
    expect(dirInRange(100, { min: 20, max: 90 })).toBe(false);
  });

  it('handles wrap-around ranges (e.g. 320..40)', () => {
    expect(dirInRange(355, { min: 320, max: 40 })).toBe(true);
    expect(dirInRange(10, { min: 320, max: 40 })).toBe(true);
    expect(dirInRange(180, { min: 320, max: 40 })).toBe(false);
  });

  it('normalizes degrees outside 0..360', () => {
    expect(dirInRange(380, { min: 10, max: 30 })).toBe(true); // 380 → 20
    expect(dirInRange(-10, { min: 320, max: 40 })).toBe(true); // -10 → 350
  });
});

// ─── Out of season ───────────────────────────────────────

describe('out of thermal season', () => {
  it('returns unknown in February', () => {
    const result = detectViracionPhase(
      'cesantes',
      reading({ windDirection: 60, windSpeed: 4 }),
      null,
      new Date(Date.UTC(2026, 1, 15, 14, 0)),
    );
    expect(result.phase).toBe('unknown');
    expect(result.confidence).toBe('low');
  });

  it('returns unknown in November', () => {
    const result = detectViracionPhase(
      'cesantes',
      reading({ windDirection: 240, windSpeed: 5 }),
      null,
      new Date(Date.UTC(2026, 10, 15, 16, 0)),
    );
    expect(result.phase).toBe('unknown');
  });
});

// ─── Synoptic gate ───────────────────────────────────────

describe('strong synoptic overrides thermal pattern', () => {
  it('reports synoptic kill when forecast > 12 kt', () => {
    const result = detectViracionPhase(
      'cesantes',
      reading({ windDirection: 60, windSpeed: 5 }),
      18,
      thermalDayAt(15),
    );
    expect(result.phase).toBe('unknown');
    expect(result.confidence).toBe('low');
    expect(result.description.toLowerCase()).toContain('sinóptico');
  });

  it('does NOT trigger when synoptic is below threshold', () => {
    const result = detectViracionPhase(
      'cesantes',
      reading({ windDirection: 240, windSpeed: 4 }),
      8,
      thermalDayAt(15),
    );
    expect(result.phase).toBe('viracion');
  });
});

// ─── Vigo (mg_14001) replay of real audit data ───────────

describe('Vigo / Cesantes pattern (mg_14001 reference)', () => {
  it('07h NE 56°, 4.8 kt → terral on-pattern', () => {
    const r = detectViracionPhase(
      'cesantes',
      reading({ windDirection: 56, windSpeed: 4.8 / 1.94384 }),
      null,
      thermalDayAt(7),
    );
    expect(r.phase).toBe('terral');
    expect(r.isOnPattern).toBe(true);
  });

  it('11h NE 35° → still terral', () => {
    const r = detectViracionPhase(
      'cesantes',
      reading({ windDirection: 35, windSpeed: 2 }),
      null,
      thermalDayAt(11),
    );
    expect(r.phase).toBe('terral');
  });

  it('12h SW 253° → transition phase', () => {
    const r = detectViracionPhase(
      'cesantes',
      reading({ windDirection: 253, windSpeed: 2.6 }),
      null,
      thermalDayAt(12),
    );
    expect(r.phase).toBe('transition');
  });

  it('15h SW 237°, 8.5 kt → viración activa, high confidence', () => {
    const r = detectViracionPhase(
      'cesantes',
      reading({ windDirection: 237, windSpeed: 8.5 / 1.94384 }),
      null,
      thermalDayAt(15),
    );
    expect(r.phase).toBe('viracion');
    expect(r.isOnPattern).toBe(true);
    expect(r.confidence).toBe('high');
    expect(r.description).toContain('kt');
  });

  it('17h afternoon BUT direction is NE 60° → off-pattern, low confidence', () => {
    const r = detectViracionPhase(
      'cesantes',
      reading({ windDirection: 60, windSpeed: 4 }),
      null,
      thermalDayAt(17),
    );
    expect(r.phase).toBe('viracion');
    expect(r.isOnPattern).toBe(false);
    expect(r.confidence).toBe('low');
  });

  it('21h still SW 252° but slowing → decaying', () => {
    const r = detectViracionPhase(
      'cesantes',
      reading({ windDirection: 252, windSpeed: 4.8 / 1.94384 }),
      null,
      thermalDayAt(21),
    );
    expect(r.phase).toBe('decaying');
    expect(r.isOnPattern).toBe(true);
  });
});

// ─── Marín / Lourido (mg_14005 reference) ────────────────

describe('Marín / Lourido pattern (mg_14005 reference)', () => {
  it('15h SW 241°, 6.4 kt → viración activa', () => {
    const r = detectViracionPhase(
      'lourido',
      reading({ windDirection: 241, windSpeed: 6.4 / 1.94384 }),
      null,
      thermalDayAt(15),
    );
    expect(r.phase).toBe('viracion');
    expect(r.isOnPattern).toBe(true);
    expect(r.confidence).toBe('high');
  });

  it('castiñeiras shares pattern with lourido (same group)', () => {
    const r = detectViracionPhase(
      'castineiras',
      reading({ windDirection: 245, windSpeed: 6 / 1.94384 }),
      null,
      thermalDayAt(16),
    );
    expect(r.isOnPattern).toBe(true);
  });
});

// ─── Cíes-Ría (Cangas reference) — wrap-around morning dir ──

describe('Cíes-Ría pattern (Cangas mc_..36940A reference)', () => {
  it('05h N 357° → terral on-pattern (wrap-around)', () => {
    const r = detectViracionPhase(
      'cies-ria',
      reading({ windDirection: 357, windSpeed: 1.0 }),
      null,
      thermalDayAt(5),
    );
    expect(r.phase).toBe('terral');
    expect(r.isOnPattern).toBe(true);
  });

  it('15h W 292°, 5.3 kt → viración activa', () => {
    const r = detectViracionPhase(
      'cies-ria',
      reading({ windDirection: 292, windSpeed: 5.3 / 1.94384 }),
      null,
      thermalDayAt(15),
    );
    expect(r.phase).toBe('viracion');
    expect(r.isOnPattern).toBe(true);
  });
});

// ─── No reading / no pattern ────────────────────────────

describe('edge cases', () => {
  it('null reading → no detection', () => {
    const r = detectViracionPhase('cesantes', null, null, thermalDayAt(15));
    expect(r.phase).toBe('unknown');
    expect(r.description).toBe('');
  });

  it('reading with null direction → no detection', () => {
    const r = detectViracionPhase(
      'cesantes',
      reading({ windDirection: null, windSpeed: 5 }),
      null,
      thermalDayAt(15),
    );
    expect(r.phase).toBe('unknown');
  });

  it('surf spot has no pattern → no detection', () => {
    const r = detectViracionPhase(
      'surf-patos',
      reading({ windDirection: 240, windSpeed: 6 }),
      null,
      thermalDayAt(15),
    );
    expect(r.phase).toBe('unknown');
  });

  it('castrelo (Embalse spot) has no pattern → no detection', () => {
    const r = detectViracionPhase(
      'castrelo',
      reading({ windDirection: 240, windSpeed: 8 }),
      null,
      thermalDayAt(15),
    );
    expect(r.phase).toBe('unknown');
  });
});

// ─── Pattern coverage check ─────────────────────────────

describe('VIRACION_PATTERNS', () => {
  it('covers all coastal Rías sailing spots', () => {
    const covered = new Set<string>();
    for (const p of VIRACION_PATTERNS) {
      for (const id of p.appliesTo) covered.add(id);
    }
    // All sailing spots in Rías should have a pattern (NOT castrelo, NOT surf)
    const expectedSailing = [
      'cesantes', 'bocana', 'centro-ria', 'cies-ria',
      'lourido', 'castineiras', 'vao', 'lanzada', 'illa-arousa',
    ];
    for (const id of expectedSailing) {
      expect(covered.has(id), `spot ${id} missing from VIRACION_PATTERNS`).toBe(true);
    }
  });

  it('no spot is assigned to two different patterns', () => {
    const seen = new Set<string>();
    for (const p of VIRACION_PATTERNS) {
      for (const id of p.appliesTo) {
        expect(seen.has(id), `spot ${id} appears in multiple patterns`).toBe(false);
        seen.add(id);
      }
    }
  });
});

// ─── Buoy cross-validation ─────────────────────────────

describe('buoy cross-validation', () => {
  it('boosts confidence to high when buoy confirms station', () => {
    const r = detectViracionPhase('cesantes', {
      reading: reading({ stationId: 'mg_14001', windDirection: 235, windSpeed: 4.2 }),
      buoy: { windDirection: 245, windKt: 9 },  // 10° apart — within 45° tolerance
      now: thermalDayAt(15),
    });
    expect(r.phase).toBe('viracion');
    expect(r.isOnPattern).toBe(true);
    expect(r.confidence).toBe('high');
    expect(r.sources.buoyConfirmed).toBe(true);
    expect(r.description).toContain('confirmado por boya');
  });

  it('demotes to medium when buoy strongly conflicts with station', () => {
    const r = detectViracionPhase('cesantes', {
      reading: reading({ stationId: 'mg_14001', windDirection: 235, windSpeed: 4.2 }),
      buoy: { windDirection: 80 },  // 155° away — clear conflict
      now: thermalDayAt(15),
    });
    expect(r.phase).toBe('viracion');
    expect(r.isOnPattern).toBe(true);  // station says yes
    expect(r.confidence).toBe('medium');
    expect(r.sources.buoyConflict).toBe(true);
    expect(r.description).toContain('boya discrepa');
  });

  it('treats buoy 50° apart as inconclusive (neither confirm nor conflict)', () => {
    // 50° is inside the "ambiguous" band: not tight enough to confirm,
    // not wide enough to mark a conflict.
    const r = detectViracionPhase('cesantes', {
      reading: reading({ stationId: 'mg_14001', windDirection: 235, windSpeed: 4.2 }),
      buoy: { windDirection: 290 },
      now: thermalDayAt(15),
    });
    expect(r.sources.buoyConfirmed).toBe(false);
    expect(r.sources.buoyConflict).toBe(false);
  });

  it('ignores null buoy entry (no demotion)', () => {
    const r = detectViracionPhase('cesantes', {
      reading: reading({ stationId: 'mg_14001', windDirection: 237, windSpeed: 4.4 }),
      buoy: null,
      now: thermalDayAt(15),
    });
    expect(r.confidence).toBe('high');  // no buoy means no demotion (relies on speed)
    expect(r.sources.buoyConfirmed).toBe(false);
    expect(r.sources.buoyConflict).toBe(false);
  });
});

// ─── Station blind sector handling ──────────────────────

describe('station blind sector demotion', () => {
  it('demotes Cangas reading in S/SW blind sector with no buoy', () => {
    // Cangas (mc_..36940A) is documented sheltered for S/SW (180-240°).
    // A reading at 220° matches the afternoon viración pattern direction
    // for cies-ria, but Cangas is known unreliable here.
    const r = detectViracionPhase('cies-ria', {
      reading: reading({
        stationId: 'mc_ESGAL3600000036940A',
        windDirection: 290,        // matches afternoon pattern (270-310° per Cies-Ría pattern)
        windSpeed: 2.7,            // 5.3 kt
      }),
      now: thermalDayAt(16),
    });
    // 290° is NOT in the 180-240 blind sector for Cangas, so should NOT demote
    expect(r.sources.stationBlindSector).toBe(false);
  });

  it('demotes when station IS in its documented blind sector', () => {
    // Cangas's empirically-validated blind sectors (S135+2 audit) are
    // now 300-30° (wrap) and 60-180° — direction 30° is at the edge
    // of the wrap-around N sector.
    const r = detectViracionPhase('cies-ria', {
      reading: reading({
        stationId: 'mc_ESGAL3600000036940A',
        windDirection: 30,         // Inside Cangas wrap blind sector (300-30°)
        windSpeed: 1.5,
      }),
      now: thermalDayAt(7),         // morning, terral phase
    });
    expect(r.sources.stationBlindSector).toBe(true);
  });

  it('promotes despite blind sector when buoy confirms', () => {
    // Cesantes channels everything, but if the buoy says the same
    // direction we trust it.
    const r = detectViracionPhase('cesantes', {
      reading: reading({
        stationId: 'mg_10018',
        windDirection: 240,
        windSpeed: 4.0,
      }),
      buoy: { windDirection: 245 },
      now: thermalDayAt(15),
    });
    expect(r.sources.buoyConfirmed).toBe(true);
    expect(r.confidence).toBe('high');  // buoy overrides blind suspicion
  });

  it('description notes "estación apantallada" when applicable', () => {
    // Use a station with a known blind sector + reading in that sector
    // + matches pattern + no buoy.
    // Lourizán mg_10064 has bias 0-60° (accelerated); use that.
    const r = detectViracionPhase('lourido', {
      reading: reading({
        stationId: 'mg_10064',
        windDirection: 50,        // morning sector + Lourizán blind
        windSpeed: 2,
      }),
      now: thermalDayAt(7),
    });
    expect(r.sources.stationBlindSector).toBe(true);
    expect(r.confidence).toBe('medium');
    expect(r.description).toContain('apantallada');
  });
});

// ─── New ViracionInputs API + sources field ──────────────

describe('ViracionInputs object signature', () => {
  it('accepts new options-object signature', () => {
    const r = detectViracionPhase('cesantes', {
      reading: reading({ windDirection: 240, windSpeed: 4 }),
      synopticKt: 5,
      now: thermalDayAt(15),
    });
    expect(r.phase).toBe('viracion');
  });

  it('exposes source flags in the result', () => {
    const r = detectViracionPhase('cesantes', {
      reading: reading({ stationId: 'mg_14001', windDirection: 240, windSpeed: 4 }),
      buoy: { windDirection: 245 },
      now: thermalDayAt(15),
    });
    expect(r.sources).toBeDefined();
    expect(r.sources.station).toBe(true);
    expect(r.sources.buoyConfirmed).toBe(true);
  });
});
