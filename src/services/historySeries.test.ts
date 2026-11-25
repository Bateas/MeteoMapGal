/**
 * The Historial tab must show only what a station really sent, under its own name of field, and say the
 * conclusion in words. Rows here have the shape the API answers (Cortegada and Silleiro, 4-nov).
 */
import { describe, it, expect } from 'vitest';
import {
  availableMetrics, BUOY_METRICS, driftOf, formatValue, GAUGE_METRICS, historySentence, nearestPoint, parseDbTime,
  rangeWords, seriesOf, STATION_METRICS, type HistoryMetric,
} from './historySeries';

const NOW = Date.UTC(2026, 10, 4, 12, 0, 0);
const isoAgo = (min: number) => new Date(NOW - min * 60_000).toISOString();

const metric = (table: readonly HistoryMetric[], key: string) => table.find((m) => m.key === key)!;
const labels = (list: HistoryMetric[]) => list.map((m) => m.label);

const cortegada = {
  time: '2026-11-04 00:20:00+01', station_id: 1250, source: 'obscosteiro',
  wave_height: null, wave_height_max: null, wave_period: null, wave_period_mean: null, wave_dir: null,
  wind_speed: 9.77, wind_dir: 60, wind_gust: 11.34, water_temp: 13.885, air_temp: 11.93, air_pressure: null,
  current_speed: null, current_dir: null, salinity: 34.314, sea_level: null, humidity: 65, dew_point: 5.59,
};
const silleiro = {
  time: '2026-11-05 00:00:00+01', station_id: 2248, source: 'portus',
  wave_height: 1.29, wave_height_max: null, wave_period: 13.28, wave_period_mean: 5.47, wave_dir: 326,
  wind_speed: 5.39, wind_dir: 59, wind_gust: 6.56, water_temp: 17.37, air_temp: 13.85, air_pressure: 1015.6,
  current_speed: 0.293, current_dir: 127, salinity: 35.94, sea_level: null, humidity: 73.03, dew_point: null,
};
const station = {
  time: '2026-11-04 00:20:00+01', station_id: 'mg_14001', source: 'meteogalicia',
  temperature: 12.83, humidity: 63, wind_speed: 2.99, wind_gust: 5.09, wind_dir: 93, pressure: 1016.87, dew_point: 5.87, precip: 0, solar_rad: 120,
};
const hourlyBuoy = {
  bucket: '2026-11-04 01:00:00+01', station_id: 1250, source: 'obscosteiro',
  avg_wave_height: null, max_wave_height: null, avg_wave_period: null, avg_wind: 9.2, max_gust: 11.4,
  avg_water_temp: 13.9, avg_air_temp: 11.9, avg_pressure: null, avg_current: null, avg_humidity: 66, avg_sea_level: null,
};

describe('availableMetrics', () => {
  it('a buoy shows what it measures: Cortegada has water and salinity, and no sea', () => {
    expect(labels(availableMetrics([cortegada], BUOY_METRICS)))
      .toEqual(['Viento', 'Agua', 'Aire', 'Salinidad', 'Humedad', 'Punto de rocío']);
  });

  it('Silleiro has the sea and the current as well', () => {
    expect(labels(availableMetrics([silleiro], BUOY_METRICS)))
      .toEqual(['Ola', 'Periodo de la ola', 'Viento', 'Agua', 'Aire', 'Salinidad', 'Corriente', 'Presión', 'Humedad']);
  });

  it('a station with everything', () => {
    expect(labels(availableMetrics([station], STATION_METRICS)))
      .toEqual(['Viento', 'Temperatura', 'Humedad', 'Presión', 'Punto de rocío', 'Radiación']);
  });

  it('a station without an anemometer has no wind, and a radiation all at zero is no radiation', () => {
    const row = { time: station.time, temperature: 12, wind_speed: null, wind_gust: null, humidity: null, solar_rad: 0 };
    expect(labels(availableMetrics([row], STATION_METRICS))).toEqual(['Temperatura']);
  });

  it('the hourly aggregates count under their own names', () => {
    expect(labels(availableMetrics([hourlyBuoy], BUOY_METRICS))).toEqual(['Viento', 'Agua', 'Aire', 'Humedad']);
  });

  it('a tide gauge offers its level first, and not the water of the dock as a wave', () => {
    const gauge = { time: silleiro.time, wave_height: 0.02, wave_period: 2.57, wind_speed: 0.8, wind_gust: 1.6, air_pressure: 1015.3, sea_level: 3.27 };
    expect(labels(availableMetrics([gauge], GAUGE_METRICS))).toEqual(['Nivel del mar', 'Viento', 'Presión']);
  });

  it('nothing sent, nothing on offer', () => {
    expect(availableMetrics([], STATION_METRICS)).toEqual([]);
  });
});

