/**
 * Tests for fieldAlerts builder — converts FieldAlerts (campo) to UnifiedAlert[].
 *
 * Critical path: feeds Telegram alert pipeline (frost, hail, fog, drone) +
 * frontend FieldDrawer. Pure transformation function.
 *
 * S123: fourth test file in src/services/alerts/.
 */

import { describe, it, expect } from 'vitest';
import { buildFieldAlerts, campoLevelToScore } from './fieldAlerts';
import type { FieldAlerts } from '../../types/campo';
import type { TeleconnectionIndex } from '../../api/naoClient';

// ── Helpers ─────────────────────────────────────────────────

/** Build a baseline FieldAlerts where everything is "none" — tests opt-in. */
function emptyField(): FieldAlerts {
  return {
    frost: {
      level: 'none', minTemp: null, timeWindow: null,
      cloudCover: null, windSpeed: null,
    },
    rain: {
      level: 'none', maxPrecip: 0, maxProbability: 0, rainAccum6h: 0,
      hailRisk: false, firstRainAt: null, hoursUntilRain: null,
    },
    fog: {
      level: 'none', dewPoint: null, spread: null, spreadTrend: null,
      fogEta: null, humidity: null, windSpeed: null, confidence: 0, hypothesis: '',
    },
    drone: {
      flyable: true, windKt: 5, gustKt: 8, rain: false, storms: false,
      reasons: [], airspaceRestricted: false, airspaceSeverity: 'none',
      airspaceReasons: [], activeNotams: 0,
    },
    wind: {
      active: false, directionLabel: '', upwindCount: 0, avgIncreaseKt: 0,
      frontSpeedKt: 0, estimatedArrivalMin: null, confidence: 0, summary: '',
    },
    et0: { dailyMm: 0, weeklyMm: 0, level: 'low' as never },
    disease: { level: 'low' as never, hours: 0, hypothesis: '' },
    gdd: { stage: 'dormancy' as never, accumulated: 0, todayGdd: 0 },
    maxLevel: 'none',
  };
}

function nao(value: number): TeleconnectionIndex {
  return { name: 'NAO', value, phase: value > 0 ? 'positive' : 'negative', updatedAt: new Date() };
}

// ── campoLevelToScore — pure mapping ─────────────────────────

describe('campoLevelToScore', () => {
  it('maps critico → 85 (just at critical threshold)', () => {
    expect(campoLevelToScore('critico')).toBe(85);
  });
  it('maps alto → 55 (just at high threshold)', () => {
    expect(campoLevelToScore('alto')).toBe(55);
  });
  it('maps riesgo → 30', () => {
    expect(campoLevelToScore('riesgo')).toBe(30);
  });
  it('maps none → 0', () => {
    expect(campoLevelToScore('none')).toBe(0);
  });
});

// ── Empty / null cases ───────────────────────────────────────

describe('buildFieldAlerts — empty', () => {
  it('returns empty when field is null', () => {
    expect(buildFieldAlerts(null)).toEqual([]);
  });

  it('returns empty when no sub-alert is active', () => {
    expect(buildFieldAlerts(emptyField())).toEqual([]);
  });
});

// ── Frost ───────────────────────────────────────────────────

