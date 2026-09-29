/**
 * Exam day: 29-sep-2026, the southerly gale and the cold front over the Rías Baixas.
 *
 * That day brought out about twenty faults that had been in the code for months, one after
 * another, while the gale was blowing. Extreme days are exams: this file replays the day's
 * OFFICIAL data (see README.md) through the same functions production runs, and states what has
 * to come out of each. Every case also checks that the frozen data really contains its trap, so a
 * case cannot pass just because the day stopped exercising it.
 *
 * The data is in UTC; the cases are told in local time (CEST, UTC+2), as they were lived.
 * A reading counts at a given instant only once it had reached the database (it carries its own
 * delay: MeteoGalicia ~10 min, AEMET ~33 min), which is what the server could see at the time.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import data from './data.json';
import { applyQualityControl, QC_GUST_ABSOLUTE } from '../../readingQuality';
import {
  assessStrongWind, windAlertDue, episodesFromSends, reopenFromHistory, latestAt, safetySpots,
  WIND_EPISODE_GAP_MS, WIND_MAX_AGE_MIN, WIND_MAX_ALTITUDE_M, type WindEpisode, type WindSafetyLevel,
} from '../../windSafetyLogic';
import { opportunityAlertAllowed, type StationReading } from '../../analyzerLogic';
import { nearbyFromRows, fogCorroborated, type NearbyRow } from '../../fogAlertGate';
import { scoreAllSpots, reportedGustKt, gustIsCurrent } from '../../../src/services/spotScoringEngine';
import { getSpotsForSector } from '../../../src/config/spots';
import { upperWindAt, type UpperAirLevel } from '../../../src/services/synopticRegime';
import { buildRainAlerts } from '../../../src/services/alerts/rainAlerts';
import { rainInWindowMm, precipKindFor, type PrecipSample } from '../../../src/services/precipSemantics';
import { stationsToPaint } from '../../../src/services/icaPaint';
import { haversineDistance } from '../../../src/services/geoUtils';
import type { NormalizedReading, NormalizedStation } from '../../../src/types/station';
import type { HourlyForecast } from '../../../src/types/forecast';

// ── The frozen day ──────────────────────────────────────────

type Row = [string, number | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null];
interface Exam {
  stations: Record<string, { name: string; lat: number; lon: number; alt: number | null }>;
  readings: Record<string, Row[]>;
  upper850: Record<'rias' | 'embalse', [string, number, number][]>;
  rainForecast: { issuedAt: string; hours: [string, number | null, number | null][] };
  airQuality: { rows: [string, number, number, number, string][] };
}
const EXAM = data as unknown as Exam;
const MS_TO_KT = 1.94384;
const MIN = 60_000;

/** Local time of the day (CEST) to epoch ms. */
const local = (hhmm: string) => Date.parse(`2026-09-29T${hhmm}:00+02:00`);
const localHHMM = (ms: number) => new Date(ms + 2 * 3600_000).toISOString().slice(11, 16);

interface Measured { reading: NormalizedReading; qcFlag: number; reachedDbMs: number }

/** Every reading after today's quality control, as the ingestor would store it now. */
const measured: Measured[] = Object.entries(EXAM.readings).flatMap(([id, rows]) => rows.map((r) => {
  const t = Date.parse(`2026-09-29T${r[0]}:00Z`);
  const raw: NormalizedReading = {
    stationId: id, timestamp: new Date(t), windSpeed: r[1], windGust: r[2], windDirection: r[3],
    temperature: r[4], humidity: r[5], dewPoint: r[6], precipitation: r[7], solarRadiation: null, pressure: null,
  };
  const qc = applyQualityControl(raw);
  return { reading: qc.reading, qcFlag: qc.qcFlag, reachedDbMs: t + (r[8] ?? 0) * MIN };
}));

/** What the database held at `atMs`. */
const visibleAt = (atMs: number) => measured.filter((m) => m.reachedDbMs <= atMs);

function toStationReading({ reading: r }: Measured): StationReading {
  const s = EXAM.stations[r.stationId];
  return {
    station_id: r.stationId, latitude: s.lat, longitude: s.lon, altitude: s.alt, name: s.name, time: r.timestamp,
    wind_speed: r.windSpeed, wind_gust: r.windGust, wind_dir: r.windDirection, temperature: r.temperature, humidity: r.humidity,
  };
}

/** The latest reading of each station that the database held at `atMs`. */
function latestReadings(atMs: number): StationReading[] {
  return latestAt(visibleAt(atMs).map(toStationReading), (r) => r.station_id, atMs);
}

const levels850 = (sector: 'rias' | 'embalse'): UpperAirLevel[] =>
  EXAM.upper850[sector].map(([time, ms, dir]) => ({ time, pressureHpa: 850, windSpeedMs: ms, windDirDeg: dir }));

