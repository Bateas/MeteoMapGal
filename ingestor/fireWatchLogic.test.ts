/**
 * Tests for ingestor/fireWatchLogic — pure dry-lightning classification.
 *
 * The DB query + dispatch paths (fireWatch.ts) are integration-only, same
 * pattern as the other ingestor cycles. Here we lock the rigor rules:
 * land filter, rain read with each network's meaning (per interval, day
 * counter, last hour), who may call a strike dry, conservative "no station =
 * not dry", clustering and watch thresholds.
 */

import { describe, it, expect } from 'vitest';
import { findMuteGauges,
  isLikelyLand,
  groupRainReadings,
  classifyStrikeDryness,
  clusterDryStrikes,
  computeFireWatch,
  freshZones,
  alertedZoneKey,
  parseAlertedZoneKey,
  fireWatchDigestText,
  placeName,
  WET_RAIN_MM,
  HIGH_CURRENT_KA,
  DIGEST_MAX_LISTED,
  type FireWatchStrike,
  type RainReading,
} from './fireWatchLogic';

// ── Builders (real interfaces, no ad-hoc shapes) ─────

const T0 = new Date('2026-08-05T14:00:00Z');

function minutes(m: number): Date {
  return new Date(T0.getTime() + m * 60_000);
}

function mkStrike(overrides: Partial<FireWatchStrike> = {}): FireWatchStrike {
  return {
    time: T0,
    lat: 42.34,   // Ourense interior — solidly land
    lon: -7.86,
    peakCurrent: -12,
    ...overrides,
  };
}

function mkRain(
  stationId: string,
  minsFromT0: number,
  precip: number,
  coords: { lat?: number; lon?: number } = {},
): RainReading {
  return {
    stationId,
    lat: coords.lat ?? 42.34,
    lon: coords.lon ?? -7.86,
    time: minutes(minsFromT0),
    precip,
  };
}

// ── isLikelyLand ─────────────────────────────────────

describe('isLikelyLand', () => {
  it('accepts interior Galicia (Ourense, Lugo)', () => {
    expect(isLikelyLand(42.34, -7.86)).toBe(true);  // Ourense
    expect(isLikelyLand(43.0, -7.55)).toBe(true);   // Lugo interior
    expect(isLikelyLand(42.88, -8.54)).toBe(true);  // Santiago
  });

  it('rejects open Atlantic west of the coast', () => {
    expect(isLikelyLand(42.2, -9.0)).toBe(false);   // off Vigo
    expect(isLikelyLand(42.9, -9.5)).toBe(false);   // off Fisterra
  });

  it('rejects the Cantabrico north of the coast cap', () => {
    expect(isLikelyLand(43.7, -7.5)).toBe(false);   // sea off A Marina
    expect(isLikelyLand(43.9, -8.0)).toBe(false);   // north of Estaca
  });

  it('rejects out-of-scope east and south', () => {
    expect(isLikelyLand(42.5, -6.2)).toBe(false);   // Leon/Zamora — land but out of scope
    expect(isLikelyLand(41.5, -8.0)).toBe(false);   // Portugal interior
  });

  it('is conservative on the coastal fringe (drops real coast rather than watch sea)', () => {
    // Cies islands (~42.22, -8.90) are real land but excluded by design.
    expect(isLikelyLand(42.22, -8.9)).toBe(false);
  });
});

// ── classifyStrikeDryness ────────────────────────────

/** Readings of one gauge every `step` minutes from `from` to `to` (minutes from T0). */
function every(
  stationId: string,
  from: number,
  to: number,
  step: number,
  mm: (m: number) => number,
  coords: { lat?: number; lon?: number } = {},
): RainReading[] {
  const out: RainReading[] = [];
  for (let m = from; m <= to; m += step) out.push(mkRain(stationId, m, mm(m), coords));
  return out;
}

/** Long after the strike: every reading has arrived, the window is over. */
const LATER = T0.getTime() + 6 * 60 * 60_000;

