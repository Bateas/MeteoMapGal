import { describe, it, expect } from 'vitest';
import { evaluateAirspace, stripHtml } from './airspaceService';
import type { UasZone, ActiveNotam } from '../api/enaireClient';

// ── Test data helpers ────────────────────────────────────

/** Simple square polygon centered at [lon, lat] with ~0.05° radius */
function makePolygon(lon: number, lat: number): GeoJSON.Polygon {
  const d = 0.05;
  return {
    type: 'Polygon',
    coordinates: [[
      [lon - d, lat - d],
      [lon + d, lat - d],
      [lon + d, lat + d],
      [lon - d, lat + d],
      [lon - d, lat - d],
    ]],
  };
}

function makeZone(overrides: Partial<UasZone> = {}): UasZone {
  return {
    name: 'Test Zone',
    type: 'REQ_AUTHORIZATION',
    variant: 'test',
    message: 'Test message',
    reasons: 'SAFETY',
    lowerAltitude: 0,
    upperAltitude: 120,
    altitudeReference: 'AGL',
    validFrom: '2025-01-01',
    validTo: '2030-01-01',
    phone: '',
    email: '',
    geometry: makePolygon(-8.1, 42.3),
    ...overrides,
  };
}

function makeNotam(overrides: Partial<ActiveNotam> = {}): ActiveNotam {
  const now = new Date();
  return {
    notamId: 'V01234/26',
    location: 'LEVX',
    description: 'Test NOTAM description',
    lowerAltitudeFt: 0,
    upperAltitudeFt: 500,
    lowerAltitudeAglFt: 0,
    startDate: new Date(now.getTime() - 3600000), // 1h ago
    endDate: new Date(now.getTime() + 86400000),   // 24h from now
    qcode: 'QXXXX',
    geometry: { type: 'Point', coordinates: [-8.1, 42.3] },
    ...overrides,
  };
}

// ── stripHtml ────────────────────────────────────────────

describe('stripHtml', () => {
  it('removes HTML tags', () => {
    expect(stripHtml('<b>Bold</b> text')).toBe('Bold text');
  });

  it('converts <br> to space', () => {
    expect(stripHtml('Line 1<br>Line 2')).toBe('Line 1 Line 2');
  });

  it('converts <br/> and <br /> variants', () => {
    expect(stripHtml('A<br/>B<br />C')).toBe('A B C');
  });

  it('decodes HTML entities', () => {
    expect(stripHtml('&amp; &lt;tag&gt; &nbsp;')).toBe('& <tag>');
  });

  it('collapses whitespace', () => {
    expect(stripHtml('  too   much   space  ')).toBe('too much space');
  });

  it('handles empty string', () => {
    expect(stripHtml('')).toBe('');
  });

  it('strips nested tags', () => {
    expect(stripHtml('<p><b>Nested <i>tags</i></b></p>')).toBe('Nested tags');
  });
});

// ── evaluateAirspace — zone detection ────────────────────

describe('evaluateAirspace — zone detection', () => {
  it('returns no restrictions when point is outside all zones', () => {
    const zone = makeZone({ geometry: makePolygon(-9.0, 43.0) }); // far away
    const result = evaluateAirspace([-8.1, 42.3], 35, [zone], []);

    expect(result.restricted).toBe(false);
    expect(result.severity).toBe('none');
    expect(result.zones).toHaveLength(0);
  });

  it('detects point inside a REQ_AUTHORIZATION zone', () => {
    const zone = makeZone({ type: 'REQ_AUTHORIZATION' });
    const result = evaluateAirspace([-8.1, 42.3], 35, [zone], []);

    expect(result.restricted).toBe(true);
    expect(result.severity).toBe('caution');
    expect(result.zones).toHaveLength(1);
    expect(result.zones[0].name).toBe('Test Zone');
  });

  it('detects PROHIBITED zone with highest severity', () => {
    const zone = makeZone({ type: 'PROHIBITED' });
    const result = evaluateAirspace([-8.1, 42.3], 35, [zone], []);

    expect(result.severity).toBe('prohibited');
    expect(result.restricted).toBe(true);
  });

  it('skips zones with altitude floor above flight altitude', () => {
    const zone = makeZone({ lowerAltitude: 200, upperAltitude: 500 }); // floor 200m > default 120m
    const result = evaluateAirspace([-8.1, 42.3], 35, [zone], []);

    expect(result.restricted).toBe(false);
    expect(result.zones).toHaveLength(0);
  });

  it('includes zones when flight altitude is within range', () => {
    const zone = makeZone({ lowerAltitude: 0, upperAltitude: 150 }); // 120m within 0-150m
    const result = evaluateAirspace([-8.1, 42.3], 35, [zone], [], 120);

    expect(result.zones).toHaveLength(1);
  });

  it('deduplicates zones with same name and type', () => {
    const zone1 = makeZone({ name: 'DupZone', type: 'REQ_AUTHORIZATION' });
    const zone2 = makeZone({ name: 'DupZone', type: 'REQ_AUTHORIZATION' });
    const result = evaluateAirspace([-8.1, 42.3], 35, [zone1, zone2], []);

    expect(result.zones).toHaveLength(1);
  });

  it('filters out zones named "Sin nombre"', () => {
    const zone = makeZone({ name: 'Sin nombre' });
    const result = evaluateAirspace([-8.1, 42.3], 35, [zone], []);

    expect(result.zones).toHaveLength(0);
  });

  it('handles MultiPolygon geometry', () => {
    const zone = makeZone({
      geometry: {
        type: 'MultiPolygon',
        coordinates: [makePolygon(-8.1, 42.3).coordinates],
      } as GeoJSON.MultiPolygon,
    });
    const result = evaluateAirspace([-8.1, 42.3], 35, [zone], []);

    expect(result.zones).toHaveLength(1);
  });
});

