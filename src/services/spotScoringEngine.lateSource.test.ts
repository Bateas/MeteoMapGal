// A whole network late at once is late, not gone (keptWithLateSource).
// 3-nov 08:30, Cesantes: MeteoGalicia kept answering with its 07:50 record, its stations crossed the
// 40 min gate together, the spot went from 8 stations and 5.1 kt to 4 and 10.8 kt (BUENO), and back
// to 7 at 09:10 when the feed returned.
import { describe, it, expect } from 'vitest';
import { scoreAllSpots, keptWithLateSource, lateSourceAges, LATE_SOURCE_MAX_MIN } from './spotScoringEngine';
import type { NormalizedStation, NormalizedReading } from '../types/station';
import { RIAS_SPOTS } from '../config/spots';

const cesantes = RIAS_SPOTS.find((s) => s.id === 'cesantes')!;
const [lon, lat] = cesantes.center;
const msFromKt = (kt: number) => kt / 1.94384;

function station(id: string, dLat: number, dLon: number, source: NormalizedStation['source']): NormalizedStation {
  return { id, name: id, lat: lat + dLat, lon: lon + dLon, altitude: 20, source, tempOnly: false };
}

function reading(id: string, kt: number, dir: number, ageMin: number): NormalizedReading {
  return {
    stationId: id, timestamp: new Date(Date.now() - ageMin * 60_000),
    windSpeed: msFromKt(kt), windGust: null, windDirection: dir,
    temperature: 14, humidity: 80, precipitation: null, solarRadiation: null, pressure: 1015, dewPoint: 10,
  };
}

/** Six MeteoGalicia stations around the spot reading the real 5 kt, and three amateur ones reading 11. */
function network(mgAgeMin: number, extra: { st: NormalizedStation; rd: NormalizedReading }[] = []) {
  const mg = [[0.02, 0.01], [-0.02, 0.02], [0.01, -0.03], [-0.03, -0.01], [0.03, 0.03], [0, 0.04]].map(([a, b], i) => {
    const st = station(`mg_9990${i}`, a, b, 'meteogalicia');
    return { st, rd: reading(st.id, 5, 80, mgAgeMin) };
  });
  const nt = [[0.01, 0.01], [-0.01, -0.02], [0.02, -0.01]].map(([a, b], i) => {
    const st = station(`nt_test${i}`, a, b, 'netatmo');
    return { st, rd: reading(st.id, 11, 50, 3) };
  });
  return [...mg, ...nt, ...extra];
}

function score(entries: { st: NormalizedStation; rd: NormalizedReading }[]) {
  return scoreAllSpots([cesantes], entries.map((e) => e.st), new Map(entries.map((e) => [e.st.id, e.rd])), []).get('cesantes')!;
}

describe('keptWithLateSource', () => {
  it('keeps a station that reported at its late source’s last record', () => {
    expect(keptWithLateSource('mg_10157', 50, 50)).toBe(true);
    expect(keptWithLateSource('mg_10157', 58, 50)).toBe(true);
  });

  it('drops it when the source is on time, when it lags its own source, or past the cap', () => {
    expect(keptWithLateSource('mg_10157', 50, 12)).toBe(false);
    expect(keptWithLateSource('mg_10157', 75, 50)).toBe(false);
    expect(keptWithLateSource('mg_10157', LATE_SOURCE_MAX_MIN + 1, LATE_SOURCE_MAX_MIN + 1)).toBe(false);
    expect(keptWithLateSource('mg_10157', 50, undefined)).toBe(false);
  });
});

describe('lateSourceAges', () => {
  it('only counts a network, not a station on its own', () => {
    const now = Date.now();
    const few = new Map(['skyx_A', 'skyx_B'].map((id) => [id, reading(id, 5, 80, 60)]));
    expect(lateSourceAges(few, now).has('skyx')).toBe(false);
    const many = new Map([0, 1, 2, 3, 4].map((i) => [`mg_${i}`, reading(`mg_${i}`, 5, 80, 60)]));
    expect(Math.round(lateSourceAges(many, now).get('meteogalicia')!)).toBe(60);
  });
});

describe('Cesantes when MeteoGalicia freezes', () => {
  it('on time: all nine stations count', () => {
    const s = score(network(8));
    expect(s.wind?.stationCount).toBe(9);
  });

  it('frozen 50 min: its stations stay, so the figure does not jump to the amateur ones', () => {
    const frozen = score(network(50));
    expect(frozen.wind?.stationCount).toBe(9);
    // Without the MeteoGalicia stations the three amateur ones alone set it near 11 kt.
    const amateurOnly = score(network(8).filter((e) => e.st.source === 'netatmo'));
    expect(frozen.wind!.avgSpeedKt).toBeLessThan(amateurOnly.wind!.avgSpeedKt - 1);
  });

  it('a single MeteoGalicia station that stopped while the rest report is still gone', () => {
    const fresh = station('mg_99999', 0.5, 0.5, 'meteogalicia'); // far away, on time
    const s = score(network(50, [{ st: fresh, rd: reading(fresh.id, 5, 80, 5) }]));
    expect(s.wind?.stationCount).toBe(3);
  });

  it('past two hours the frozen stations leave as before', () => {
    const s = score(network(LATE_SOURCE_MAX_MIN + 5));
    expect(s.wind?.stationCount).toBe(3);
  });
});