describe('classifyStrikeDryness', () => {
  it('steady rain at a MeteoGalicia gauge = WET (read as a day counter it looked flat, 0.4 - 0.4 = 0)', () => {
    // The bug fixed on 30-sep: MG gives the rain of each 10-minute interval, so a
    // steady 0.4 every reading is 0.4 mm every 10 min, not a counter standing still.
    const series = groupRainReadings(every('mg_1', -60, 180, 10, () => 0.4));
    expect(classifyStrikeDryness(mkStrike(), series, LATER)).toBe('wet');
  });

  it('an official gauge with nothing in the window = DRY on its own', () => {
    const series = groupRainReadings(every('mg_1', -60, 180, 10, () => 0));
    expect(classifyStrikeDryness(mkStrike(), series, LATER)).toBe('dry');
  });

  it('drizzle below WET_RAIN_MM in the window still counts as DRY', () => {
    const series = groupRainReadings(every('mg_1', -60, 180, 10, (m) => (m === 40 ? WET_RAIN_MM - 0.2 : 0)));
    expect(classifyStrikeDryness(mkStrike(), series, LATER)).toBe('dry');
  });

  it('rain just before the strike wets the fuel too: 1 mm 20 min before = WET', () => {
    const series = groupRainReadings(every('mg_1', -60, 180, 10, (m) => (m === -20 ? 1 : 0)));
    expect(classifyStrikeDryness(mkStrike(), series, LATER)).toBe('wet');
  });

  it('a day counter at 8.0 all afternoon (it rained at dawn) says dry, but a home gauge needs a second one', () => {
    const wu1 = every('wu_1', -60, 180, 5, () => 8.0);
    expect(classifyStrikeDryness(mkStrike(), groupRainReadings(wu1), LATER)).toBe('unknown');
    const wu2 = every('wu_2', -60, 180, 5, () => 2.0, { lat: 42.37 });
    expect(classifyStrikeDryness(mkStrike(), groupRainReadings([...wu1, ...wu2]), LATER)).toBe('dry');
  });

  it('a home gauge that measured rain is enough for WET', () => {
    const series = groupRainReadings(every('wu_1', -60, 180, 5, (m) => (m < 30 ? 3.0 : 4.2)));
    expect(classifyStrikeDryness(mkStrike(), series, LATER)).toBe('wet');
  });

  it('a lone 0 in a Meteoclimatic counter is not rain (21.1, 0, 21.1)', () => {
    const mc = every('mc_1', -60, 180, 15, (m) => (m === 30 ? 0 : 21.1));
    const wu = every('wu_2', -60, 180, 5, () => 2.0, { lat: 42.37 });
    expect(classifyStrikeDryness(mkStrike(), groupRainReadings([...mc, ...wu]), LATER)).toBe('dry');
  });

  it('an hourly AEMET gauge vouches for the window: the reading after its end closes it (Ibias, 5-sep)', () => {
    // Strike at 17:50 UTC; readings at the hour. The one at 20:00 closes a window that ends at 19:50.
    const strike = mkStrike({ time: new Date('2026-09-05T17:50:00Z') });
    const aemet = ['16:00', '17:00', '18:00', '19:00', '20:00', '21:00'].map((hh) => ({
      stationId: 'aemet_1309C', lat: 42.34, lon: -7.86, time: new Date(`2026-09-05T${hh}:00Z`), precip: 0,
    }));
    expect(classifyStrikeDryness(strike, groupRainReadings(aemet), Date.parse('2026-09-05T23:00:00Z'))).toBe('dry');
  });

  it('a hole in an interval gauge hides rain: it cannot say dry', () => {
    const series = groupRainReadings(every('mg_1', -60, 180, 10, () => 0).filter((r) => {
      const m = (r.time.getTime() - T0.getTime()) / 60_000;
      return m < 20 || m > 80;
    }));
    expect(classifyStrikeDryness(mkStrike(), series, LATER)).toBe('unknown');
  });

  it('pending until the window is over; rain decides at once', () => {
    const dry = groupRainReadings(every('mg_1', -60, 40, 10, () => 0));
    expect(classifyStrikeDryness(mkStrike(), dry, T0.getTime() + 40 * 60_000)).toBe('pending');
    const wet = groupRainReadings(every('mg_1', -60, 40, 10, (m) => (m === 30 ? 1.5 : 0)));
    expect(classifyStrikeDryness(mkStrike(), wet, T0.getTime() + 40 * 60_000)).toBe('wet');
    // Once the reading that closes the window has arrived, the same dry gauge decides.
    const closed = groupRainReadings(every('mg_1', -60, 60, 10, () => 0));
    expect(classifyStrikeDryness(mkStrike(), closed, T0.getTime() + 70 * 60_000)).toBe('dry');
  });

  it('no station within 15km = UNKNOWN (conservative, never dry)', () => {
    // Station ~22km north of the strike — outside MAX_STATION_KM.
    const series = groupRainReadings(every('mg_far', -60, 180, 10, () => 0, { lat: 42.54 }));
    expect(classifyStrikeDryness(mkStrike(), series, LATER)).toBe('unknown');
  });

  it('a network whose rain field we do not understand never votes', () => {
    const series = groupRainReadings(every('skyx_SKY100', -60, 180, 10, () => 0));
    expect(classifyStrikeDryness(mkStrike(), series, LATER)).toBe('unknown');
  });

  it('the NEAREST gauge that can say decides', () => {
    const nearWet = every('mg_near', -60, 180, 10, (m) => (m === 30 ? 2 : 0), { lat: 42.39 }); // ~5.5 km
    const farDry = every('mg_far', -60, 180, 10, () => 0, { lat: 42.44 }); // ~11 km
    expect(classifyStrikeDryness(mkStrike(), groupRainReadings([...nearWet, ...farDry]), LATER)).toBe('wet');
    const nearDry = every('mg_near', -60, 180, 10, () => 0, { lat: 42.39 });
    const farWet = every('mg_far', -60, 180, 10, (m) => (m === 30 ? 2 : 0), { lat: 42.44 });
    expect(classifyStrikeDryness(mkStrike(), groupRainReadings([...nearDry, ...farWet]), LATER)).toBe('dry');
  });
});

