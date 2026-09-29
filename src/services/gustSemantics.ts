/**
 * What a station's GUST means, per network, in one place (the same idea as precipSemantics).
 *
 * MeteoGalicia and the home stations report the strongest gust of the same short interval as
 * their mean wind, so "gust more than three times the mean" is a fair test of a broken sensor.
 * AEMET does not: its gust (vmax) is the strongest of the whole HOUR before the reading, and its
 * mean (vv) is the last ten minutes of it. After the front of 29-sep the hour's gust was the
 * front's and the last ten minutes were the calm behind it: the test removed 82 AEMET gusts that
 * day, up to Fisterra's 62 kt at 19:00, and every one of them was matched by a MeteoGalicia gust
 * within 25 km in the same hour (A Gándara 80 kt beside Fisterra, 60 kt beside Noia's 58).
 */
export type GustWindow = 'interval' | 'hour';

export function gustWindowFor(stationId: string): GustWindow {
  return stationId.startsWith('aemet_') ? 'hour' : 'interval';
}

/** Whether the gust can be judged against the mean it comes with. */
export function gustComparableToMean(stationId: string): boolean {
  return gustWindowFor(stationId) === 'interval';
}
