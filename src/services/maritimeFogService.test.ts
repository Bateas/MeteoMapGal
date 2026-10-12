/**
 * Tests for maritimeFogService — Rías advection-fog detector.
 *
 * Audit S136+3+5: this 751-line service (largest detector, high user value
 * — fog is critical for Rías navigation) was UNTESTED. Tests focus on the
 * two pure exported functions that gate false positives:
 *   - detectNorthWindConsensus: "is there real N wind that kills fog?"
 *   - detectFogBySolarSignature: "which stations have fog overhead (HR high
 *     + solar blocked + air saturated)?"
 *
 * Time: detectFogBySolarSignature judges by the height of the sun at the instant it is given
 * (solarElevationDeg), not by the local hour, so the tests behave the same under any time zone.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectNorthWindConsensus, detectFogBySolarSignature, buildMaritimeFogAlerts, activeRainVeto, signatureSites } from './maritimeFogService';
import type { NormalizedReading } from '../types/station';
import type { BuoyReading } from '../api/buoyClient';

function reading(over: Partial<NormalizedReading>): NormalizedReading {
  return {
    stationId: 's',
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
    ...over,
  };
}

// kt → m/s helper (service works in m/s)
const kt = (k: number) => k / 1.94384;

describe('detectNorthWindConsensus', () => {
  it('returns false with fewer than 4 wind-reporting stations', () => {
    const m = new Map<string, NormalizedReading>([
      ['a', reading({ windSpeed: kt(15), windDirection: 0 })],
      ['b', reading({ windSpeed: kt(15), windDirection: 10 })],
      ['c', reading({ windSpeed: kt(15), windDirection: 350 })],
    ]);
    expect(detectNorthWindConsensus(m)).toBe(false);
  });

  it('returns false when <60% of stations are northerly', () => {
    const m = new Map<string, NormalizedReading>([
      ['a', reading({ windSpeed: kt(12), windDirection: 10 })],   // N
      ['b', reading({ windSpeed: kt(12), windDirection: 200 })],  // SW
      ['c', reading({ windSpeed: kt(12), windDirection: 210 })],  // SW
      ['d', reading({ windSpeed: kt(12), windDirection: 220 })],  // SW
    ]);
    expect(detectNorthWindConsensus(m)).toBe(false);
  });

  it('returns true when ≥60% northerly with a strong gust (≥10kt)', () => {
    const m = new Map<string, NormalizedReading>([
      ['a', reading({ windSpeed: kt(6), windDirection: 10, windGust: kt(12) })],   // N, gust 12kt
      ['b', reading({ windSpeed: kt(6), windDirection: 350 })],
      ['c', reading({ windSpeed: kt(6), windDirection: 30 })],
      ['d', reading({ windSpeed: kt(6), windDirection: 200 })],
    ]);
    expect(detectNorthWindConsensus(m)).toBe(true);
  });

  it('returns false when northerly but all winds are weak/calm', () => {
    // 4 northerly stations, all ~1.5kt — below MIN_NORTH_SPEED, no strong gust
    const m = new Map<string, NormalizedReading>([
      ['a', reading({ windSpeed: kt(1.5), windDirection: 0, windGust: kt(2) })],
      ['b', reading({ windSpeed: kt(1.5), windDirection: 10, windGust: kt(2) })],
      ['c', reading({ windSpeed: kt(1.5), windDirection: 350, windGust: kt(2) })],
      ['d', reading({ windSpeed: kt(1.5), windDirection: 20, windGust: kt(2) })],
    ]);
    expect(detectNorthWindConsensus(m)).toBe(false);
  });

  it('returns true when northerly with sustained median speed ≥5kt', () => {
    const m = new Map<string, NormalizedReading>([
      ['a', reading({ windSpeed: kt(6), windDirection: 0, windGust: kt(7) })],
      ['b', reading({ windSpeed: kt(6), windDirection: 10, windGust: kt(7) })],
      ['c', reading({ windSpeed: kt(6), windDirection: 350, windGust: kt(7) })],
      ['d', reading({ windSpeed: kt(6), windDirection: 20, windGust: kt(7) })],
    ]);
    expect(detectNorthWindConsensus(m)).toBe(true);
  });

  it('ignores stations below 1 m/s when counting reporters', () => {
    // Only 3 stations report ≥1 m/s → below MIN_STATIONS even though map has 5
    const m = new Map<string, NormalizedReading>([
      ['a', reading({ windSpeed: kt(15), windDirection: 0 })],
      ['b', reading({ windSpeed: kt(15), windDirection: 10 })],
      ['c', reading({ windSpeed: kt(15), windDirection: 350 })],
      ['d', reading({ windSpeed: 0.5, windDirection: 20 })],  // <1 m/s ignored
      ['e', reading({ windSpeed: 0.3, windDirection: 30 })],  // <1 m/s ignored
    ]);
    expect(detectNorthWindConsensus(m)).toBe(false);
  });

  it('treats NE (up to 80°) as northerly for the Galician nortada', () => {
    const m = new Map<string, NormalizedReading>([
      ['a', reading({ windSpeed: kt(7), windDirection: 70, windGust: kt(11) })], // NE, strong gust
      ['b', reading({ windSpeed: kt(7), windDirection: 60 })],
      ['c', reading({ windSpeed: kt(7), windDirection: 50 })],
      ['d', reading({ windSpeed: kt(7), windDirection: 40 })],
    ]);
    expect(detectNorthWindConsensus(m)).toBe(true);
  });
});

describe('detectFogBySolarSignature', () => {
  // 14:00 UTC on 28-may: the sun at ~63 degrees, clear sky ~920 W/m2 (sunny inland >= ~640, blocked < ~370).
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-28T14:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const interior = { id: 'mg_interior', lat: 42.3, lon: -8.1, altitude: 400 }; // lon > -8.5 = interior
  const coast = { id: 'mg_coast', lat: 42.2, lon: -8.9, altitude: 10 };
  const sunny = () => reading({ solarRadiation: 800 });
  const fogged = (over: Partial<NormalizedReading> = {}) =>
    reading({ humidity: 95, solarRadiation: 150, temperature: 14, dewPoint: 13.2, ...over });
  const detect = (r: Map<string, NormalizedReading>, st = [interior, coast]) =>
    detectFogBySolarSignature(r, st, Date.now());

  it('detects a coastal station near sea level: saturated, sun blocked, sun out inland', () => {
    const result = detect(new Map([['mg_interior', sunny()], ['mg_coast', fogged()]]));
    expect(result.map((x) => x.id)).toEqual(['mg_coast']);
  });

  it('returns [] at night', () => {
    vi.setSystemTime(new Date('2026-05-28T02:00:00Z'));
    expect(detect(new Map([['mg_interior', sunny()], ['mg_coast', fogged({ solarRadiation: 0 })]]))).toEqual([]);
  });

  it('cannot judge with the sun low: 19:30 on 28-sep, a clean evening reads under 300 W/m2', () => {
    vi.setSystemTime(new Date('2026-09-28T17:30:00Z'));
    expect(detect(new Map([['mg_interior', reading({ solarRadiation: 200 })], ['mg_coast', fogged({ solarRadiation: 90 })]]))).toEqual([]);
  });

  it('needs the sun out inland against its clear-sky value, not a fixed 350 W/m2', () => {
    // 500 W/m2 at midday is a thin overcast, not sun: the whole region is grey
    expect(detect(new Map([['mg_interior', reading({ solarRadiation: 500 })], ['mg_coast', fogged()]]))).toEqual([]);
  });

  it('judges the coast against the clear sky too: 340 W/m2 at midday is the sun blocked', () => {
    expect(detect(new Map([['mg_interior', sunny()], ['mg_coast', fogged({ solarRadiation: 340 })]]))).toHaveLength(1);
    expect(detect(new Map([['mg_interior', sunny()], ['mg_coast', fogged({ solarRadiation: 450 })]]))).toEqual([]);
  });

  it('rejects air that is not saturated (T-Td >= 2: cloud above, not fog) and HR under 90 %', () => {
    expect(detect(new Map([['mg_interior', sunny()], ['mg_coast', fogged({ temperature: 16, dewPoint: 13 })]]))).toEqual([]);
    expect(detect(new Map([['mg_interior', sunny()], ['mg_coast', fogged({ humidity: 85 })]]))).toEqual([]);
  });

  it('only stations near sea level count; an altitude of 0 means the network does not give one', () => {
    const hill = { ...coast, id: 'mg_hill', altitude: 260 };
    const noAlt = { ...coast, id: 'wu_X', altitude: 0 };
    const r = new Map([['mg_interior', sunny()], ['mg_hill', fogged()], ['wu_X', fogged()]]);
    expect(detect(r, [interior, hill, noAlt])).toEqual([]);
  });

  it('rain over the sector vetoes it: two interval gauges at 0.5 mm or more', () => {
    const r = new Map([['mg_interior', sunny()], ['mg_coast', fogged()],
      ['mg_a', reading({ stationId: 'mg_a', precipitation: 0.6 })], ['mg_b', reading({ stationId: 'mg_b', precipitation: 0.8 })]]);
    expect(detect(r)).toEqual([]);
  });

  it('11-oct: day counters still holding the morning drizzle, and the drizzle of the fog itself, do not veto', () => {
    const r = new Map([['mg_interior', sunny()], ['mg_coast', fogged({ precipitation: 0.2 })],
      ['wu_A', reading({ stationId: 'wu_A', precipitation: 0.99 })], ['mc_B', reading({ stationId: 'mc_B', precipitation: 4.6 })],
      ['mg_c', reading({ stationId: 'mg_c', precipitation: 0.3 })]]);
    expect(detect(r).map((x) => x.id)).toEqual(['mg_coast']);
  });

  it('a gauge with rain of its own (0.5 mm or more in the interval) is left out', () => {
    expect(detect(new Map([['mg_interior', sunny()], ['mg_coast', fogged({ precipitation: 0.6 })]]))).toEqual([]);
  });
});

describe('signatureSites', () => {
  it('stations a few hundred metres apart are one site; ~10 km apart, two', () => {
    expect(signatureSites([{ lat: 42.201, lon: -8.901 }, { lat: 42.203, lon: -8.899 }, { lat: 42.29, lon: -8.80 }])).toBe(2);
    expect(signatureSites([])).toBe(0);
  });
  it('two stations 20 m apart are one site even across the line of a grid (a 0.05-degree grid split them)', () => {
    expect(signatureSites([{ lat: 42.2249, lon: -8.80 }, { lat: 42.2251, lon: -8.80 }])).toBe(1);
  });
});

describe('detectFogBySolarSignature — rain over the hour and cameras that see clear (12-oct review)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-28T14:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const interior = { id: 'mg_interior', lat: 42.3, lon: -8.1, altitude: 400 };
  const coast = { id: 'mg_coast', lat: 42.2, lon: -8.9, altitude: 10 };
  const r = () => new Map([['mg_interior', reading({ solarRadiation: 800 })],
    ['mg_coast', reading({ humidity: 95, solarRadiation: 150, temperature: 14, dewPoint: 13.4, precipitation: 0.2 })]]);
  it('a light shower (0.6 mm in the hour, 0.2 in this reading) rules the station out; drizzle (0.3) does not', () => {
    expect(detectFogBySolarSignature(r(), [interior, coast], Date.now(), undefined, { rainMm60: () => 0.6 })).toEqual([]);
    expect(detectFogBySolarSignature(r(), [interior, coast], Date.now(), undefined, { rainMm60: () => 0.3 })).toHaveLength(1);
  });
  it('a camera 3 km away seeing the water clear rules it out; one 20 km away does not (fog comes in banks)', () => {
    expect(detectFogBySolarSignature(r(), [interior, coast], Date.now(), undefined, { clearCameras: [{ lat: 42.22, lon: -8.88 }] })).toEqual([]);
    expect(detectFogBySolarSignature(r(), [interior, coast], Date.now(), undefined, { clearCameras: [{ lat: 42.38, lon: -8.9 }] })).toHaveLength(1);
  });
});

describe('buildMaritimeFogAlerts — kinds of evidence, not counts (12-oct)', () => {
  // 30-sep 12:00 UTC (14:00 in Madrid): the sun at ~44 degrees, clear sky ~700 W/m2.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const interior = { id: 'mg_interior', lat: 42.3, lon: -8.1, altitude: 400 };
  const coastA = { id: 'mg_a', lat: 42.50, lon: -8.90, altitude: 10 };
  const coastB = { id: 'mg_b', lat: 42.40, lon: -8.80, altitude: 20 };
  const stations = [interior, coastA, coastB];
  const fogged = () => reading({ humidity: 96, solarRadiation: 150, temperature: 16.4, dewPoint: 15.9 });
  const readings = () => new Map([['mg_interior', reading({ solarRadiation: 650 })], ['mg_a', fogged()], ['mg_b', fogged()]]);
  // Ribeira: air 1.1 °C over the water, humid, light onshore breeze -> physics «alto»
  const ribeira = (): BuoyReading => ({
    stationId: 1255, stationName: 'Ribeira', timestamp: new Date().toISOString(),
    waveHeight: null, waveHeightMax: null, wavePeriod: null, wavePeriodMean: null, waveDir: null,
    windSpeed: 3, windDir: 250, windGust: null, waterTemp: 16, airTemp: 17.1, airPressure: null,
    currentSpeed: null, currentDir: null, salinity: null, seaLevel: null, humidity: 88, dewPoint: null, source: 'obscosteiro',
  });
  const evidence = (a: ReturnType<typeof buildMaritimeFogAlerts>) => a.find((x) => x.id === 'maritime-fog-webcam');

  it('the signature alone, at any number of sites, never fires (it holds on most days: low cloud)', () => {
    expect(evidence(buildMaritimeFogAlerts([], readings(), stations, undefined, 0, [], undefined, undefined, 0))).toBeUndefined();
  });

  it('signature + physics: two different kinds fire «Niebla probable en la costa», high, not urgent', () => {
    const a = evidence(buildMaritimeFogAlerts([ribeira()], readings(), stations, undefined, 0, [], undefined, undefined, 0));
    expect(a?.title).toBe('Niebla probable en la costa');
    expect(a?.severity).toBe('high');
    expect(a?.urgent).toBe(false);
    expect(a?.detail).toMatch(/2 sitios a nivel del mar/);
    expect(a?.detail).toMatch(/ΔT \+1\.1 °C, Ribeira/);
  });

  it('a camera site + the signature fire; a lone camera with the physics does not (30-sep)', () => {
    const camSig = evidence(buildMaritimeFogAlerts([], readings(), stations, true, 1, ['mg-cangas'], undefined, undefined, 0));
    expect(camSig?.title).toBe('Niebla confirmada (cámaras + radiación)');
    const camPhys = evidence(buildMaritimeFogAlerts([ribeira()], new Map(), [], true, 1, ['mg-ons-praia'], undefined, undefined, 0));
    expect(camPhys).toBeUndefined();
  });

  it('three kinds together are critical and urgent; many stations of one kind are not', () => {
    const a = evidence(buildMaritimeFogAlerts([ribeira()], readings(), stations, true, 1, ['mg-cangas'], undefined, undefined, 0));
    expect(a?.severity).toBe('critical');
    expect(a?.urgent).toBe(true);
    const many = new Map(readings());
    const st = [...stations];
    for (let i = 0; i < 40; i++) {
      st.push({ id: `mg_x${i}`, lat: 42.1 + i * 0.012, lon: -8.85, altitude: 15 });
      many.set(`mg_x${i}`, fogged());
    }
    const b = evidence(buildMaritimeFogAlerts([ribeira()], many, st, undefined, 0, [], undefined, undefined, 0));
    expect(b?.severity).toBe('high');
  });
});

describe('buildMaritimeFogAlerts — firing gate (varias variables, no a la ligera)', () => {
  const noStations: { id: string; lat: number; lon: number }[] = [];
  const fogAlert = (a: ReturnType<typeof buildMaritimeFogAlerts>) =>
    a.find((x) => x.id === 'maritime-fog-webcam');

  it('does NOT fire on a SINGLE camera (even reporting poor visibility) — sunset glare case', () => {
    const alerts = buildMaritimeFogAlerts(
      [], new Map(), noStations,
      true, 1, ['cam-a'], undefined, undefined, 1, // 1 cam, poor-vis on that same cam
    );
    expect(fogAlert(alerts)).toBeUndefined();
  });

  it('fires (moderate) when TWO cameras corroborate', () => {
    const alerts = buildMaritimeFogAlerts(
      [], new Map(), noStations,
      true, 2, ['cam-a', 'cam-b'], undefined, undefined, 0,
    );
    const fog = fogAlert(alerts);
    expect(fog).toBeDefined();
    expect(fog!.severity).toBe('moderate'); // webcam-only is capped (T3a)
  });

  it('fires (high) on a SINGLE certified AEMET visibility station (government sensor)', () => {
    const regionalVis = new Map([
      ['1400', { stationId: '1400', name: 'Fisterra', lat: 42.9, lon: -9.27, visibility: 0.3, timestamp: new Date() }],
    ]);
    const alerts = buildMaritimeFogAlerts(
      [], new Map(), noStations,
      false, 0, [], undefined, regionalVis, 0,
    );
    const fog = fogAlert(alerts);
    expect(fog).toBeDefined();
    expect(fog!.severity).toBe('high');
  });
});

describe('buildMaritimeFogAlerts — rain at the airport is not fog (6-oct)', () => {
  it('a sub-kilometre METAR the report puts down to rain does not fire', () => {
    const regionalVis = new Map([
      ['metar_LEVX', { stationId: 'metar_LEVX', name: 'Vigo/Peinador (METAR)', lat: 42.239, lon: -8.624, visibility: 0.8, timestamp: new Date(), precipitating: true as const }],
    ]);
    const alerts = buildMaritimeFogAlerts([], new Map(), [], false, 0, [], undefined, regionalVis, 0);
    expect(alerts.find((a) => a.category === 'fog')).toBeUndefined();
  });
});

describe('buildMaritimeFogAlerts — cameras against the physics (30-sep, Ons Praia)', () => {
  // 18:30 UTC: 20:30 in Madrid, 18:30 on a UTC runner. The level is 'alto' under both
  // (confidence 85 or 90), so the tests assert levels and wording, never the exact number.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T18:30:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Ribeira at dusk on 30-sep: air 1.1 °C above the water, 88 % humidity, a light onshore breeze.
  // The buoy carries its own air temperature, humidity and wind, so no station is needed.
  const ribeira = (): BuoyReading => ({
    stationId: 1255, stationName: 'Ribeira', timestamp: new Date().toISOString(),
    waveHeight: null, waveHeightMax: null, wavePeriod: null, wavePeriodMean: null, waveDir: null,
    windSpeed: 3, windDir: 250, windGust: null,
    waterTemp: 16, airTemp: 17.1, airPressure: null,
    currentSpeed: null, currentDir: null, salinity: null, seaLevel: null,
    humidity: 88, dewPoint: null, source: 'obscosteiro',
  });
  const physics = (a: ReturnType<typeof buildMaritimeFogAlerts>) => a.find((x) => x.id === 'maritime-fog');
  const build = (fog: boolean | undefined, fogCount: number, clear?: number) =>
    buildMaritimeFogAlerts([ribeira()], new Map(), [], fog, fogCount, fog ? ['mg-ons-praia'] : [],
      undefined, undefined, 0, clear);

  it('without cameras the physics alone is a risk, not a probable fog (44 of 73 nights read «alto»)', () => {
    const a = physics(build(undefined, 0));
    expect(a?.title).toBe('Riesgo de niebla marítima');
    expect(a?.severity).toBe('info');
    expect(a?.urgent).toBe(false);
    expect(a?.detail).toMatch(/sin confirmar/);
    expect(a?.detail).not.toMatch(/confianza/);
    expect(a?.confidence).toBeUndefined();
  });

  it('cameras that were not looking (night, gate closed) say nothing either way: same as no cameras', () => {
    const stale = physics(build(false, 0, 0));
    const none = physics(build(undefined, 0));
    expect(stale?.title).toBe(none?.title);
    expect(stale?.detail).toBe(none?.detail);
  });

  it('ONE camera seeing fog while eleven see none does not raise it to PELIGRO: it comes down', () => {
    const a = physics(build(true, 1, 11));
    expect(a).toBeDefined();
    expect(a!.title).not.toMatch(/INMINENTE/);
    expect(a!.severity).not.toBe('critical');
    expect(a!.urgent).toBe(false);
    expect(a!.title).toBe('Riesgo de niebla marítima');
    expect(a!.detail).toMatch(/11 sitios con cámara no la ven/);
    expect(a!.detail).not.toMatch(/confianza/);
    expect(a!.confidence).toBeUndefined();
    expect(a!.fogMeta?.webcamConfirmed).toBe(false);
  });

  it('a lone camera with no other camera to contradict it neither raises nor lowers the alert', () => {
    const a = physics(build(true, 1, 0));
    expect(a?.title).toBe('Niebla marítima probable');
    expect(a?.urgent).toBe(false);
    expect(a?.detail).toMatch(/confianza/);
  });

  it('rain over the ría vetoes it (6-oct): two interval gauges wet, or a METAR in rain', () => {
    const wet = (id: string, mm: number) => [id, { ...reading({ stationId: id, precipitation: mm }), timestamp: new Date() }] as const;
    const twoWet = new Map([wet('mg_1', 0.8), wet('mg_2', 1.2)]);
    expect(physics(buildMaritimeFogAlerts([ribeira()], twoWet, [], undefined, 0, [], undefined, undefined, 0))).toBeUndefined();
    // drizzle in fog, one dripping gauge, or a day counter: no veto
    const drizzle = new Map([wet('mg_1', 0.2), wet('mg_2', 0.3)]);
    expect(physics(buildMaritimeFogAlerts([ribeira()], drizzle, [], undefined, 0, [], undefined, undefined, 0))?.title).toBe('Riesgo de niebla marítima');
    expect(activeRainVeto(new Map([wet('mg_1', 3)]))).toBe(false);
    expect(activeRainVeto(new Map([wet('wu_A', 12), wet('wu_B', 12)]))).toBe(false);
    const metar = new Map([['metar_LEVX', { precipitating: true as const, timestamp: new Date() }]]);
    expect(activeRainVeto(new Map(), metar)).toBe(true);
  });

  it('cameras that looked and saw no fog bring it down and say so', () => {
    const a = physics(build(false, 0, 1));
    expect(a?.title).toBe('Riesgo de niebla marítima');
    expect(a?.detail).toMatch(/1 sitio con cámara no la ve/);
    expect(a?.confidence).toBeUndefined();
  });

  it('two cameras still fire the corroborated alert, not the physics one', () => {
    const alerts = buildMaritimeFogAlerts([ribeira()], new Map(), [], true, 2, ['mg-ons-praia', 'mg-ons-porto'],
      undefined, undefined, 0, 10);
    expect(alerts.map((x) => x.id)).toEqual(['maritime-fog-webcam']);
  });
});