// ── clusterDryStrikes / watch thresholds ─────────────

describe('clusterDryStrikes', () => {
  it('groups strikes within 10km into one zone, splits distant groups', () => {
    const strikes = [
      mkStrike({ lat: 42.30, lon: -7.90 }),
      mkStrike({ lat: 42.30, lon: -7.82 }),  // ~6.6km from seed
      mkStrike({ lat: 42.30, lon: -7.40 }),  // ~41km — its own zone
    ];
    const zones = clusterDryStrikes(strikes);
    expect(zones).toHaveLength(2);
    expect(zones[0].strikeCount).toBe(2);
    expect(zones[1].strikeCount).toBe(1);
  });

  it('2+ dry strikes put a zone in watch even at low current', () => {
    const zones = clusterDryStrikes([
      mkStrike({ peakCurrent: -8 }),
      mkStrike({ lat: 42.35, peakCurrent: 10 }),
    ]);
    expect(zones).toHaveLength(1);
    expect(zones[0].inWatch).toBe(true);
  });

  it('a single low-current strike does NOT trigger watch', () => {
    const zones = clusterDryStrikes([mkStrike({ peakCurrent: -12 })]);
    expect(zones[0].inWatch).toBe(false);
  });

  it('a single high-current strike (>=30kA, either polarity) triggers watch', () => {
    const positive = clusterDryStrikes([mkStrike({ peakCurrent: HIGH_CURRENT_KA + 5 })]);
    expect(positive[0].inWatch).toBe(true);

    const negative = clusterDryStrikes([mkStrike({ peakCurrent: -(HIGH_CURRENT_KA + 2) })]);
    expect(negative[0].inWatch).toBe(true);
    expect(negative[0].maxAbsKa).toBe(HIGH_CURRENT_KA + 2);
  });

  it('null peakCurrent is treated as 0 (no watch from a single strike)', () => {
    const zones = clusterDryStrikes([mkStrike({ peakCurrent: null })]);
    expect(zones[0].maxAbsKa).toBe(0);
    expect(zones[0].inWatch).toBe(false);
  });
});

// ── One message per storm ────────────────────────────

