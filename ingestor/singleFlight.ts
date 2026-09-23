/**
 * One answer per key at a time.
 *
 * Every proxy here follows the same shape: look in the cache, and on a miss
 * go and ask the provider. That is fine one visitor at a time and wrong with
 * a crowd: while the first request is still in flight there is nothing in the
 * cache yet, so the second, the tenth and the hundredth all go and ask the
 * same provider for the same thing. A cache with a five minute window does
 * not help there — the window has not started yet.
 *
 * So the first caller does the asking and everyone who turns up while it is
 * in flight waits for that same answer. It is the same idea as the lock in
 * front of us, one layer further in, and it is what stops a piece in the
 * press from turning into a burst against a provider that has already warned
 * us once.
 */

const inFlight = new Map<string, Promise<unknown>>();

/**
 * How long a shared ask may hold its key before everyone waiting on it is
 * let go.
 *
 * Sharing an answer means sharing whatever goes wrong with it. A provider
 * that hangs instead of failing — AEMET does exactly that — used to hang one
 * request; shared, it would hang every request for the same thing behind it,
 * and a hang has no end of its own: the default here is measured per chunk of
 * the body, so a provider dripping one byte at a time never times out at all.
 *
 * Each call already sets its own, shorter deadline. This is the net under
 * them, so that forgetting one cannot wedge a key in a process that stays up
 * for weeks.
 */
const DEADLINE_MS = 20_000;

function withDeadline<T>(key: string, work: () => Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`singleFlight: "${key}" held for ${ms} ms without answering`)),
      ms,
    );
    // Node keeps the process alive for a pending timer; this one must not.
    (timer as unknown as { unref?: () => void }).unref?.();

    // Wrapped so a guard that throws before its first await rejects here
    // instead of escaping.
    (async () => work())().then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * Runs `work` for `key`, or joins the run already under way for it.
 *
 * `joined` says which of the two happened, so the answer can say so out loud
 * (the proxies send it as X-Cache: JOINED) and the saving can be seen from
 * outside instead of taken on trust.
 *
 * The entry is removed when the work settles, so a failure is never shared
 * with the next wave of callers: this is a way of not asking twice at the
 * same time, not a way of remembering. Remembering is the cache's job, and it
 * stays where it was.
 */
export async function singleFlight<T>(
  key: string,
  work: () => Promise<T>,
  deadlineMs: number = DEADLINE_MS,
): Promise<{ value: T; joined: boolean }> {
  const running = inFlight.get(key) as Promise<T> | undefined;
  if (running) return { value: await running, joined: true };

  const started = withDeadline(key, work, deadlineMs).finally(() => {
    // Only clear our own entry: a later call may already have replaced it.
    if (inFlight.get(key) === started) inFlight.delete(key);
  });

  inFlight.set(key, started);
  return { value: await started, joined: false };
}

/** How many asks are in flight right now. For tests and for the log. */
export function inFlightCount(): number {
  return inFlight.size;
}

/** Tests only: forget everything, as a restart would. */
export function __resetSingleFlightForTests(): void {
  inFlight.clear();
}