describe('seriesOf', () => {
  it('wind comes in knots, with its gust on the thin line', () => {
    const [p] = seriesOf([station], metric(STATION_METRICS, 'wind'));
    expect(p.v).toBeCloseTo(5.81, 1);
    expect(p.top).toBeCloseTo(9.89, 1);
  });

  it('the current comes in cm/s', () => {
    const [p] = seriesOf([silleiro], metric(BUOY_METRICS, 'current'));
    expect(p.v).toBeCloseTo(29.3, 1);
  });

  it('two sources at the same minute are one point, and the order is by time', () => {
    const rows = [
      { time: isoAgo(10), water_temp: 14 },
      { time: isoAgo(20), water_temp: 13 },
      { time: isoAgo(10), water_temp: 15 },
    ];
    expect(seriesOf(rows, metric(BUOY_METRICS, 'water')).map((p) => p.v)).toEqual([13, 15]);
  });

  it('the sentinel of a missing value is not a reading', () => {
    expect(seriesOf([{ time: isoAgo(5), water_temp: -9999 }], metric(BUOY_METRICS, 'water'))).toEqual([]);
  });

  it('a long range goes down to what the chart can draw, keeping the peak of each stretch', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ time: isoAgo(1000 - i), wind_speed: 5, wind_gust: i === 500 ? 40 : 7 }));
    const series = seriesOf(rows, metric(STATION_METRICS, 'wind'), 100);
    expect(series.length).toBeLessThanOrEqual(100);
    expect(Math.max(...series.map((p) => p.top!))).toBeCloseTo(77.8, 0);
  });
});

describe('parseDbTime', () => {
  it('reads what the database sends, the way Safari needs it', () => {
    expect(parseDbTime('2026-11-04 00:20:00+01')).toBe(Date.UTC(2026, 10, 3, 23, 20));
    expect(parseDbTime('2026-07-04 16:20:00+02')).toBe(Date.UTC(2026, 6, 4, 14, 20));
  });
});

describe('the words', () => {
  const temp = metric(STATION_METRICS, 'temp');
  const pts = (...vs: [number, number][]) => vs.map(([min, v]) => ({ t: NOW - min * 60_000, v }));

  it('a value with its unit and a decimal comma', () => {
    expect(formatValue(12.34, temp)).toBe('12,3 °C');
  });

  it('a range, a flat line and a magnitude that only has a peak', () => {
    expect(rangeWords(pts([60, 8.8], [10, 15.1]), temp)).toBe('de 8,8 a 15,1 °C');
    expect(rangeWords(pts([60, 12], [10, 12]), temp)).toBe('12,0 °C');
    expect(rangeWords(pts([60, 0], [10, 640]), metric(STATION_METRICS, 'solar'))).toBe('hasta 640 W/m²');
  });

  it('the wind names its gust when there is one', () => {
    const wind = metric(STATION_METRICS, 'wind');
    expect(rangeWords([{ t: NOW, v: 5, top: 12 }, { t: NOW - 1, v: 9, top: 14 }], wind)).toBe('de 5 a 9 kt, racha 14');
    expect(rangeWords([{ t: NOW, v: 5 }, { t: NOW - 1, v: 9 }], wind)).toBe('de 5 a 9 kt');
  });

  it('the sentence goes first: what it did, how it is now and where it is going', () => {
    const series = pts([200, 8.8], [150, 15.1], [90, 13], [80, 13], [30, 12.3], [10, 12.3]);
    expect(historySentence(series, temp, 'En 24 h', NOW)).toBe('En 24 h: de 8,8 a 15,1 °C. Ahora 12,3 °C y baja.');
  });

  it('with a last reading from a while ago it does not say «ahora»', () => {
    const series = pts([300, 8.8], [200, 15.1]);
    expect(historySentence(series, temp, 'En 24 h', NOW)).toBe('En 24 h: de 8,8 a 15,1 °C.');
  });

  it('without enough readings to tell, it says the figure and no direction', () => {
    expect(historySentence(pts([200, 8], [10, 15]), temp, 'En 24 h', NOW)).toBe('En 24 h: de 8,0 a 15,0 °C. Ahora 15,0 °C.');
  });

  it('nothing to say, nothing said', () => {
    expect(historySentence([], temp, 'En 24 h', NOW)).toBeNull();
  });

  it('each magnitude has its own idea of a change', () => {
    const water = metric(BUOY_METRICS, 'water');
    expect(driftOf(pts([100, 14], [90, 14], [20, 14.5], [10, 14.5]), water, NOW)).toBe('sube');
    expect(driftOf(pts([100, 14], [90, 14], [20, 14.1], [10, 14.1]), water, NOW)).toBe('estable');
  });

  it('the wind goes through the one definition of the rows and the cards', () => {
    const wind = metric(STATION_METRICS, 'wind');
    expect(driftOf(pts([100, 6], [90, 6], [20, 12], [10, 12]), wind, NOW)).toBe('sube');
    expect(driftOf(pts([100, 1], [90, 2], [20, 2], [10, 1]), wind, NOW)).toBe('estable');
  });
});

describe('nearestPoint', () => {
  it('finds the reading under the pointer', () => {
    const series = [{ t: 100, v: 1 }, { t: 200, v: 2 }, { t: 300, v: 3 }];
    expect(nearestPoint(series, 240)?.v).toBe(2);
    expect(nearestPoint([], 240)).toBeNull();
  });
});
