import { describe, it, expect } from 'vitest';
import {
  computeSurfVerdict,
  swellAlignmentMultiplier,
  nearestHour,
  beachWaveAt,
  deriveSurfNow,
  buildSurfEntry,
  sameSurfEntry,
  surfDisplayState,
  formatSurfWave,
  DEFAULT_COASTAL_FACTOR,
  isReadingSetPartial,
  surfBestRank,
  surfView,
  type SurfWindSource,
} from './surfVerdictEngine';
import type { MarineForecastHour } from '../api/marineClient';
import type { NormalizedStation, NormalizedReading } from '../types/station';
import { scoreAllSpots } from './spotScoringEngine';
import { EMBALSE_SPOTS } from '../config/spots';

describe('computeSurfVerdict', () => {
  // ── Base levels (no modifiers) ──
  it('returns FLAT for <0.3m', () => {
    expect(computeSurfVerdict(0.2, 8, false, false).label).toBe('FLAT');
  });
  it('returns PEQUE for 0.3-0.8m', () => {
    expect(computeSurfVerdict(0.5, 8, false, false).label).toBe('PEQUE');
  });
  it('returns SURF OK for 0.8-1.5m', () => {
    expect(computeSurfVerdict(1.0, 8, false, false).label).toBe('SURF OK');
  });
  it('returns CLÁSICO for 1.5-2.5m', () => {
    expect(computeSurfVerdict(2.0, 8, false, false).label).toBe('CLÁSICO');
  });
  it('returns GRANDE for >=2.5m', () => {
    expect(computeSurfVerdict(3.0, 8, false, false).label).toBe('GRANDE');
  });

  // ── Offshore bonus (+1) ──
  it('offshore upgrades PEQUE to SURF OK', () => {
    expect(computeSurfVerdict(0.5, 8, true, false).label).toBe('SURF OK');
  });
  it('offshore does NOT upgrade FLAT (level 0)', () => {
    expect(computeSurfVerdict(0.1, 8, true, false).label).toBe('FLAT');
  });

  // ── Onshore penalty (-1) ──
  it('onshore downgrades SURF OK to PEQUE', () => {
    expect(computeSurfVerdict(1.0, 8, false, true).label).toBe('PEQUE');
  });

  // ── Period bonus (only if swell aligned) ──
  it('long period + aligned upgrades PEQUE to SURF OK', () => {
    expect(computeSurfVerdict(0.5, 12, false, false, true).label).toBe('SURF OK');
  });
  it('long period + NOT aligned does NOT upgrade', () => {
    expect(computeSurfVerdict(0.5, 12, false, false, false).label).toBe('PEQUE');
  });
  it('short period (<5s) downgrades', () => {
    expect(computeSurfVerdict(1.0, 3, false, false).label).toBe('PEQUE');
  });

  // ── Bonus cap at +1 ──
  it('offshore + long period capped at +1 total', () => {
    // 0.5m = PEQUE (1), offshore +1, period +1, but cap = +1 → SURF OK (2)
    expect(computeSurfVerdict(0.5, 12, true, false, true).label).toBe('SURF OK');
  });

  // ── Hard floor: CLÁSICO needs >= 1.0m ──
  it('0.8m + offshore cannot be CLÁSICO (hard floor 1.0m)', () => {
    // 0.8m = SURF OK (2), offshore +1 → would be 3 (CLÁSICO), but hard floor blocks
    expect(computeSurfVerdict(0.8, 12, true, false).label).toBe('SURF OK');
  });
  it('1.0m + offshore CAN be CLÁSICO', () => {
    expect(computeSurfVerdict(1.0, 12, true, false).label).toBe('CLÁSICO');
  });

  // ── Hard floor: GRANDE needs >= 1.8m ──
  it('1.7m + offshore cannot be GRANDE (hard floor 1.8m)', () => {
    // 1.7m = CLÁSICO (3), offshore +1 → would be 4 (GRANDE), but floor blocks
    expect(computeSurfVerdict(1.7, 12, true, false).label).toBe('CLÁSICO');
  });
  it('1.8m + offshore CAN be GRANDE', () => {
    expect(computeSurfVerdict(1.8, 12, true, false).label).toBe('GRANDE');
  });

  // ── Real scenario: Patos with 0.85m corrected, offshore, period 9s ──
  it('Patos typical: 0.85m offshore 9s = SURF OK (not CLÁSICO)', () => {
    const result = computeSurfVerdict(0.85, 9, true, false);
    expect(result.label).toBe('SURF OK');
  });

  // ── Summary includes details ──
  it('summary includes wave height and period', () => {
    const result = computeSurfVerdict(1.5, 10, false, false);
    expect(result.summary).toContain('~1,5 m');
    expect(result.summary).toContain('10s');
  });
  it('summary includes offshore warning text', () => {
    const result = computeSurfVerdict(1.0, 8, true, false);
    expect(result.summary).toContain('offshore');
  });
});