afterEach(() => { vi.useRealTimers(); });

// ── 1. The gale: one message per episode ────────────────────

interface Send { key: string; atMs: number; level: WindSafetyLevel }

/**
 * The strong-wind pipeline of analyzer.ts, cycle by cycle (every 5 min) from 06:00 to 22:00, with
 * the three restarts of that day (the deploys of 16:40, 21:35 and 21:40). A restart rebuilds the
 * episodes exactly as index.ts does: from the stored sends, and then from the readings.
 */
function replayTheGale() {
  const spots = safetySpots();
  const restarts = new Set(['16:40', '21:35', '21:40'].map(local));
  const sends: Send[] = [];
  const openAfterRestart: Record<string, string[]> = {};
  const levelAt = new Map<number, WindSafetyLevel | null>();
  const embalse: (WindSafetyLevel | null)[] = [];
  let episodes = new Map<string, WindEpisode>();
  for (let t = local('06:00'); t <= local('22:00'); t += 5 * MIN) {
    if (restarts.has(t)) {
      episodes = episodesFromSends(sends, t);
      const history = visibleAt(t).map(toStationReading).filter((r) => r.wind_gust != null
        && (r.altitude ?? Infinity) <= Math.max(...Object.values(WIND_MAX_ALTITUDE_M))
        && t - new Date(r.time!).getTime() < WIND_EPISODE_GAP_MS + WIND_MAX_AGE_MIN * MIN);
      for (const [sector, ep] of reopenFromHistory(sends, new Set(episodes.keys()), spots, history, [], t)) episodes.set(sector, ep);
      openAfterRestart[localHHMM(t)] = [...episodes.keys()];
    }
    for (const a of assessStrongWind(spots, latestReadings(t), [], t)) {
      if (a.sector === 'rias') levelAt.set(t, a.level); else embalse.push(a.level);
      const { due, episode } = windAlertDue(episodes.get(a.sector), a.level, t);
      if (episode) episodes.set(a.sector, episode); else episodes.delete(a.sector);
      if (!due || !a.level || !episode) continue;
      episode.sentLevel = a.level; // the send went through
      sends.push({ key: `wind:${a.sector}`, atMs: t, level: a.level });
    }
  }
  return { sends, openAfterRestart, levelAt, embalse };
}

describe('29-sep exam — the gale warns once, and escalates once', () => {
  const day = replayTheGale();

  it('aviso when two sources passed 35 kt, peligro when two passed 40, and nothing more all day', () => {
    // On the day the message went out at 12:06: the alert was deployed at noon. With the
    // stations alone (no buoys here) the rules find the gale at dawn.
    expect(day.sends.map((s) => [localHHMM(s.atMs), s.level])).toEqual([['07:35', 'aviso'], ['08:00', 'peligro']]);
  });

  it('the deploys of 16:40, 21:35 and 21:40 found the gale open and did not announce it again', () => {
    expect(day.openAfterRestart).toEqual({ '16:40': ['rias'], '21:35': ['rias'], '21:40': ['rias'] });
  });

  it('the trap is there: at 16:40 the last message was 9 h old, and the stored sends alone would have repeated it', () => {
    const t = local('16:40');
    const fromSendsOnly = episodesFromSends(day.sends, t);
    expect(fromSendsOnly.size).toBe(0);
    expect(day.levelAt.get(t)).toBe('peligro');
    expect(windAlertDue(fromSendsOnly.get('rias'), 'peligro', t).due).toBe(true);
  });

  it('one episode from dawn to the front: no lull as long as the episode gap, and silence after 20:30', () => {
    const cycles = [...day.levelAt.entries()];
    const first = day.sends[0].atMs;
    const lastStrong = Math.max(...cycles.filter(([, level]) => level != null).map(([t]) => t));
    let lull = 0;
    let longestLull = 0;
    for (const [t, level] of cycles) {
      if (t < first || t > lastStrong) continue;
      lull = level == null ? lull + 5 * MIN : 0;
      longestLull = Math.max(longestLull, lull);
    }
    expect(longestLull).toBeLessThan(WIND_EPISODE_GAP_MS);
    expect(lastStrong).toBeLessThan(local('20:30'));
    expect(cycles.some(([t]) => t >= local('20:30'))).toBe(true);
  });

  it('nothing near the reservoir: the embalse never warns', () => {
    expect(day.embalse.every((level) => level == null)).toBe(true);
  });
});

// ── 2. Real gusts above 45 kt are kept ─────────────────────

