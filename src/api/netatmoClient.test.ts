/**
 * The Netatmo station id is a border: the browser builds it from the MAC it
 * gets from Netatmo, and the service that stores the readings builds it from
 * the same MAC. If the two spellings drift apart, nothing throws — the browser
 * simply never recognises a stored reading, goes to Netatmo itself on every
 * cycle, and the list of stations that must not vote stops applying on the map
 * while it still applies in the alerts. That is what these tests pin down.
 */
import { describe, it, expect } from 'vitest';
import { netatmoStationId } from './netatmoClient';
import { isWindBlacklisted } from '../services/spotScoringEngine';

/** Copy of ingestor/discover.ts, on purpose: the point is that they agree. */
const asTheIngestorBuildsIt = (mac: string) =>
  `nt_${mac.replace(/:/g, '').slice(-6).toLowerCase()}`;

describe('netatmoStationId', () => {
  const MACS = ['70:ee:50:a9:b4:28', '70:EE:50:AF:6F:E8', '70:ee:50:3a:11:74'];

  it('spells the id exactly as the service that stores the readings does', () => {
    for (const mac of MACS) {
      expect(netatmoStationId(mac)).toBe(asTheIngestorBuildsIt(mac));
    }
  });

  it('is lower case whatever case the MAC arrives in', () => {
    expect(netatmoStationId('70:EE:50:AF:6F:E8')).toBe('nt_af6fe8');
    expect(netatmoStationId('70:ee:50:af:6f:e8')).toBe('nt_af6fe8');
  });

  it('keeps the six last hex characters and the nt_ prefix', () => {
    expect(netatmoStationId('70:ee:50:a9:b4:28')).toMatch(/^nt_[0-9a-f]{6}$/);
  });

  it('the sheltered stations the map must ignore are reachable by this id', () => {
    // These five are in WIND_BLACKLIST because they read almost calm always.
    // With the old spelling the map built netatmo_A9B428 and excluded nobody.
    expect(isWindBlacklisted(netatmoStationId('70:ee:50:a9:b4:28'))).toBe(true);
    expect(isWindBlacklisted(netatmoStationId('70:ee:50:af:6f:e8'))).toBe(true);
    expect(isWindBlacklisted(netatmoStationId('70:ee:50:3a:11:74'))).toBe(true);
    expect(isWindBlacklisted(netatmoStationId('70:ee:50:00:00:01'))).toBe(false);
  });
});