describe('swellAlignmentMultiplier', () => {
  it('frontal swell (0° diff) returns 1.0', () => {
    expect(swellAlignmentMultiplier(270, 270)).toBe(1.0);
  });
  it('45° angle returns ~0.75', () => {
    const result = swellAlignmentMultiplier(315, 270);
    expect(result).toBeCloseTo(0.75, 1);
  });
  it('90° lateral returns 0.5', () => {
    expect(swellAlignmentMultiplier(0, 270)).toBeCloseTo(0.5, 1);
  });
  it('behind the beach (>120°) returns 0.3', () => {
    expect(swellAlignmentMultiplier(90, 270)).toBe(0.3);
  });
  it('Lanzada (W 270°) with NW swell (315°) = ~0.75', () => {
    const result = swellAlignmentMultiplier(315, 270);
    expect(result).toBeGreaterThan(0.7);
    expect(result).toBeLessThan(0.8);
  });
  it('Patos (NW 315°) with NW swell (315°) = 1.0 (frontal)', () => {
    expect(swellAlignmentMultiplier(315, 315)).toBe(1.0);
  });
});

// ── One verdict from the hours and the consensus wind ───────────────
//
// These pin the helpers every surface now reads through the cache entry.
// Spot shapes mirror spots.ts (Lanzada: W beach, offshore NE/E; Patos: NW
// beach, offshore S/SSW, coastalFactor 0.45).

const LANZADA = { coastalFactor: 0.75, beachOrientation: 270, offshoreWindDir: [45, 90], swellDirections: [225, 270, 290] };
const PATOS = { coastalFactor: 0.45, beachOrientation: 315, offshoreWindDir: [180, 200], swellDirections: [315, 270] };
const NOW = Date.UTC(2026, 8, 27, 10, 40); // 12:40 CEST

function hour(offsetH: number, p: Partial<MarineForecastHour> = {}): MarineForecastHour {
  return {
    time: new Date(Date.UTC(2026, 8, 27, 10, 0) + offsetH * 3600_000),
    waveHeight: 1.0, wavePeriod: 8, waveDirection: 270,
    swellHeight: 1.0, swellPeriod: 8, swellDirection: 270,
    ...p,
  };
}

function windScore(dirDeg: number | null, provisional = false): SurfWindSource {
  return {
    provisional,
    wind: dirDeg == null ? null : {
      stationCount: 2, avgSpeedKt: 6, rawAvgSpeedKt: 6, dominantDir: 'X', dirDeg, matchedPattern: null, contributions: [],
    },
  };
}

describe('nearestHour', () => {
  it('picks the hour closest to now, not the first one', () => {
    const hours = [hour(-3), hour(0), hour(1), hour(2)];
    expect(nearestHour(hours, NOW)?.time.getTime()).toBe(hours[2].time.getTime()); // 11:00Z is 20 min away
  });
  it('returns null when every hour is further than the freshness limit', () => {
    expect(nearestHour([hour(-6), hour(-5)], NOW)).toBeNull();
  });
});

describe('beachWaveAt', () => {
  it('applies coastalFactor and swell alignment to the swell height', () => {
    const w = beachWaveAt(LANZADA, hour(0, { swellHeight: 2.0, swellDirection: 315 }));
    expect(w.rawHeight).toBe(2.0);
    expect(w.alignment).toBeCloseTo(0.75, 2);
    expect(w.height).toBeCloseTo(2.0 * 0.75 * 0.75, 3);
  });
  it('falls back to the sea height and its direction when swell is missing', () => {
    const w = beachWaveAt(LANZADA, hour(0, { swellHeight: null, swellDirection: null, swellPeriod: null, waveHeight: 1.2, waveDirection: 270, wavePeriod: 7 }));
    expect(w.rawHeight).toBe(1.2);
    expect(w.swellDir).toBe(270);
    expect(w.period).toBe(7);
    expect(w.height).toBeCloseTo(1.2 * 0.75, 3);
  });
  it('uses the default coastal factor when the spot has none', () => {
    const w = beachWaveAt({ beachOrientation: 270 }, hour(0, { swellHeight: 1.0, swellDirection: 270 }));
    expect(w.height).toBeCloseTo(DEFAULT_COASTAL_FACTOR, 5);
  });
});

