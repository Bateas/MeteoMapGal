/**
 * The place of the wind chart in the spot card: drawn, kept while it is on its way, or nothing. Without the place kept
 * the sheet of a phone peeked at its head and grew a second or two later, when the chart landed (25-nov, on a phone).
 */
import { describe, it, expect } from 'vitest';
import { windChartPlace } from './spotForecastFetch';

const base = { isSurf: false, windKt: 7, scorePending: false, forecastHours: 0, loading: true, failed: false };

describe('windChartPlace', () => {
  it('draws the chart once there is a figure and a forecast', () => {
    expect(windChartPlace({ ...base, forecastHours: 48, loading: false })).toBe('chart');
  });

  it('keeps its place while the forecast is being asked for', () => {
    expect(windChartPlace(base)).toBe('wait');
  });

  it('keeps it too while the figure is still being worked out, forecast in hand or not', () => {
    expect(windChartPlace({ ...base, windKt: null, scorePending: true, forecastHours: 48, loading: false })).toBe('wait');
    expect(windChartPlace({ ...base, windKt: null, scorePending: true })).toBe('wait');
  });

  it('keeps no place for a chart that will not come', () => {
    // the forecast failed
    expect(windChartPlace({ ...base, loading: false, failed: true })).toBe('none');
    // nothing was asked and nothing is cached
    expect(windChartPlace({ ...base, loading: false })).toBe('none');
    // scored for good with no wind figure at all
    expect(windChartPlace({ ...base, windKt: null, scorePending: false, forecastHours: 48, loading: false })).toBe('none');
  });

  it('a surf spot has its own chart: never this one, nor its place', () => {
    expect(windChartPlace({ ...base, isSurf: true })).toBe('none');
    expect(windChartPlace({ ...base, isSurf: true, forecastHours: 48, loading: false })).toBe('none');
  });
});
