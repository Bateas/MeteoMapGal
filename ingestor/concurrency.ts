/**
 * Tiny concurrency limiter — same shape as Promise.allSettled but caps how
 * many fns run at once.
 *
 * Why we need this: `Promise.allSettled(stations.map(fetchOne))` fires N
 * fetches in parallel. When N is 50 (MeteoGalicia) or 30 (Wunderground),
 * the burst hits the LXC's DNS resolver as 50-80 lookups within the same
 * second every poll cycle — the user reported it on their pi-hole.
 *
 * Limiting to 6-8 in flight at any moment:
 *   - undici connection-pools naturally, so the same TCP socket gets
 *     reused for the next station instead of opening N sockets
 *   - DNS resolver answers from cache after the first lookup per host
 *     instead of hammered with N concurrent queries
 *   - spreads upstream load (politer to MeteoGalicia / WU)
 *
 * Trade-off: total cycle wall time grows roughly linearly with N/concurrency.
 * At 50 stations / concurrency=8 / ~300ms per fetch ≈ 2s, fine for a 5-min
 * polling cadence.
 */

/**
 * Same return shape as `Promise.allSettled` so callers can drop it in.
 * Order of results matches order of `items`.
 */
export async function allSettledLimit<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<PromiseSettledResult<R>[]> {
  if (concurrency < 1) throw new Error('concurrency must be >= 1');
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;

  const workers: Promise<void>[] = [];
  const workerCount = Math.min(concurrency, items.length);

  for (let w = 0; w < workerCount; w++) {
    workers.push(
      (async () => {
        while (true) {
          const i = next++;
          if (i >= items.length) return;
          try {
            const value = await fn(items[i], i);
            results[i] = { status: 'fulfilled', value };
          } catch (reason) {
            results[i] = { status: 'rejected', reason };
          }
        }
      })(),
    );
  }

  await Promise.all(workers);
  return results;
}
