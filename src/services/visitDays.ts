/**
 * Visits counted by day, for the install card: every load counted, so two reloads on the first day put
 * the card over the map of someone who had not yet seen it (18-nov). A visit is a new day.
 */
const VISIT_COUNT_KEY = 'pwa-visit-count';
const LAST_DAY_KEY = 'pwa-visit-last-day';

/** Counts today as a visit if it was not counted yet, and returns the visits so far (days). */
export function countVisitDay(store: Pick<Storage, 'getItem' | 'setItem'>, now = new Date()): number {
  const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  let count = parseInt(store.getItem(VISIT_COUNT_KEY) || '0', 10) || 0;
  if (store.getItem(LAST_DAY_KEY) !== day) {
    count += 1;
    store.setItem(VISIT_COUNT_KEY, String(count));
    store.setItem(LAST_DAY_KEY, day);
  }
  return count;
}