describe('freshZones / fireWatchDigestText', () => {
  const zone = (lat: number, lon: number, strikeCount = 2, maxAbsKa = 12) =>
    ({ lat, lon, strikeCount, maxAbsKa, inWatch: true });
  const NOW = T0.getTime();

  it('a zone within 15 km of one announced in the last 12 h is the same episode', () => {
    const alerted = [{ lat: 42.34, lon: -7.86, atMs: NOW - 2 * 60 * 60_000 }];
    const near = zone(42.40, -7.86);   // ~6.7 km: same storm drifting
    const far = zone(42.60, -7.86);    // ~29 km: a new area
    expect(freshZones([near, far], alerted, NOW)).toEqual([far]);
  });

  it('after 12 h the same area is announced again', () => {
    const alerted = [{ lat: 42.34, lon: -7.86, atMs: NOW - 13 * 60 * 60_000 }];
    expect(freshZones([zone(42.34, -7.86)], alerted, NOW)).toHaveLength(1);
  });

  it('the key of an announced zone reads back, also the 0.1 degree keys stored before', () => {
    expect(alertedZoneKey({ lat: 42.3456, lon: -7.8612 })).toBe('42.35,-7.86');
    expect(parseAlertedZoneKey('42.35,-7.86')).toEqual({ lat: 42.35, lon: -7.86 });
    expect(parseAlertedZoneKey('42.4,-7.6')).toEqual({ lat: 42.4, lon: -7.6 });
    expect(parseAlertedZoneKey('rias')).toBeNull();
  });

  it('one zone reads as one; several are listed with the strongest first', () => {
    expect(fireWatchDigestText([{ lat: 42.34, lon: -7.86, strikeCount: 1, maxAbsKa: 35, near: 'Ribadavia' }]))
      .toBe('Vigilancia de incendio. Rayos a tierra sin lluvia cerca de Ribadavia (1 rayo, hasta 35 kA). '
        + 'Los incendios por rayo suelen aparecer entre 7 y 18 horas después.');
    const text = fireWatchDigestText([
      { lat: 42.3, lon: -7.9, strikeCount: 2, maxAbsKa: 12, near: 'A' },
      { lat: 43.0, lon: -7.4, strikeCount: 9, maxAbsKa: 53 },
    ]);
    expect(text).toBe('Vigilancia de incendio. Rayos a tierra sin lluvia en 2 zonas: zona 43.00,-7.40 (9 rayos, hasta 53 kA); '
      + 'cerca de A (2 rayos). Los incendios por rayo suelen aparecer entre 7 y 18 horas después.');
  });

  it('zones next to the same place are one place (5-sep: three clusters around Ancares)', () => {
    const text = fireWatchDigestText([
      { lat: 42.80, lon: -6.90, strikeCount: 81, maxAbsKa: 73, near: 'Ancares' },
      { lat: 42.85, lon: -6.85, strikeCount: 61, maxAbsKa: 39, near: 'Ancares' },
    ]);
    expect(text).toBe('Vigilancia de incendio. Rayos a tierra sin lluvia cerca de Ancares (142 rayos, hasta 73 kA). '
      + 'Los incendios por rayo suelen aparecer entre 7 y 18 horas después.');
  });

  it('station names read as places', () => {
    expect(placeName('IBIAS  SAN ANTOLIN')).toBe('Ibias San Antolin');
    expect(placeName('FOLGOSO DO COUREL')).toBe('Folgoso do Courel');
    expect(placeName('A GUDIÑA')).toBe('A Gudiña');
    expect(placeName('OURENSE-ESTACIÓNS')).toBe('Ourense-Estacións');
    expect(placeName('Ponte Boga')).toBe('Ponte Boga');
  });

  it(`names at most ${DIGEST_MAX_LISTED} zones and counts the rest`, () => {
    const zones = Array.from({ length: 8 }, (_, k) => ({ lat: 42 + k * 0.2, lon: -7.5, strikeCount: 10 - k, maxAbsKa: 5 }));
    const text = fireWatchDigestText(zones);
    expect(text).toContain('en 8 zonas');
    expect(text).toContain('; y 3 más. ');
    expect(text.match(/rayos\)/g)).toHaveLength(DIGEST_MAX_LISTED);
  });
});

// ── computeFireWatch (end-to-end pure pipeline) ──────