describe('29-sep exam — the gusts of a real gale survive quality control', () => {
  it('Cabo Udra 15:20: a 52 kt gust inside a 36 kt mean is weather, not a broken sensor', () => {
    const udra = measured.find((m) => m.reading.stationId === 'mg_10905' && localHHMM(m.reading.timestamp.getTime()) === '15:20')!;
    const row = EXAM.readings.mg_10905.find((r) => r[0] === '13:20')!;
    expect(row[2]! * MS_TO_KT).toBeGreaterThan(45); // the old ceiling threw it away
    expect(udra.reading.windGust! * MS_TO_KT).toBeCloseTo(52, 0);
  });

  it('no gust was thrown away for its size that day (up to 61 kt at Cabo Udra)', () => {
    // The gust-to-mean rule (3x) still drops a few: Porto de Vigo 14:10 (37 kt in a 12 kt mean),
    // Vilagarcía 20:00, Vigo-Campus 20:20, those two at the passage of the front. Whether a gust
    // factor above 3 is real in the lee of a harbour or at a front is an open question, not
    // settled here.
    expect(measured.filter((m) => m.qcFlag & QC_GUST_ABSOLUTE)).toEqual([]);
    const strongest = Math.max(...measured.map((m) => m.reading.windGust ?? 0)) * MS_TO_KT;
    expect(strongest).toBeGreaterThan(60);
  });
});

// ── 3. No invitation to sail with a front aloft ────────────

describe('29-sep exam — no invitation to sail while the front blows at 1.500 m', () => {
  it('every hour from 06:00 to 21:00, both sectors: the opportunity alert stays shut', () => {
    for (let t = local('06:00'); t <= local('21:00'); t += 60 * MIN) {
      const upperWind = { rias: upperWindAt(levels850('rias'), t), embalse: upperWindAt(levels850('embalse'), t) };
      expect(upperWind.rias).not.toBeNull();
      expect(upperWind.embalse).not.toBeNull();
      expect(opportunityAlertAllowed('rias', upperWind)).toBe(false);
      expect(opportunityAlertAllowed('embalse', upperWind)).toBe(false);
    }
  });
});

// ── 4. No «Brisa SW (tardes)» under the front ──────────────

describe('29-sep exam — no afternoon breeze named in a gale', () => {
  function scoreAt(hhmm: string, withUpperAir: boolean) {
    const t = local(hhmm);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(t);
    const stations: NormalizedStation[] = Object.entries(EXAM.stations).map(([id, s]) => ({
      id, source: id.startsWith('mg_') ? 'meteogalicia' : 'aemet', name: s.name, lat: s.lat, lon: s.lon, altitude: s.alt ?? 0,
    }));
    const readings = new Map<string, NormalizedReading>();
    for (const m of visibleAt(t)) {
      const cur = readings.get(m.reading.stationId);
      if (!cur || cur.timestamp < m.reading.timestamp) readings.set(m.reading.stationId, m.reading);
    }
    const upperWind = withUpperAir ? upperWindAt(levels850('rias'), t) : null;
    const spots = getSpotsForSector('rias');
    const scores = scoreAllSpots(spots, stations, readings, [], undefined, undefined, undefined, undefined, upperWind);
    const breeze = [...scores.entries()]
      .filter(([id, s]) => spots.find((p) => p.id === id)!.windPatterns.find((p) => p.name === s.wind?.matchedPattern)?.thermal)
      .map(([id, s]) => `${id}: ${s.wind!.matchedPattern}`);
    return breeze;
  }

  it('16:00: with the front aloft, no spot calls the gale a breeze', () => {
    expect(scoreAt('16:00', true)).toEqual([]);
  });

  it('the trap is there: without the 850 hPa wind, four spots would have said «Brisa SW (tardes)»', () => {
    expect(scoreAt('16:00', false)).toEqual([
      'centro-ria: Brisa SW (tardes)', 'lourido: Brisa SW (tardes)', 'vao: Brisa SW (tardes)', 'illa-arousa: Brisa SW (tardes)',
    ]);
  });
});

// ── 5. The camera fog at Cangas is not sent ────────────────

describe('29-sep exam — a camera alone does not make fog', () => {
  it('15:29, Cangas webcam: the stations around it say it cannot be fog', () => {
    const t = local('15:29');
    const cam = { lat: 42.2604, lon: -8.7826 }; // mg-cangas, src/config/webcams.ts
    const rows: NearbyRow[] = visibleAt(t).map(({ reading: r }) => {
      const s = EXAM.stations[r.stationId];
      return { station_id: r.stationId, latitude: s.lat, longitude: s.lon, time: r.timestamp, wind_speed: r.windSpeed, temperature: r.temperature, dew_point: r.dewPoint, precip: r.precipitation };
    });
    const near = nearbyFromRows(rows, cam.lat, cam.lon, t);
    expect(near.length).toBeGreaterThanOrEqual(3);
    const verdict = fogCorroborated(near);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/viento/);
  });
});

// ── 6. The rain forecast of the afternoon is not a PELIGRO ─

