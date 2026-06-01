import { describe, it, expect } from 'vitest';
import {
  isInGalicia,
  sanitizeSpotName,
  makeUserSpotId,
  defaultUserSpotName,
  userSpotToSailingSpot,
  USER_SPOT_RADIUS_KM,
  MAX_NAME_CHARS,
  type UserSpot,
} from './userSpots';

describe('isInGalicia', () => {
  it('accepts points inside the Galicia bbox', () => {
    expect(isInGalicia(-8.72, 42.24)).toBe(true); // Ría de Vigo
    expect(isInGalicia(-8.1, 42.29)).toBe(true);  // Embalse de Castrelo
    expect(isInGalicia(-8.0, 43.3)).toBe(true);   // north coast
  });

  it('rejects points outside Galicia', () => {
    expect(isInGalicia(-3.7, 40.4)).toBe(false);  // Madrid
    expect(isInGalicia(-12, 42)).toBe(false);      // open Atlantic
    expect(isInGalicia(-8, 45)).toBe(false);       // too far north
  });

  it('rejects non-finite coords', () => {
    expect(isInGalicia(NaN, 42)).toBe(false);
    expect(isInGalicia(-8, Infinity)).toBe(false);
  });
});

describe('sanitizeSpotName', () => {
  it('keeps Spanish letters and basic punctuation', () => {
    expect(sanitizeSpotName('Praia de Liméns')).toBe('Praia de Liméns');
  });

  it('strips HTML / script payloads', () => {
    expect(sanitizeSpotName('<script>alert(1)</script>Punta')).not.toMatch(/</);
    expect(sanitizeSpotName('<img src=x>Cala')).toBe('Cala');
  });

  it('caps length to MAX_NAME_CHARS', () => {
    const long = 'a'.repeat(100);
    expect(sanitizeSpotName(long).length).toBeLessThanOrEqual(MAX_NAME_CHARS);
  });
});

describe('makeUserSpotId', () => {
  it('is deterministic for a given timestamp and prefixed', () => {
    const id = makeUserSpotId(1_700_000_000_000);
    expect(id).toBe(makeUserSpotId(1_700_000_000_000));
    expect(id.startsWith('user-')).toBe(true);
  });

  it('differs for different timestamps', () => {
    expect(makeUserSpotId(1000)).not.toBe(makeUserSpotId(2000));
  });
});

describe('defaultUserSpotName', () => {
  it('is 1-indexed off the existing count', () => {
    expect(defaultUserSpotName(0)).toBe('Mi spot 1');
    expect(defaultUserSpotName(3)).toBe('Mi spot 4');
  });
});

describe('userSpotToSailingSpot', () => {
  const us: UserSpot = {
    id: 'user-abc',
    name: 'Mi spot 1',
    center: [-8.8, 42.25],
    sectorId: 'rias',
    createdAt: 1,
  };

  it('produces a generic, uncalibrated SailingSpot', () => {
    const s = userSpotToSailingSpot(us);
    expect(s.id).toBe('user-abc');
    expect(s.center).toEqual([-8.8, 42.25]);
    expect(s.radiusKm).toBe(USER_SPOT_RADIUS_KM);
    // No special engine behaviour — must fall down the generic path.
    expect(s.preferredStations).toEqual([]);
    expect(s.preferredBuoys).toEqual([]);
    expect(s.windPatterns).toEqual([]);
    expect(s.thermalDetection).toBe(false);
    expect(s.bocanaDetection).toBeUndefined();
    expect(s.windCalibrationKt).toBeUndefined();
    expect(s.beta).toBe(true);
  });
});
