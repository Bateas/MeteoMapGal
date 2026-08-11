/**
 * Tests for the reading history in weatherStore.
 *
 * The one that matters is the identity test. Everything else here would have
 * passed against the broken version too, which is exactly why the bug survived:
 * the history WAS being filled correctly, every entry present and in order. It
 * was filled by mutating the array in place, and cloning the outer Map does
 * nothing about that — a component selecting one station's history got the same
 * array reference back forever, so Zustand saw no change and never re-rendered.
 *
 * The visible symptom was a blank sparkline in the station popup. It needs three
 * points and renders nothing below that, so a popup opened on a fresh page load
 * read an empty history and then never learned it had filled. Closing and
 * reopening appeared to fix it, which is the signature of a stale reference
 * rather than of missing data.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useWeatherStore } from './weatherStore';
import { MAX_HISTORY_ENTRIES } from '../config/constants';
import type { NormalizedReading } from '../types/station';

const reading = (minutesAgo: number, windSpeed = 5): NormalizedReading => ({
  stationId: 'mg_10099',
  timestamp: new Date(Date.now() - minutesAgo * 60_000),
  windSpeed,
  windGust: windSpeed + 2,
  windDirection: 240,
  temperature: 22,
  humidity: 80,
  precipitation: 0,
  solarRadiation: 900,
  pressure: 1015,
  dewPoint: 18,
});

const historyOf = (id = 'mg_10099') => useWeatherStore.getState().readingHistory.get(id);

describe('readingHistory', () => {
  beforeEach(() => {
    useWeatherStore.setState({ readingHistory: new Map(), currentReadings: new Map(), readingsEpoch: 0, historyEpoch: 0 });
  });

  it('hands back a NEW array each time, or nothing subscribed ever re-renders', () => {
    // The whole bug in one assertion. Zustand compares what the selector
    // returned; a selector reaching into the Map returns the inner array, and
    // an array mutated in place is identical to the one before it.
    useWeatherStore.getState().updateReadings([reading(10)]);
    const first = historyOf();

    useWeatherStore.getState().updateReadings([reading(5)]);
    const second = historyOf();

    expect(second).not.toBe(first);
    expect(second).toHaveLength(2);
  });

  it('does not retroactively mutate the array a component is already holding', () => {
    // A subscriber that captured the array before the update must keep seeing
    // what it captured. Otherwise a memo can read new data while its dependency
    // says nothing changed — the worst of both.
    useWeatherStore.getState().updateReadings([reading(10)]);
    const captured = historyOf()!;
    expect(captured).toHaveLength(1);

    useWeatherStore.getState().updateReadings([reading(5)]);
    expect(captured).toHaveLength(1);
  });

  it('accumulates enough points for the sparkline to draw', () => {
    // Three is the threshold the popup renders at. Below it, nothing at all.
    for (const m of [15, 10, 5]) useWeatherStore.getState().updateReadings([reading(m)]);
    expect(historyOf()).toHaveLength(3);
  });

  it('ignores a repeat of the same timestamp, which sources publish constantly', () => {
    // Polling runs every five minutes; plenty of stations publish every ten. So
    // the same reading arrives twice as a matter of course and must not count
    // as a second point.
    const r = reading(10);
    useWeatherStore.getState().updateReadings([r]);
    useWeatherStore.getState().updateReadings([{ ...r }]);
    expect(historyOf()).toHaveLength(1);
  });

  it('caps the history and drops the oldest, keeping the newest', () => {
    const many = Array.from({ length: MAX_HISTORY_ENTRIES + 5 }, (_, i) => reading(MAX_HISTORY_ENTRIES + 5 - i, i));
    for (const r of many) useWeatherStore.getState().updateReadings([r]);

    const h = historyOf()!;
    expect(h).toHaveLength(MAX_HISTORY_ENTRIES);
    // The last reading pushed carries the highest windSpeed, and it survived.
    expect(h[h.length - 1].windSpeed).toBe(many[many.length - 1].windSpeed);
    // The very first one did not.
    expect(h[0].timestamp.getTime()).toBeGreaterThan(many[0].timestamp.getTime());
  });

  it('bumps historyEpoch only when the history actually grew', () => {
    // Consumers key off the epoch to avoid recomputing on every poll. A repeat
    // reading must not look like new data.
    useWeatherStore.getState().updateReadings([reading(10)]);
    const after = useWeatherStore.getState().historyEpoch;

    useWeatherStore.getState().updateReadings([{ ...reading(10) }]);
    expect(useWeatherStore.getState().historyEpoch).toBe(after);
  });

  it('appendHistory hands back a new array too — the same trap, one function down', () => {
    // Found by audit after fixing updateReadings: the identical in-place push
    // sat seventy lines below the comment explaining why it breaks. It matters
    // more here, because this is the path that loads history from the backend
    // at startup — the batch that fills a sparkline immediately rather than
    // making it wait for live polls.
    useWeatherStore.getState().appendHistory([reading(30)]);
    const first = historyOf();

    useWeatherStore.getState().appendHistory([reading(20)]);
    expect(historyOf()).not.toBe(first);
    expect(first).toHaveLength(1);
    expect(historyOf()).toHaveLength(2);
  });

  it('appendHistory and updateReadings share one history without clobbering', () => {
    // Backend backfill and live polling both write here. A reading already
    // present from one path must not be duplicated by the other.
    const r = reading(10);
    useWeatherStore.getState().appendHistory([r]);
    useWeatherStore.getState().updateReadings([{ ...r }]);
    expect(historyOf()).toHaveLength(1);
  });

  it('keeps stations apart', () => {
    useWeatherStore.getState().updateReadings([
      reading(10),
      { ...reading(10), stationId: 'wu_OTHER' },
    ]);
    expect(historyOf()).toHaveLength(1);
    expect(historyOf('wu_OTHER')).toHaveLength(1);
  });
});
