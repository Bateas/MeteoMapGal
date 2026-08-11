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
import { skyXWindIsMeasuring } from '../src/api/skyxClient';
import {
  applyQualityControl,
  describeQcFlag,
  QC_OK,
  QC_GUST_ABSOLUTE,
  QC_GUST_RATIO,
  QC_SPEED_ABSOLUTE,
  QC_ANEMOMETER_STUCK,
  QC_SOLAR_IMPOSSIBLE,
  QC_DEWPOINT_ABOVE_TEMP,
  QC_TEMP_IMPLAUSIBLE,
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

describe('applyQualityControl — a stopped anemometer is not a calm day', () => {
  const STUCK = new Set(['skyx_SKY100']);

  it('drops the zero of an instrument known to be stopped', () => {
    const out = applyQualityControl(reading({ windSpeed: 0, windGust: 0, stationId: 'skyx_SKY100' }), STUCK);
    expect(out.reading.windSpeed).toBeNull();
    expect(out.reading.windGust).toBeNull();
    expect(out.qcFlag & QC_ANEMOMETER_STUCK).toBeTruthy();
  });

  it('archives the zero rather than destroying it', () => {
    // The reason the whole module exists: the rule will be re-tuned, and
    // re-tuning needs the population the rule removed.
    const out = applyQualityControl(reading({ windSpeed: 0, windGust: 0, stationId: 'skyx_SKY100' }), STUCK);
    expect(out.windSpeedRaw).toBe(0);
    expect(out.windGustRaw).toBe(0);
    expect(describeQcFlag(out.qcFlag)).toContain('zero from a stopped anemometer');
  });

  it('KEEPS the zero of a station that is simply becalmed', () => {
    // This is the test that matters. Castrelo is genuinely dead calm most
    // mornings, and that zero is real information the verdict needs: drop
    // every zero and the reservoir stops being able to say "no sailing today".
    const out = applyQualityControl(reading({ windSpeed: 0, windGust: 0, stationId: 'aemet_1701X' }), STUCK);
    expect(out.reading.windSpeed).toBe(0);
    expect(out.qcFlag).toBe(QC_OK);
  });

  it('lets a stopped station through the moment it reports movement again', () => {
    // Self-healing: nothing to un-flag by hand when the unit goes back outside.
    // Only the exact zero is suppressed, never a real value.
    const out = applyQualityControl(reading({ windSpeed: 3.2, windGust: 5.1, stationId: 'skyx_SKY100' }), STUCK);
    expect(out.reading.windSpeed).toBe(3.2);
    expect(out.reading.windGust).toBe(5.1);
    expect(out.qcFlag).toBe(QC_OK);
  });

  it('changes nothing at all when no set is supplied', () => {
    const out = applyQualityControl(reading({ windSpeed: 0, windGust: 0, stationId: 'skyx_SKY100' }));
    expect(out.reading.windSpeed).toBe(0);
    expect(out.qcFlag).toBe(QC_OK);
  });
});

describe('skyXWindIsMeasuring — the SKY-100 has no sentinel for a still anemometer', () => {
  it('rejects mean and peak both at exactly zero', () => {
    // Measured live 2026-08-04: wav 0, wmax 0, while the unit read 33.4 C
    // against 25 C at four neighbours. Indoors, not becalmed.
    expect(skyXWindIsMeasuring(0, 0)).toBe(false);
  });

  it('accepts a real calm, which still has a non-zero peak', () => {
    // The discriminator: the PEAK of a real reporting interval outdoors is
    // never exactly zero, however still the mean looks.
    expect(skyXWindIsMeasuring(0, 0.9)).toBe(true);
  });

  it('accepts ordinary wind', () => {
    expect(skyXWindIsMeasuring(4.1, 7.3)).toBe(true);
  });
});

describe('physical impossibilities — radiation, dew point and temperature', () => {
  it('rejects the 1360 W/m2 measured on 8 Aug, and says why', () => {
    // The reading that prompted this: one station at 1360 while the network
    // median sat at 773. It matters because detectors read ABSOLUTE radiation
    // thresholds — 250 decides "the sun is out" for the rain discriminator and
    // for Cesantes channelling, 350 for the fog signature.
    const out = applyQualityControl(reading({ solarRadiation: 1360.1 }));
    expect(out.reading.solarRadiation).toBeNull();
    expect(out.qcFlag & QC_SOLAR_IMPOSSIBLE).toBeTruthy();
    expect(describeQcFlag(out.qcFlag)).toContain('solar above what reaches this latitude');
  });

  it('keeps cloud enhancement, which is real and beats a clear midday', () => {
    // Light reflected off the edge of a cumulus genuinely pushes a pyranometer
    // past the ~1000 W/m2 of clear sky. Rejecting that would be throwing away
    // a measurement, so the cap sits at the physical ceiling and not at the
    // typical maximum.
    const out = applyQualityControl(reading({ solarRadiation: 1150 }));
    expect(out.reading.solarRadiation).toBe(1150);
    expect(out.qcFlag).toBe(QC_OK);
  });

  it('drops the dew point when it exceeds the air temperature, and keeps the temperature', () => {
    // Air holding more water than it can hold is two sensors disagreeing, not
    // weather. Dew point goes because it is usually the derived value, and by
    // far the more widely read of the two.
    const out = applyQualityControl(reading({ temperature: 24, dewPoint: 28 }));
    expect(out.reading.dewPoint).toBeNull();
    expect(out.reading.temperature).toBe(24);
    expect(out.qcFlag & QC_DEWPOINT_ABOVE_TEMP).toBeTruthy();
  });

  it('allows saturation, which is fog weather and not a fault', () => {
    // Equal values are exactly what a saturated morning looks like. Plus the
    // tolerance, because sources publish to one decimal and some derive the
    // dew point with their own rounding on top.
    expect(applyQualityControl(reading({ temperature: 12, dewPoint: 12 })).qcFlag).toBe(QC_OK);
    expect(applyQualityControl(reading({ temperature: 12, dewPoint: 12.4 })).qcFlag).toBe(QC_OK);
  });

  it('rejects the -35 C that once reached a daily summary', () => {
    const out = applyQualityControl(reading({ temperature: -35 }));
    expect(out.reading.temperature).toBeNull();
    expect(out.qcFlag & QC_TEMP_IMPLAUSIBLE).toBeTruthy();
  });

  it('leaves a Galician heatwave alone', () => {
    // 42 C happens inland in Ourense. The cap exists to catch broken sensors,
    // not to referee records.
    expect(applyQualityControl(reading({ temperature: 42 })).qcFlag).toBe(QC_OK);
  });

  it('does not blame the dew point when the temperature was itself rejected', () => {
    // With the temperature gone there is nothing left to compare against, so
    // the dew point has to survive on its own merits rather than inherit the
    // other sensor's fault.
    const out = applyQualityControl(reading({ temperature: -40, dewPoint: 8 }));
    expect(out.reading.temperature).toBeNull();
    expect(out.reading.dewPoint).toBe(8);
    expect(out.qcFlag & QC_DEWPOINT_ABOVE_TEMP).toBeFalsy();
  });

  it('leaves the wind columns untouched, which every consumer depends on', () => {
    // The whole reason these checks were safe to add: scoring, alerts and the
    // aggregates read wind, and none of them should see a single value shift.
    const out = applyQualityControl(reading({ solarRadiation: 1400, temperature: 60, windSpeed: 6, windGust: 9 }));
    expect(out.reading.windSpeed).toBe(6);
    expect(out.reading.windGust).toBe(9);
    expect(out.windSpeedRaw).toBeNull();
    expect(out.windGustRaw).toBeNull();
  });

  it('accumulates with the wind flags instead of replacing them', () => {
    // One reading can be wrong in several ways at once, and the bitmask has to
    // carry all of them so a per-station count stays honest. Four here, not
    // three: a 30 m/s gust over a 5 m/s mean trips the absolute cap AND the
    // ratio, which is the bitmask doing exactly what it is for.
    const out = applyQualityControl(reading({ windGust: 30, solarRadiation: 1400, temperature: 70 }));
    expect(out.qcFlag & QC_GUST_ABSOLUTE).toBeTruthy();
    expect(out.qcFlag & QC_GUST_RATIO).toBeTruthy();
    expect(out.qcFlag & QC_SOLAR_IMPOSSIBLE).toBeTruthy();
    expect(out.qcFlag & QC_TEMP_IMPLAUSIBLE).toBeTruthy();
    expect(describeQcFlag(out.qcFlag)).toHaveLength(4);
  });

  it('returns the very same object when nothing was wrong', () => {
    // Cheap guarantee that the common path allocates nothing and that no field
    // is being rewritten by accident.
    const r = reading();
    expect(applyQualityControl(r).reading).toBe(r);
  });
});