// ── evaluateAirspace — NOTAM detection ───────────────────

describe('evaluateAirspace — NOTAM detection', () => {
  it('detects active point NOTAM within radius', () => {
    const notam = makeNotam();
    const result = evaluateAirspace([-8.1, 42.3], 35, [], [notam]);

    expect(result.notams).toHaveLength(1);
    expect(result.notams[0].id).toBe('V01234/26');
  });

  it('skips expired NOTAMs', () => {
    const notam = makeNotam({
      endDate: new Date(Date.now() - 3600000), // expired 1h ago
    });
    const result = evaluateAirspace([-8.1, 42.3], 35, [], [notam]);

    expect(result.notams).toHaveLength(0);
  });

  it('skips future NOTAMs', () => {
    const notam = makeNotam({
      startDate: new Date(Date.now() + 86400000), // starts tomorrow
    });
    const result = evaluateAirspace([-8.1, 42.3], 35, [], [notam]);

    expect(result.notams).toHaveLength(0);
  });

  it('skips NOTAMs with floor above flight altitude', () => {
    const notam = makeNotam({
      lowerAltitudeAglFt: 500, // ~152m AGL, above 120m default
    });
    const result = evaluateAirspace([-8.1, 42.3], 35, [], [notam]);

    expect(result.notams).toHaveLength(0);
  });

  it('skips NOTAMs outside radius (point type)', () => {
    const notam = makeNotam({
      geometry: { type: 'Point', coordinates: [-10.0, 44.0] }, // far away
    });
    const result = evaluateAirspace([-8.1, 42.3], 35, [], [notam]);

    expect(result.notams).toHaveLength(0);
  });

  it('detects polygon NOTAM containing center point', () => {
    const notam = makeNotam({
      geometry: makePolygon(-8.1, 42.3),
    });
    const result = evaluateAirspace([-8.1, 42.3], 35, [], [notam]);

    expect(result.notams).toHaveLength(1);
  });

  it('assigns prohibited severity for NOTAM with PROHIB keyword', () => {
    const notam = makeNotam({
      description: 'Airspace PROHIBITED for drone operations',
    });
    const result = evaluateAirspace([-8.1, 42.3], 35, [], [notam]);

    expect(result.notams[0].severity).toBe('prohibited');
    expect(result.severity).toBe('prohibited');
  });

  it('assigns caution severity for NOTAM with RESTRICT keyword', () => {
    const notam = makeNotam({
      description: 'Airspace RESTRICTED for military exercise',
    });
    const result = evaluateAirspace([-8.1, 42.3], 35, [], [notam]);

    expect(result.notams[0].severity).toBe('caution');
  });

  it('assigns info severity for generic NOTAM', () => {
    const notam = makeNotam({
      description: 'Crane operating near aerodrome',
    });
    const result = evaluateAirspace([-8.1, 42.3], 35, [], [notam]);

    expect(result.notams[0].severity).toBe('info');
  });
});

// ── evaluateAirspace — combined ──────────────────────────

describe('evaluateAirspace — combined zone + NOTAM', () => {
  it('escalates severity from caution zone + prohibited NOTAM', () => {
    const zone = makeZone({ type: 'REQ_AUTHORIZATION' });
    const notam = makeNotam({ description: 'Area PROHIBITED' });
    const result = evaluateAirspace([-8.1, 42.3], 35, [zone], [notam]);

    expect(result.severity).toBe('prohibited');
    expect(result.zones).toHaveLength(1);
    expect(result.notams).toHaveLength(1);
  });

  it('returns restricted=true when only info NOTAMs exist (no zones)', () => {
    const notam = makeNotam({ description: 'Simple info NOTAM' });
    const result = evaluateAirspace([-8.1, 42.3], 35, [], [notam]);

    // Info-only NOTAMs don't make restricted=true (only caution/prohibited do)
    expect(result.restricted).toBe(false);
    expect(result.notams).toHaveLength(1);
  });

  it('custom flight altitude affects zone detection', () => {
    const zone = makeZone({ lowerAltitude: 0, upperAltitude: 50 });
    // Flying at 60m → above zone ceiling → not affected
    const result60 = evaluateAirspace([-8.1, 42.3], 35, [zone], [], 60);
    expect(result60.zones).toHaveLength(0);

    // Flying at 40m → within zone → affected
    const result40 = evaluateAirspace([-8.1, 42.3], 35, [zone], [], 40);
    expect(result40.zones).toHaveLength(1);
  });
});