describe('computeFireWatch', () => {
  it('sea strikes are excluded, wet strikes filtered, dry strikes clustered into watch', () => {
    const strikes = [
      mkStrike({ lat: 42.2, lon: -9.0 }),                    // sea — excluded
      mkStrike({ lat: 42.34, lon: -7.86 }),                  // land, dry
      mkStrike({ lat: 42.36, lon: -7.84 }),                  // land, dry, same zone
      mkStrike({ lat: 42.88, lon: -8.54, peakCurrent: 20 }), // land, wet (Santiago)
    ];
    const rain = [
      // Ourense gauge: nothing in any interval → dry
      ...every('mg_our', -60, 180, 10, () => 0),
      // Santiago gauge: rain right after the strike → wet
      ...every('mg_sdc', -60, 180, 10, (m) => (m === 20 ? 3.0 : 0), { lat: 42.88, lon: -8.54 }),
    ];

    const result = computeFireWatch(strikes, rain, LATER);
    expect(result.totalStrikes).toBe(4);
    expect(result.landStrikes).toBe(3);
    expect(result.dryStrikes).toBe(2);
    expect(result.wetStrikes).toBe(1);
    expect(result.unknownStrikes).toBe(0);
    expect(result.pendingStrikes).toBe(0);
    expect(result.zones).toHaveLength(1);
    expect(result.watchZones).toHaveLength(1);
    expect(result.watchZones[0].strikeCount).toBe(2);
  });

  it('land strikes without rain data nearby stay out of watch (unknown, not dry)', () => {
    const result = computeFireWatch(
      [mkStrike(), mkStrike({ lat: 42.35 })],
      [],  // no rain context at all
      LATER,
    );
    expect(result.landStrikes).toBe(2);
    expect(result.dryStrikes).toBe(0);
    expect(result.unknownStrikes).toBe(2);
    expect(result.watchZones).toHaveLength(0);
  });

  it('a strike whose window is still open is pending, not watched yet', () => {
    const result = computeFireWatch([mkStrike()], every('mg_our', -60, 30, 10, () => 0), T0.getTime() + 30 * 60_000);
    expect(result.pendingStrikes).toBe(1);
    expect(result.dryStrikes).toBe(0);
  });
});

describe('findMuteGauges — gauges that read nothing when it rains around them (6-oct)', () => {
  // ~1 km = 0.009 deg of latitude
  const coords = new Map([
    ['mg_1', { lat: 42.10, lon: -8.50 }],      // official witness
    ['nt_mute', { lat: 42.15, lon: -8.50 }],   // 5.5 km: never collects
    ['wu_ok', { lat: 42.12, lon: -8.50 }],     // 2 km: collects
    ['wu_far', { lat: 42.30, lon: -8.50 }],    // 22 km: no official within 15 km, never collects
    ['wu_short', { lat: 42.14, lon: -8.50 }],  // only one wet day to judge by
  ]);
  const days = ['2026-09-29', '2026-10-01', '2026-10-05', '2026-10-06'];
  const daily = [
    ...days.map((day) => ({ stationId: 'mg_1', day, mm: 8 })),
    ...days.map((day) => ({ stationId: 'nt_mute', day, mm: 0 })),
    ...days.map((day) => ({ stationId: 'wu_ok', day, mm: 5 })),
    ...days.map((day) => ({ stationId: 'wu_far', day, mm: 0 })),
    { stationId: 'wu_short', day: '2026-10-06', mm: 0 },
  ];

  it('flags the gauge at zero on the days its official neighbour measured rain', () => {
    const m = findMuteGauges(daily, coords);
    expect(m.has('nt_mute')).toBe(true);
    expect(m.has('wu_ok')).toBe(false);
    expect(m.has('mg_1')).toBe(false);
  });

  it('judges a gauge with no official within 15 km against one within 30 km, only if always zero', () => {
    expect(findMuteGauges(daily, coords).has('wu_far')).toBe(true);
    const oneWet = daily.map((r) => (r.stationId === 'wu_far' && r.day === '2026-10-06' ? { ...r, mm: 1.2 } : r));
    expect(findMuteGauges(oneWet, coords).has('wu_far')).toBe(false);
  });

  it('needs at least two wet days to judge, and a summer dry spell flags nobody', () => {
    expect(findMuteGauges(daily, coords).has('wu_short')).toBe(false);
    const dry = daily.map((r) => ({ ...r, mm: 0 }));
    expect(findMuteGauges(dry, coords).size).toBe(0);
  });
});
