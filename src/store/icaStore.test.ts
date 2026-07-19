/**
 * Tests for icaStore — expiry of official air-quality readings.
 *
 * The failure this guards against is silent: the fetch returns an empty array
 * when the source is down, so it neither updates nor clears, and consumers
 * read `readings` without ever checking the age. A "bad air quality" verdict
 * could therefore sit on the map and the ticker for the whole outage.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useIcaStore, ICA_MAX_AGE_MS } from './icaStore';
import type { IcaReading } from '../api/meteoGaliciaIcaClient';

function reading(over: Partial<IcaReading> = {}): IcaReading {
  return {
    station: 'Coruña Torre',
    ica: 4.2,
    dominantPollutant: 'PM10',
    categoryEs: 'Desfavorable',
    color: '#e8622a',
    lat: 43.37,
    lon: -8.4,
    timestamp: new Date(),
    ...over,
  };
}

describe('icaStore freshness', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useIcaStore.getState().clear();
  });

  afterEach(() => {
    useIcaStore.getState().clear(); // drop the pending expiry timer
    vi.useRealTimers();
  });

  it('serves a reading that just arrived', () => {
    useIcaStore.getState().setReadings([reading()]);

    expect(useIcaStore.getState().readings).toHaveLength(1);
    expect(useIcaStore.getState().isFresh()).toBe(true);
  });

  it('still serves a reading well inside the TTL', () => {
    useIcaStore.getState().setReadings([reading()]);
    vi.advanceTimersByTime(ICA_MAX_AGE_MS - 60_000);

    expect(useIcaStore.getState().isFresh()).toBe(true);
    expect(useIcaStore.getState().readings).toHaveLength(1);
  });

  it('drops readings once they age past the TTL, with nothing else polling', () => {
    useIcaStore.getState().setReadings([reading()]);
    vi.advanceTimersByTime(ICA_MAX_AGE_MS + 1);

    // Consumers read `readings` directly — expiry has to empty it for them.
    expect(useIcaStore.getState().readings).toEqual([]);
    expect(useIcaStore.getState().fetchedAt).toBeNull();
    expect(useIcaStore.getState().isFresh()).toBe(false);
  });

  it('reports stale by wall clock even if the timer ran late (machine asleep)', () => {
    useIcaStore.getState().setReadings([reading()]);
    // Move the clock without letting timers fire, as a suspended tab would.
    vi.setSystemTime(Date.now() + ICA_MAX_AGE_MS + 60_000);

    expect(useIcaStore.getState().isFresh()).toBe(false);
  });

  it('a fresh fetch restarts the expiry window', () => {
    useIcaStore.getState().setReadings([reading()]);
    vi.advanceTimersByTime(ICA_MAX_AGE_MS - 1_000);

    useIcaStore.getState().setReadings([reading({ ica: 1.1 })]);
    vi.advanceTimersByTime(2_000); // past the FIRST deadline

    expect(useIcaStore.getState().readings).toHaveLength(1);
    expect(useIcaStore.getState().isFresh()).toBe(true);
  });

  it('empty readings are never fresh', () => {
    expect(useIcaStore.getState().isFresh()).toBe(false);
  });
});