describe('deriveSurfNow', () => {
  const hours = [hour(0, { swellHeight: 0.8, swellPeriod: 8, swellDirection: 270 }), hour(1, { swellHeight: 0.8, swellPeriod: 8, swellDirection: 270 })];
  // 0.8 × 0.75 × 1.0 = 0.6 m at the beach → PEQUE before wind

  it('offshore consensus wind lifts the verdict one level', () => {
    const r = deriveSurfNow(LANZADA, hours, windScore(60), NOW)!;
    expect(r.height).toBeCloseTo(0.6, 3);
    expect(r.verdict.label).toBe('SURF OK');
    expect(r.verdict.level).toBe(2);
    expect(r.windPending).toBe(false);
  });
  it('onshore consensus wind drops it one level', () => {
    const r = deriveSurfNow(LANZADA, [hour(1, { swellHeight: 1.4, swellDirection: 270 })], windScore(270), NOW)!;
    // 1.4 × 0.75 = 1.05 m → SURF OK, onshore → PEQUE
    expect(r.verdict.label).toBe('PEQUE');
  });
  it('without a score the wind is pending and no wind modifier applies', () => {
    const r = deriveSurfNow(LANZADA, hours, undefined, NOW)!;
    expect(r.windPending).toBe(true);
    expect(r.verdict.label).toBe('PEQUE');
    expect(r.verdict.summary).not.toMatch(/offshore|onshore/);
  });
  it('a provisional score counts as pending wind', () => {
    const r = deriveSurfNow(LANZADA, hours, windScore(60, true), NOW)!;
    expect(r.windPending).toBe(true);
    expect(r.verdict.label).toBe('PEQUE');
  });
  it('a score without a wind consensus yet (cold load) counts as pending wind', () => {
    const r = deriveSurfNow(LANZADA, hours, windScore(null), NOW)!;
    expect(r.windPending).toBe(true);
    expect(r.verdict.label).toBe('PEQUE');
  });
  it('uses the hour closest to now', () => {
    const r = deriveSurfNow(PATOS, [hour(-2, { swellHeight: 3.0 }), hour(1, { swellHeight: 1.0, swellDirection: 315 })], windScore(null), NOW)!;
    expect(r.hourTime).toBe(hour(1).time.getTime());
    expect(r.height).toBeCloseTo(0.45, 3);
  });
  it('an hour with no height at all is missing data, never FLAT', () => {
    expect(deriveSurfNow(PATOS, [hour(1, { swellHeight: null, waveHeight: null })], windScore(null), NOW)).toBeNull();
  });
  it('regression: 0.85 m, 12 s, aligned is SURF OK (the marker-only copy said CLÁSICO)', () => {
    // 1.0 raw × 0.85 default × 1.0 aligned = 0.85 m; the period bonus lifts it
    // to level 3 and the 1.0 m CLÁSICO floor brings it back to SURF OK.
    const r = deriveSurfNow({ beachOrientation: 270, swellDirections: [270] }, [hour(1, { swellHeight: 1.0, swellPeriod: 12, swellDirection: 270 })], windScore(null), NOW)!;
    expect(r.height).toBeCloseTo(0.85, 3);
    expect(r.verdict.label).toBe('SURF OK');
  });
});

describe('buildSurfEntry', () => {
  it('keeps every downloaded hour and marks the value as model', () => {
    const hours = [hour(0), hour(1), hour(2)];
    const e = buildSurfEntry(LANZADA, hours, windScore(60), NOW, 123);
    expect(e.hours).toBe(hours);
    expect(e.fetchedAt).toBe(123);
    expect(e.basis).toBe('modelo');
    expect(e.hourTime).toBe(hours[1].time.getTime());
    expect(surfDisplayState(e, null)).toBe('ready');
  });
  it('without a usable hour it carries no verdict: «sin dato», not loading', () => {
    const e = buildSurfEntry(LANZADA, [], windScore(60), NOW, 1);
    expect(e.verdict).toBeNull();
    expect(e.waveHeight).toBeNull();
    expect(surfDisplayState(e, null)).toBe('nodata');
    expect(surfDisplayState(undefined, null)).toBe('loading');
  });
  it('sameSurfEntry ignores a rebuild that renders the same', () => {
    const hours = [hour(1)];
    const a = buildSurfEntry(LANZADA, hours, windScore(60), NOW, 1);
    const b = buildSurfEntry(LANZADA, hours, windScore(62), NOW, 1);
    expect(sameSurfEntry(a, b)).toBe(true);
    const c = buildSurfEntry(LANZADA, hours, windScore(270), NOW, 1);
    expect(sameSurfEntry(a, c)).toBe(false);
  });
});