describe('buildFieldAlerts — frost', () => {
  it('emits frost-forecast for level=alto', () => {
    const f = emptyField();
    f.frost = { ...f.frost, level: 'alto', minTemp: -2 };
    const alerts = buildFieldAlerts(f);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe('frost-forecast');
    expect(alerts[0].category).toBe('frost');
    expect(alerts[0].score).toBe(55);
    expect(alerts[0].title).toBe('Riesgo de helada');
    expect(alerts[0].detail).toContain('-2.0°C');
    expect(alerts[0].urgent).toBe(false);
  });

  it('uses HELADA SEVERA + urgent for critico', () => {
    const f = emptyField();
    f.frost = { ...f.frost, level: 'critico', minTemp: -5 };
    const alerts = buildFieldAlerts(f);
    expect(alerts[0].title).toBe('HELADA SEVERA');
    expect(alerts[0].urgent).toBe(true);
    expect(alerts[0].score).toBe(85);
  });

  it('appends time window when present', () => {
    const f = emptyField();
    f.frost = {
      ...f.frost, level: 'alto', minTemp: -1,
      timeWindow: {
        from: new Date('2026-04-26T03:00:00'),
        to: new Date('2026-04-26T07:00:00'),
      },
    };
    const alerts = buildFieldAlerts(f);
    expect(alerts[0].detail).toMatch(/3:00.7:00/);
  });

  it('appends NAO− context when phase is strongly negative', () => {
    const f = emptyField();
    f.frost = { ...f.frost, level: 'alto', minTemp: -2 };
    const alerts = buildFieldAlerts(f, nao(-1.5));
    expect(alerts[0].detail).toContain('NAO−');
  });

  it('does NOT append NAO context when neutral (|value| ≤ 1)', () => {
    const f = emptyField();
    f.frost = { ...f.frost, level: 'alto', minTemp: -2 };
    const alerts = buildFieldAlerts(f, nao(0.5));
    expect(alerts[0].detail).not.toContain('NAO');
  });
});

// ── Rain / Hail ─────────────────────────────────────────────

describe('buildFieldAlerts — rain', () => {
  it('emits rain-forecast with cloud-rain icon', () => {
    const f = emptyField();
    f.rain = { ...f.rain, level: 'alto', maxPrecip: 4, hoursUntilRain: 2 };
    const alerts = buildFieldAlerts(f);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe('rain-forecast');
    expect(alerts[0].icon).toBe('cloud-rain');
    expect(alerts[0].title).toBe('Lluvia prevista');
  });

  it('uses "Lluvia inminente" when hoursUntilRain ≤ 1', () => {
    const f = emptyField();
    f.rain = { ...f.rain, level: 'alto', maxPrecip: 3, hoursUntilRain: 0.5 };
    expect(buildFieldAlerts(f)[0].title).toBe('Lluvia inminente');
  });

  it('hailRisk → "Riesgo de GRANIZO" + score boost +20', () => {
    const f = emptyField();
    f.rain = { ...f.rain, level: 'alto', maxPrecip: 5, hailRisk: true, hoursUntilRain: 1 };
    const alerts = buildFieldAlerts(f);
    expect(alerts[0].title).toBe('Riesgo de GRANIZO');
    expect(alerts[0].icon).toBe('hail');
    expect(alerts[0].score).toBe(75); // 55 + 20
    expect(alerts[0].urgent).toBe(true);
  });

  it('rain level=riesgo downgraded to severity=info', () => {
    const f = emptyField();
    f.rain = { ...f.rain, level: 'riesgo', maxPrecip: 1, hoursUntilRain: 3 };
    expect(buildFieldAlerts(f)[0].severity).toBe('info');
  });

  it('detail includes mm/h + accumulated 6h when present', () => {
    const f = emptyField();
    f.rain = {
      ...f.rain, level: 'alto', maxPrecip: 4.5,
      rainAccum6h: 12, hoursUntilRain: 2,
    };
    const detail = buildFieldAlerts(f)[0].detail;
    expect(detail).toContain('4.5 mm/h');
    expect(detail).toContain('12mm en 6h');
  });
});

// ── Fog ─────────────────────────────────────────────────────

