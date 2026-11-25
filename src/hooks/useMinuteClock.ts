/**
 * The time, once a minute: what lets a row of a list age when nothing else repaints it (offline, or a source that
 * stopped). Housekeeping, no network, so a plain interval.
 */
import { useEffect, useState } from 'react';

export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}
