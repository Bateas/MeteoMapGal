import { describe, it, expect } from 'vitest';
import { sourceLabel, readingRow, READING_COLUMNS } from './db';
import { applyQualityControl } from './readingQuality';
import { POLLED_SOURCES } from './sourceHealth';

/**
 * The `source` column every reading and station row is written with.
 *
 * IPMA was polled from 20-Sep with no branch here, so every Portuguese row
 * landed in the table as `unknown`: invisible to `?source=ipma`, to the
 * health endpoint's per-network count and to anything that groups by source.
 */
describe('sourceLabel — the DB label follows the station id prefix', () => {
  it('labels an IPMA station as ipma, not unknown', () => {
    expect(sourceLabel('ipma_1200551')).toBe('ipma');
  });

  it('keeps every network that already had a label', () => {
    expect(sourceLabel('aemet_1701X')).toBe('aemet');
    expect(sourceLabel('mg_10154')).toBe('meteogalicia');
    expect(sourceLabel('mc_ESGAL3200000032455A')).toBe('meteoclimatic');
    expect(sourceLabel('wu_ISANAM1')).toBe('wunderground');
    expect(sourceLabel('nt_28f26e')).toBe('netatmo');
    expect(sourceLabel('skyx_SKY100')).toBe('skyx');
  });

  it('labels every polled network, so adding one to the heartbeat cannot leave it unlabelled', () => {
    const sampleId: Record<(typeof POLLED_SOURCES)[number], string> = {
      meteogalicia: 'mg_1',
      wunderground: 'wu_1',
      netatmo: 'nt_1',
      meteoclimatic: 'mc_1',
      aemet: 'aemet_1',
      skyx: 'skyx_1',
      ipma: 'ipma_1',
    };
    for (const source of POLLED_SOURCES) expect(sourceLabel(sampleId[source])).toBe(source);
  });

  it('still says unknown for a prefix nobody polls', () => {
    expect(sourceLabel('xx_whatever')).toBe('unknown');
    expect(sourceLabel('aemet1701X')).toBe('unknown');
  });
});

/**
 * Adding a column means touching the column list AND the row; a row one value
 * short shifts every placeholder after it and Postgres rejects the whole batch
 * (it happened on 4-ago with the stations table).
 */
describe('readingRow — one value per readings column, in order', () => {
  const reading = {
    stationId: 'mg_10126', timestamp: new Date('2026-09-25T09:10:00Z'),
    windSpeed: 3.53, windGust: 5.49, windDirection: 7, temperature: 18.65, humidity: 74,
    precipitation: 0, solarRadiation: 453, pressure: 1024.99, dewPoint: 13.91,
    windDirSd: 15, windSpeedSd: 0.67, sunFrac: 1, temp10cm: 18.77, soilTemp: 18.18,
  };

  it('has exactly as many values as there are columns', () => {
    expect(readingRow(applyQualityControl(reading))).toHaveLength(READING_COLUMNS.length);
  });

  it('puts each new field under its own column', () => {
    const row = readingRow(applyQualityControl(reading));
    const at = (c: (typeof READING_COLUMNS)[number]) => row[READING_COLUMNS.indexOf(c)];
    expect(at('wind_dir_sd')).toBe(15);
    expect(at('wind_speed_sd')).toBe(0.67);
    expect(at('sun_frac')).toBe(1);
    expect(at('temp_10cm')).toBe(18.77);
    expect(at('soil_temp')).toBe(18.18);
    expect(at('source')).toBe('meteogalicia');
  });

  it('writes null, not undefined, when a source does not send the new fields', () => {
    const { windDirSd, windSpeedSd, sunFrac, temp10cm, soilTemp, ...plain } = reading;
    void windDirSd; void windSpeedSd; void sunFrac; void temp10cm; void soilTemp;
    const row = readingRow(applyQualityControl({ ...plain, stationId: 'wu_ISANAM1' }));
    expect(row.slice(READING_COLUMNS.indexOf('wind_dir_sd'))).toEqual([null, null, null, null, null]);
  });
});