describe('formatSurfWave', () => {
  it('writes the tilde (approximate) and a decimal comma', () => {
    expect(formatSurfWave(1.04)).toBe('~1,0 m');
    expect(formatSurfWave(0.65)).toBe('~0,7 m');
  });
});

// ── Review fixes (27-sep): gate, variable wind, missing wind, copy, colour ──

const LEVEL_HEIGHTS: [number, string][] = [[0.1, 'FLAT'], [0.5, 'PEQUE'], [1.0, 'SURF OK'], [2.0, 'CLÁSICO'], [3.0, 'GRANDE']];

describe('surf copy describes the sea, never who it suits', () => {
  it('no level claims aptitude or invites anyone in', () => {
    for (const [h] of LEVEL_HEIGHTS) {
      const s = computeSurfVerdict(h, 8, false, false).summary;
      expect(s).not.toMatch(/iniciarse|ideal|longboard|meterse|puedes|apto/i);
    }
  });
  it('a FLAT reached through a wind sea does not say «Mar plano»', () => {
    // 0.7 m is PEQUE by height; a 4 s period (wind chop) takes it to level 0
    const r = computeSurfVerdict(0.7, 4, false, false);
    expect(r.label).toBe('FLAT');
    expect(r.summary).not.toMatch(/Mar plano|sin olas para surf/);
    expect(r.summary).toMatch(/^Sin olas surfeables/);
    expect(r.summary).toContain('~0,7 m');
  });
  it('a FLAT sea still says «Mar plano»', () => {
    expect(computeSurfVerdict(0.2, 8, false, false).summary).toMatch(/^Mar plano/);
  });
});

describe('deriveSurfNow — a direction nobody can state decides nothing', () => {
  const hours = [hour(1, { swellHeight: 1.4, swellDirection: 270 })]; // 1.05 m at Lanzada → SURF OK
  function varWind(dirDeg: number, dirSteadiness: number): SurfWindSource {
    return {
      provisional: false,
      wind: { stationCount: 3, avgSpeedKt: 7, rawAvgSpeedKt: 7, dominantDir: 'W', dirDeg, dirSteadiness, matchedPattern: null, contributions: [] },
    };
  }
  it('variable (steadiness 0.4) onshore W: no penalty, no «onshore» in the summary', () => {
    const r = deriveSurfNow(LANZADA, hours, varWind(270, 0.4), NOW)!;
    expect(r.windPending).toBe(false);
    expect(r.verdict.label).toBe('SURF OK');
    expect(r.verdict.summary).not.toMatch(/onshore|offshore/);
  });
  it('the same W with the sources agreeing (0.9) is onshore', () => {
    const r = deriveSurfNow(LANZADA, hours, varWind(270, 0.9), NOW)!;
    expect(r.verdict.label).toBe('PEQUE');
    expect(r.verdict.summary).toMatch(/onshore/);
  });
});

// ── Field check, Patos 27-sep 17:30 ─────────────────────────────────
//
// Model 0.6 m at the beach, 9 s, NW (onshore) 4 kt gusting 7-8, high tide.
// The card said FLAT; the webcam showed a surf school catching waves. The
// wind changes how clean the waves are, not whether there are any.