describe('buildFieldAlerts — fog', () => {
  it('emits fog-alert with severity info for non-critico', () => {
    const f = emptyField();
    f.fog = { ...f.fog, level: 'alto', spread: 1.5, confidence: 70 };
    const alerts = buildFieldAlerts(f);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe('fog-alert');
    expect(alerts[0].title).toBe('Riesgo de niebla');
    expect(alerts[0].severity).toBe('info'); // capped
    expect(alerts[0].confidence).toBe(70);
    expect(alerts[0].urgent).toBe(false);
  });

  it('critico promotes severity to critical (score 85) + urgent', () => {
    const f = emptyField();
    f.fog = { ...f.fog, level: 'critico', spread: 0.3, confidence: 95 };
    const alerts = buildFieldAlerts(f);
    expect(alerts[0].title).toBe('NIEBLA INMINENTE');
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].urgent).toBe(true);
  });

  it('detail includes spread + confidence', () => {
    const f = emptyField();
    f.fog = { ...f.fog, level: 'alto', spread: 1.2, confidence: 65 };
    const detail = buildFieldAlerts(f)[0].detail;
    expect(detail).toContain('ΔT=1.2°C');
    expect(detail).toContain('65% confianza');
  });

  it('attaches fogMeta with type=radiative for field fog', () => {
    const f = emptyField();
    f.fog = { ...f.fog, level: 'alto', spread: 1, confidence: 60, windSpeed: 0.5 };
    const a = buildFieldAlerts(f)[0];
    expect(a.fogMeta?.type).toBe('radiative');
    expect(a.fogMeta?.spread).toBe(1);
    expect(a.fogMeta?.windSpeed).toBe(0.5);
  });
});

// ── Drone ───────────────────────────────────────────────────

describe('buildFieldAlerts — drone', () => {
  it('emits drone-nogo when flyable=false', () => {
    const f = emptyField();
    f.drone = { ...f.drone, flyable: false, reasons: ['Viento >25kt', 'Lluvia'] };
    const alerts = buildFieldAlerts(f);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe('drone-nogo');
    expect(alerts[0].category).toBe('drone');
    expect(alerts[0].title).toBe('Dron: Precaución');
  });

  it('does NOT emit when flyable=true', () => {
    const f = emptyField();
    f.drone = { ...f.drone, flyable: true };
    expect(buildFieldAlerts(f)).toEqual([]);
  });

  it('score scales with reason count: 1=45, 2=60, 3=75', () => {
    const f1 = emptyField();
    f1.drone = { ...f1.drone, flyable: false, reasons: ['A'] };
    expect(buildFieldAlerts(f1)[0].score).toBe(45);

    const f2 = emptyField();
    f2.drone = { ...f2.drone, flyable: false, reasons: ['A', 'B'] };
    expect(buildFieldAlerts(f2)[0].score).toBe(60);

    const f3 = emptyField();
    f3.drone = { ...f3.drone, flyable: false, reasons: ['A', 'B', 'C'] };
    expect(buildFieldAlerts(f3)[0].score).toBe(75);
  });

  it('detail shows top 2 reasons joined with separator', () => {
    const f = emptyField();
    f.drone = {
      ...f.drone,
      flyable: false,
      reasons: ['Viento fuerte', 'Lluvia', 'Tormenta cercana'],
    };
    const detail = buildFieldAlerts(f)[0].detail;
    expect(detail).toContain('Viento fuerte');
    expect(detail).toContain('Lluvia');
    // Third reason not in main detail (slice(0,2))
    expect(detail).not.toContain('Tormenta cercana');
  });
});

// ── Multiple alerts at once ─────────────────────────────────

describe('buildFieldAlerts — multi-alert composition', () => {
  it('emits all 4 alert types when all active', () => {
    const f = emptyField();
    f.frost = { ...f.frost, level: 'alto', minTemp: -1 };
    f.rain = { ...f.rain, level: 'alto', maxPrecip: 3, hoursUntilRain: 2 };
    f.fog = { ...f.fog, level: 'alto', spread: 1.5, confidence: 70 };
    f.drone = { ...f.drone, flyable: false, reasons: ['Viento'] };

    const alerts = buildFieldAlerts(f);
    expect(alerts.map(a => a.id).sort()).toEqual([
      'drone-nogo', 'fog-alert', 'frost-forecast', 'rain-forecast',
    ]);
  });
});
