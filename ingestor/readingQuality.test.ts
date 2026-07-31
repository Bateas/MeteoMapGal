/**
 * Tests for the reading quality control.
 *
 * Two things are being pinned here, and the second matters more than the first.
 * One: the plausibility checks still reject exactly what they always rejected —
 * the clean columns must not shift by a single value, because scoring, alerts
 * and every aggregate read them. Two: whatever gets rejected is now KEPT, with
 * the reason. That is the whole point of the change; a test that only checked
 * the nulling would have passed against the old destructive code.
 */

import { describe, it, expect } from 'vitest';
import {
  applyQualityControl,
  describeQcFlag,
  QC_OK,
  QC_GUST_ABSOLUTE,
  QC_GUST_RATIO,
  QC_SPEED_ABSOLUTE,
  MAX_PLAUSIBLE_GUST_MS,
} from './readingQuality';
import type { NormalizedReading } from '../src/types/station';

const reading = (over: Partial<NormalizedReading> = {}): NormalizedReading => ({
  stationId: 'skyx_test',
  timestamp: new Date('2026-07-30T12:00:00Z'),
  temperature: 20,
  humidity: 60,
  windSpeed: 5,
  windGust: 7,
  windDirection: 250,
  pressure: 1015,
  dewPoint: 12,
  precipitation: 0,
  solarRadiation: 600,
  ...over,
});

describe('applyQualityControl — the clean columns do not move', () => {
  it('leaves a plausible reading untouched and marks it checked', () => {
    const r = reading();
    const out = applyQualityControl(r);
    expect(out.reading).toBe(r); // same object: nothing to correct
    expect(out.qcFlag).toBe(QC_OK);
    expect(out.windGustRaw).toBeNull();
    expect(out.windSpeedRaw).toBeNull();
  });

  it('still nulls a gust above the absolute cap', () => {
    const out = applyQualityControl(reading({ windSpeed: 12, windGust: 50 }));
    expect(out.reading.windGust).toBeNull();
    expect(out.reading.windSpeed).toBe(12); // untouched
  });

  it('still nulls a gust more than three times the mean', () => {
    const out = applyQualityControl(reading({ windSpeed: 2, windGust: 9 }));
    expect(out.reading.windGust).toBeNull();
  });

  it('still nulls an implausible sustained wind', () => {
    const out = applyQualityControl(reading({ windSpeed: 60, windGust: null }));
    expect(out.reading.windSpeed).toBeNull();
  });

  it('does not apply the ratio test against a still anemometer', () => {
    // At 0 m/s every gust is infinitely larger than the mean; the ratio test
    // says nothing there, and a real 5 m/s gust off a calm lake is ordinary.
    const out = applyQualityControl(reading({ windSpeed: 0, windGust: 5 }));
    expect(out.reading.windGust).toBe(5);
    expect(out.qcFlag).toBe(QC_OK);
  });

  it('accepts a gust exactly at the cap', () => {
    const out = applyQualityControl(reading({ windSpeed: 20, windGust: MAX_PLAUSIBLE_GUST_MS }));
    expect(out.reading.windGust).toBe(MAX_PLAUSIBLE_GUST_MS);
    expect(out.qcFlag).toBe(QC_OK);
  });
});

describe('applyQualityControl — what it rejects, it keeps', () => {
  it('preserves the original gust and says why', () => {
    // The case the archive exists for: this is either a real storm gust or a
    // failing sensor, and with the value erased there was no way to ever know.
    const out = applyQualityControl(reading({ windSpeed: 12, windGust: 50 }));
    expect(out.windGustRaw).toBe(50);
    expect(out.qcFlag & QC_GUST_ABSOLUTE).toBeTruthy();
  });

  it('preserves the original speed and says why', () => {
    const out = applyQualityControl(reading({ windSpeed: 60, windGust: null }));
    expect(out.windSpeedRaw).toBe(60);
    expect(out.qcFlag).toBe(QC_SPEED_ABSOLUTE);
  });

  it('records both reasons when a gust trips the cap and the ratio', () => {
    const out = applyQualityControl(reading({ windSpeed: 5, windGust: 40 }));
    expect(out.qcFlag & QC_GUST_ABSOLUTE).toBeTruthy();
    expect(out.qcFlag & QC_GUST_RATIO).toBeTruthy();
    expect(describeQcFlag(out.qcFlag)).toHaveLength(2);
  });

  it('keeps the raw column null when nothing was rejected', () => {
    // Storing the value twice when it was not touched buys nothing; null here
    // means "identical to the clean column", and the flag says it was checked.
    const out = applyQualityControl(reading({ windSpeed: 8, windGust: 14 }));
    expect(out.windGustRaw).toBeNull();
    expect(out.qcFlag).toBe(QC_OK);
  });

  it('does not confuse a missing gust with a rejected one', () => {
    // A station without an anemometer gust sensor reports null forever. That
    // must stay distinguishable from a value we deleted, which is exactly the
    // ambiguity already sitting in production rows.
    const out = applyQualityControl(reading({ windGust: null }));
    expect(out.reading.windGust).toBeNull();
    expect(out.windGustRaw).toBeNull();
    expect(out.qcFlag).toBe(QC_OK);
  });

  it('leaves a real storm gust alone', () => {
    // 22 m/s (~43kt) with a 10 m/s mean is a gale, not a glitch: under the cap
    // and just over twice the mean. The archive is there for the ones above it.
    const out = applyQualityControl(reading({ windSpeed: 10, windGust: 22 }));
    expect(out.reading.windGust).toBe(22);
    expect(out.qcFlag).toBe(QC_OK);
  });
});