describe('the wind never erases waves that are there', () => {
  // 1.33 m NW swell × 0.45 (Patos) × 1.0 aligned ≈ 0.6 m at the beach
  const hours = [hour(1, { swellHeight: 1.33, swellPeriod: 9, swellDirection: 315 })];
  function nw(kt: number): SurfWindSource {
    return {
      provisional: false,
      wind: { stationCount: 6, avgSpeedKt: kt, rawAvgSpeedKt: kt, dominantDir: 'NW', dirDeg: 296, dirSteadiness: 0.9, matchedPattern: null, contributions: [] },
    };
  }
  it('Patos with a 4 kt NW is PEQUE, and the breeze is not called onshore', () => {
    const r = deriveSurfNow(PATOS, hours, nw(4), NOW)!;
    expect(r.height).toBeCloseTo(0.6, 2);
    expect(r.verdict.label).toBe('PEQUE');
    expect(r.verdict.summary).not.toMatch(/onshore/);
  });
  it('with 5 kt the NW counts as onshore but still cannot make it FLAT', () => {
    const r = deriveSurfNow(PATOS, hours, nw(5), NOW)!;
    expect(r.verdict.label).toBe('PEQUE');
    expect(r.verdict.summary).toMatch(/onshore/);
  });
  it('onshore on its own never takes a PEQUE sea to FLAT, at any speed', () => {
    expect(computeSurfVerdict(0.35, 8, false, true).label).toBe('PEQUE');
    expect(computeSurfVerdict(0.7, 9, false, true).label).toBe('PEQUE');
  });
  it('onshore plus a wind sea can', () => {
    expect(computeSurfVerdict(0.7, 4, false, true).label).toBe('FLAT');
  });
  it('an offshore breeze under 5 kt does not lift the verdict either', () => {
    // Lanzada: 0.8 × 0.75 = 0.6 m → PEQUE; NE 60° is its offshore
    const lanzadaHours = [hour(1, { swellHeight: 0.8, swellPeriod: 8, swellDirection: 270 })];
    const light: SurfWindSource = { provisional: false, wind: { ...nw(3).wind!, dirDeg: 60, dominantDir: 'NE' } };
    const fresh: SurfWindSource = { provisional: false, wind: { ...nw(8).wind!, dirDeg: 60, dominantDir: 'NE' } };
    expect(deriveSurfNow(LANZADA, lanzadaHours, light, NOW)!.verdict.label).toBe('PEQUE');
    expect(deriveSurfNow(LANZADA, lanzadaHours, fresh, NOW)!.verdict.label).toBe('SURF OK');
  });
});

describe('SURF OK needs 0.5 m at the beach', () => {
  it('a bonus cannot lift 0.45 m to SURF OK', () => {
    expect(computeSurfVerdict(0.45, 8, true, false).label).toBe('PEQUE');
    expect(computeSurfVerdict(0.45, 12, false, false, true).label).toBe('PEQUE');
  });
  it('from 0.5 m it can', () => {
    expect(computeSurfVerdict(0.5, 8, true, false).label).toBe('SURF OK');
  });
});

describe('deriveSurfNow — no wind consensus', () => {
  const hours = [hour(1, { swellHeight: 0.8, swellPeriod: 8, swellDirection: 270 })]; // 0.6 m → PEQUE
  it('while the readings are still arriving it waits', () => {
    const r = deriveSurfNow(LANZADA, hours, windScore(null), NOW, true)!;
    expect(r.windPending).toBe(true);
  });
  it('with the reading set complete the wind is really absent: final verdict, no modifier', () => {
    const r = deriveSurfNow(LANZADA, hours, windScore(null), NOW, false)!;
    expect(r.windPending).toBe(false);
    expect(r.verdict.label).toBe('PEQUE');
    expect(r.verdict.summary).not.toMatch(/onshore|offshore/);
  });
  it('without a score at all it always waits', () => {
    expect(deriveSurfNow(LANZADA, hours, undefined, NOW, false)!.windPending).toBe(true);
  });
});

describe('surfDisplayState / surfView', () => {
  const ready = buildSurfEntry(LANZADA, [hour(1, { swellHeight: 1.4, swellDirection: 270 })], windScore(60), NOW, 1);
  const gate = { hardGateTriggered: 'Viento 30kt > 25kt' };

  it('the engine hard gate wins over everything, even with no entry at all', () => {
    expect(surfDisplayState(ready, gate)).toBe('danger');
    expect(surfDisplayState(undefined, gate)).toBe('danger');
    expect(surfDisplayState(ready, { hardGateTriggered: null })).toBe('ready');
  });
  it('danger: no surf label, the wave figure still available', () => {
    const v = surfView(ready, gate);
    expect(v.state).toBe('danger');
    expect('label' in v).toBe(false);
    expect(v.wave).toMatch(/^~1,\d m \(modelo\)$/);
  });
  it('ready: label, model height and summary, colour per theme', () => {
    const dark = surfView(ready, null, 'dark');
    const light = surfView(ready, null, 'light');
    if (dark.state === 'danger' || light.state === 'danger') throw new Error('unexpected danger');
    expect(dark.label).toBe(ready.verdict!.label);
    expect(dark.wave).toBe(`${formatSurfWave(ready.waveHeight!)} (modelo)`);
    expect(dark.summary).toBe(ready.verdict!.summary);
    expect(dark.color).toBe(ready.verdict!.text);
    expect(light.color).toBe(ready.verdict!.lightText);
  });
  it('loading: «Calculando…» and what it is waiting for — never the pending verdict', () => {
    const pending = buildSurfEntry(LANZADA, [hour(1)], windScore(null), NOW, 1, true);
    const v = surfView(pending, null);
    if (v.state === 'danger') throw new Error('unexpected danger');
    expect(v.state).toBe('loading');
    expect(v.label).toBe('Calculando…');
    expect(v.wave).toBeNull();
    expect(v.summary).toBe('Esperando el viento de las estaciones…');
    expect(v.summary).not.toBe(pending.verdict!.summary);
    const none = surfView(undefined, null);
    if (none.state === 'danger') throw new Error('unexpected danger');
    expect(none.summary).toBe('Cargando previsión de olas…');
  });
  it('nodata: says so, promises nothing', () => {
    const v = surfView(buildSurfEntry(LANZADA, [], windScore(60), NOW, 1), null);
    if (v.state === 'danger') throw new Error('unexpected danger');
    expect(v.state).toBe('nodata');
    expect(v.label).toBe('Sin dato de olas');
    expect(v.summary).toBeNull();
  });
});

