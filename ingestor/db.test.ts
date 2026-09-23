import { describe, it, expect } from 'vitest';
import { sourceLabel } from './db';
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
