/**
 * The Cesantes detector has a branch for a sheltered station whose mean is low but whose
 * gusts show the breeze arriving. The engine used to hand it `wind.gustKt`, a field the
 * consensus type does not have, so that branch never ran in the app while the alert
 * pipeline (which computes the gust itself) could fire it. These tests pin the gust the
 * engine passes, and the helper that computes it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NormalizedStation, NormalizedReading } from '../types/station';
import { RIAS_SPOTS } from '../config/spots';

const spy = vi.fn();
vi.mock('./cesantesCanalizationDetector', async (importOriginal) => {
  const real = await importOriginal<typeof import('./cesantesCanalizationDetector')>();
  return {
    ...real,
    predictCesantesCanalization: (...args: Parameters<typeof real.predictCesantesCanalization>) => {
      spy(...args);
      return real.predictCesantesCanalization(...args);
    },
  };
});

const { scoreAllSpots, localGustKt } = await import('./spotScoringEngine');

const kt = (v: number) => v / 1.94384;
const cesantes = RIAS_SPOTS.find((s) => s.id === 'cesantes')!;

function station(id: string, lat: number, lon: number): NormalizedStation {
  return { id, name: id, lat, lon, altitude: 10, source: 'meteogalicia', tempOnly: false };
}
function reading(id: string, meanKt: number, gustKt: number | null, dir: number): NormalizedReading {
  return {
    stationId: id, timestamp: new Date(), windSpeed: kt(meanKt), windGust: gustKt == null ? null : kt(gustKt),
    windDirection: dir, temperature: 24, humidity: 55, precipitation: null, solarRadiation: null,
    pressure: 1015, dewPoint: 12,
  };
}

describe('the engine passes the nearby gust to the Cesantes detector', () => {
  beforeEach(() => spy.mockClear());

  it('hands over the measured gust, not null', () => {
    const [lon, lat] = cesantes.center;
    scoreAllSpots([cesantes], [station('near', lat + 0.01, lon)], new Map([['near', reading('near', 3.5, 9.5, 230)]]), []);
    expect(spy).toHaveBeenCalled();
    const gustArg = spy.mock.calls[0][8];
    expect(gustArg).toBeCloseTo(9.5, 1);
  });
});

describe('localGustKt', () => {
  const st = (distKm: number, meanKt: number, gustKt: number | null) =>
    ({ reading: reading('x', meanKt, gustKt, 230), distKm });

  it('takes the peak of stations within 8 km', () => {
    expect(localGustKt([st(2, 4, 9), st(6, 4, 11), st(10, 4, 20)], [], 4)).toBeCloseTo(11, 1);
  });

  it('drops a gust above 3x the raw mean or above 45 kt as a sensor glitch', () => {
    expect(localGustKt([st(2, 3, 12)], [], 3)).toBeNull();
    expect(localGustKt([st(2, 20, 50)], [], 20)).toBeNull();
  });

  it('is null when nothing nearby reports a gust', () => {
    expect(localGustKt([st(2, 4, null)], [], 4)).toBeNull();
  });
});