describe('surfBestRank', () => {
  it('CLÁSICO > SURF OK > GRANDE; below SURF OK is not a candidate', () => {
    expect(surfBestRank(3)).toBeGreaterThan(surfBestRank(2));
    expect(surfBestRank(2)).toBeGreaterThan(surfBestRank(4));
    expect(surfBestRank(4)).toBeGreaterThan(0);
    expect(surfBestRank(1)).toBe(0);
    expect(surfBestRank(0)).toBe(0);
  });
});

describe('surf level colours are legible where they are drawn', () => {
  const lum = (hex: string) => {
    const [r, g, b] = (hex.replace('#', '').match(/../g) ?? []).map((x) => {
      const v = parseInt(x, 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  it.each(LEVEL_HEIGHTS)('%s m → %s: text ≥4.5 on the dark card/panel, lightText ≥4.5 on the light panel', (h) => {
    const v = computeSurfVerdict(h, 8, false, false);
    for (const bg of ['#0f172a', '#1e293b']) expect(contrast(v.text, bg)).toBeGreaterThanOrEqual(4.5);
    for (const bg of ['#f8fafc', '#e5e9ef']) expect(contrast(v.lightText, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('isReadingSetPartial mirrors the engine (spotScoringEngine readingSetPartial)', () => {
  // A sailing spot with exactly one wind source and no hard gate is provisional
  // exactly when the engine judges the set partial — so the flag exposes the
  // engine's rule, and the mirror must agree with it on every case.
  const castrelo = EMBALSE_SPOTS.find((s) => s.id === 'castrelo')!;
  const station = (id: string, lat: number, lon: number): NormalizedStation =>
    ({ id, name: id, lat, lon, altitude: 10, source: 'wunderground', tempOnly: false });
  const reading = (stationId: string, windSpeed: number | null): NormalizedReading => ({
    stationId, timestamp: new Date(), windSpeed, windGust: null, windDirection: windSpeed == null ? null : 250,
    temperature: 18, humidity: 55, precipitation: null, solarRadiation: null, pressure: 1015, dewPoint: 12,
  });
  it.each([[10, 1], [10, 3], [10, 4], [10, 10], [8, 1], [7, 1], [20, 7], [20, 8]])('%i stations, %i fresh', (total, fresh) => {
    const stations = [station('wu_MAIN', castrelo.center[1], castrelo.center[0])];
    for (let i = 1; i < total; i++) stations.push(station(`wu_FILL${i}`, 43.9, -6.5));
    const readings = new Map<string, NormalizedReading>([['wu_MAIN', reading('wu_MAIN', 8 / 1.94384)]]);
    for (let i = 1; i < fresh; i++) readings.set(`wu_FILL${i}`, reading(`wu_FILL${i}`, null));
    const engine = scoreAllSpots([castrelo], stations, readings, []).get('castrelo')!.provisional;
    expect(isReadingSetPartial(stations.length, readings.values(), Date.now())).toBe(engine);
  });
  it('a reading older than the stale limit is not fresh', () => {
    const old = { timestamp: new Date(Date.now() - 31 * 60_000) };
    expect(isReadingSetPartial(10, [old, old, old, old, old], Date.now())).toBe(true);
  });
});