describe('29-sep exam — the forecast rain of the front is moderate, not a danger', () => {
  const hours: HourlyForecast[] = EXAM.rainForecast.hours.map(([time, precip, prob]) => ({
    time: new Date(time), precipitation: precip, precipProbability: prob,
  } as HourlyForecast));

  it('the trap is there: 8.6 mm in the wettest hour (the old rule said PELIGRO above 5)', () => {
    expect(Math.max(...hours.map((h) => h.precipitation ?? 0))).toBeGreaterThan(5);
  });

  for (const hhmm of ['17:00', '20:30']) {
    it(`${hhmm}: moderate rain, not urgent`, () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(local(hhmm));
      const [alert] = buildRainAlerts(hours);
      expect(alert.severity).toBe('moderate');
      expect(alert.urgent).toBe(false);
    });
  }
});

// ── 7. Rain gauges: a broken counter is not rain, real rain is ──

describe('29-sep exam — rain in a window', () => {
  it('a day counter jumping 10-50 mm every 5 min (a home station in Nigrán that day) gives no rain at all', () => {
    // Anonymised: the shape of that counter (294 -> 981 mm in three hours), no id or place.
    expect(precipKindFor('wu_EXAMPLE')).toBe('dayTotal');
    const t0 = local('19:00');
    const counter = [294, 312, 355, 371, 420, 433, 468, 519, 530, 575, 601, 648, 690];
    const samples: PrecipSample[] = counter.map((mm, i) => ({ t: t0 + i * 5 * MIN, mm }));
    expect(rainInWindowMm('wu_EXAMPLE', samples, t0 + 60 * MIN, 60)).toBeNull();
  });

  it('the heaviest official hour of the front is kept', () => {
    const t = local('20:10');
    let wettest = 0;
    for (const id of Object.keys(EXAM.readings)) {
      const samples = visibleAt(t)
        .filter((m) => m.reading.stationId === id && m.reading.precipitation != null)
        .map((m) => ({ t: m.reading.timestamp.getTime(), mm: m.reading.precipitation! }));
      wettest = Math.max(wettest, rainInWindowMm(id, samples, t, 60) ?? 0);
    }
    expect(wettest).toBeGreaterThan(3);
  });
});

// ── 8. Air quality: paint only what turned the layer on ────

describe('29-sep exam — the air-quality layer paints only the stations that turned it on', () => {
  it('20:00: one station inland at «Mala»; Coia, «Moderada» with the sea salt of the gale, stays unpainted', () => {
    const rows = EXAM.airQuality.rows.map(([station, lat, lon, ica]) => ({ station, lat, lon, ica }));
    const coia = rows.find((r) => r.station === 'Coia')!;
    expect(coia.ica).toBeGreaterThanOrEqual(2.8); // the old threshold painted it, covering the ría in orange
    expect(stationsToPaint(rows).map((r) => r.station)).toEqual(['Est-Ou']);
  });
});

// ── 9. The gust a spot shows is from the last hour ─────────

describe('29-sep exam — the gust at Cesantes at 21:13 is not an hour old', () => {
  it('Vigo airport measured 41 kt at 20:00 (it reached the database at 20:33); at 21:13 Cesantes shows the gust of now', () => {
    const t = local('21:13');
    const spot = getSpotsForSector('rias').find((s) => s.id === 'cesantes')!;
    const latest = new Map<string, NormalizedReading>();
    for (const m of visibleAt(t)) {
      const cur = latest.get(m.reading.stationId);
      if (!cur || cur.timestamp < m.reading.timestamp) latest.set(m.reading.stationId, m.reading);
    }
    const stationData = [...latest.values()].map((reading) => {
      const s = EXAM.stations[reading.stationId];
      return { reading, distKm: haversineDistance(spot.center[1], spot.center[0], s.lat, s.lon) };
    });

    const airport = stationData.find((d) => d.reading.stationId === 'aemet_1495')!;
    expect(localHHMM(airport.reading.timestamp.getTime())).toBe('20:00');
    expect(airport.reading.windGust! * MS_TO_KT).toBeCloseTo(41, 0);
    expect(airport.distKm).toBeLessThan(8);
    expect(gustIsCurrent(airport.reading.timestamp, t)).toBe(false);

    const shown = reportedGustKt(stationData, [], t);
    expect(shown).not.toBeNull();
    expect(shown!).toBeLessThan(25);
  });
});

// ── The data itself ─────────────────────────────────────────

describe('29-sep exam — the frozen data holds official sources only', () => {
  it('only MeteoGalicia and AEMET stations (no home stations, no buoys)', () => {
    expect(Object.keys(EXAM.stations).every((id) => /^(mg_|aemet_)/.test(id))).toBe(true);
    expect(Object.keys(EXAM.readings).every((id) => id in EXAM.stations)).toBe(true);
  });
});
