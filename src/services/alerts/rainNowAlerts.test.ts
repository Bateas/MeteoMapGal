import { describe, it, expect } from 'vitest';
import { applyRainNow, dropFogRiskInRain, rainRulesOutFogRisk, measuredIntensity } from './rainNowAlerts';
import type { UnifiedAlert } from './types';

const alert = (over: Partial<UnifiedAlert>): UnifiedAlert => ({
  id: 'x', category: 'rain', severity: 'info', score: 40, icon: 'cloud-rain',
  title: 't', detail: 'd', urgent: false, updatedAt: new Date(), ...over,
});
const gauge = (name: string, mm: number, radarDbz: number | null) => ({ name, mm, radarDbz });

describe('applyRainNow (20-oct: «Lluvia prevista en ~1h» with the chip saying LLUEVE)', () => {
  it('turns the rain forecast into «Lloviendo ahora», keeps the forecast in the detail, drops its probability', () => {
    const fc = alert({ id: 'rain-forecast', title: 'Lluvia prevista', detail: '2.5 mm/h · en ~1h', confidence: 80 });
    const out = applyRainNow([fc], { gauges: [gauge('Boiro', 1.2, 25), gauge('Rianxo', 0.8, 22), gauge('Noia', 0.5, null)] });
    // second wettest 0,8 mm in 30 min = 1,6 mm/h: weak
    expect(out[0].title).toBe('Lloviendo ahora');
    expect(out[0].detail).toMatch(/^3 pluviómetros miden lluvia \(Boiro 1,2 mm, Rianxo 0,8 mm… en 30 min\) · Previsión: 2.5 mm\/h/);
    expect(out[0].confidence).toBeUndefined();
  });

  it('adds a notice when no forecast alert exists', () => {
    const out = applyRainNow([], { gauges: [gauge('Boiro', 1.2, 25)] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'rain-now', category: 'rain', severity: 'info', title: 'Lloviendo ahora' });
    expect(out[0].detail).toContain('1 pluviómetro mide lluvia');
  });

  it('without raining gauges nothing changes', () => {
    const fc = alert({ id: 'rain-forecast', title: 'Lluvia prevista' });
    expect(applyRainNow([fc], { gauges: [] })).toEqual([fc]);
    expect(applyRainNow([fc], undefined)).toEqual([fc]);
  });
});

describe('fog risk in rain', () => {
  const physics = alert({ id: 'maritime-fog', category: 'fog', title: 'Riesgo de niebla marítima' });
  const seen = alert({ id: 'maritime-fog-webcam', category: 'fog', title: 'Niebla detectada' });
  const field = alert({ id: 'fog-alert', category: 'fog', title: 'Riesgo de niebla' });

  it('two gauges under 20 dBZ of echo remove only the physics risk', () => {
    const rain = { gauges: [gauge('A', 1, 24), gauge('B', 0.6, 20)] };
    expect(rainRulesOutFogRisk(rain)).toBe(true);
    expect(dropFogRiskInRain([physics, seen, field], rain).map((a) => a.id)).toEqual(['maritime-fog-webcam']);
  });

  it('wet gauges without echo do not: drizzle inside fog wets them too', () => {
    const drizzle = { gauges: [gauge('A', 0.3, null), gauge('B', 0.2, 12), gauge('C', 0.4, 18)] };
    expect(rainRulesOutFogRisk(drizzle)).toBe(false);
    expect(dropFogRiskInRain([physics], drizzle)).toEqual([physics]);
  });

  it('one gauge with echo is not enough', () => {
    expect(rainRulesOutFogRisk({ gauges: [gauge('A', 2, 35)] })).toBe(false);
  });
});

describe('measuredIntensity (20-oct: 5,3 mm in 30 min in Vigo and the light said OK)', () => {
  it('raises the level from the second wettest gauge, AEMET bands', () => {
    expect(measuredIntensity({ gauges: [gauge('A', 5.3, 30), gauge('B', 5.2, 30)] })).toMatchObject({ severity: 'moderate', label: 'Lluvia moderada ahora' });
    expect(measuredIntensity({ gauges: [gauge('A', 9, 40), gauge('B', 8, 40)] })).toMatchObject({ severity: 'high', label: 'Lluvia fuerte ahora' });
    expect(measuredIntensity({ gauges: [gauge('A', 20, 50), gauge('B', 16, 50)] })).toMatchObject({ severity: 'critical' });
  });

  it('one wet gauge never raises it', () => {
    expect(measuredIntensity({ gauges: [gauge('A', 12, 45)] }).severity).toBe('info');
    expect(measuredIntensity({ gauges: [gauge('A', 12, 45), gauge('B', 0.4, 10)] }).severity).toBe('info');
  });

  it('the new notice carries the measured level, and a forecast alert is never lowered', () => {
    const rain = { gauges: [gauge('Vigo', 5.3, 30), gauge('Bouzas', 5.1, 30)] };
    expect(applyRainNow([], rain)[0]).toMatchObject({ severity: 'moderate', title: 'Lluvia moderada ahora' });
    const fc = alert({ id: 'rain-forecast', severity: 'high', score: 70 });
    expect(applyRainNow([fc], rain)[0]).toMatchObject({ severity: 'high', score: 70, title: 'Lluvia moderada ahora' });
  });
});
