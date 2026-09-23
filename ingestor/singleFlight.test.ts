/**
 * What this guards is the moment a crowd arrives on a cold cache: a hundred
 * visitors asking at once must cost the provider one request, not a hundred.
 * The failure it prevents is silent — everything still works, it just works
 * against a provider that has already warned us once about the volume.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { singleFlight, inFlightCount, __resetSingleFlightForTests } from './singleFlight';

beforeEach(() => __resetSingleFlightForTests());

/** A promise we decide when to settle, standing in for the provider. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('singleFlight', () => {
  it('asks once for a hundred callers arriving together', async () => {
    const d = deferred<string>();
    const work = vi.fn(() => d.promise);

    const all = Promise.all(Array.from({ length: 100 }, () => singleFlight('k', work)));
    d.resolve('la respuesta');

    const results = await all;
    expect(results.map((r) => r.value)).toEqual(Array(100).fill('la respuesta'));
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('says who asked and who only waited', async () => {
    const d = deferred<string>();
    const work = vi.fn(() => d.promise);

    const results = Promise.all([singleFlight('k', work), singleFlight('k', work), singleFlight('k', work)]);
    d.resolve('v');

    expect((await results).map((r) => r.joined)).toEqual([false, true, true]);
  });

  it('keeps different keys apart', async () => {
    const work = vi.fn(async (v: string) => v);
    const [a, b] = await Promise.all([
      singleFlight('a', () => work('a')),
      singleFlight('b', () => work('b')),
    ]);
    expect([a.value, b.value]).toEqual(['a', 'b']);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('asks again once the previous ask has finished', async () => {
    const work = vi.fn(async () => 'v');
    await singleFlight('k', work);
    const second = await singleFlight('k', work);
    expect(work).toHaveBeenCalledTimes(2);
    expect(second.joined).toBe(false);
  });

  it('shares a failure with those already waiting, and no one else', async () => {
    const d = deferred<string>();
    const failing = vi.fn(() => d.promise);

    const waiting = [singleFlight('k', failing), singleFlight('k', failing)];
    d.reject(new Error('el proveedor cayo'));
    await expect(Promise.all(waiting)).rejects.toThrow('el proveedor cayo');
    expect(failing).toHaveBeenCalledTimes(1);

    // The next wave must be free to try again: we do not remember failures.
    const ok = vi.fn(async () => 'bien');
    await expect(singleFlight('k', ok)).resolves.toEqual({ value: 'bien', joined: false });
  });

  it('leaves nothing behind, whether the ask worked or not', async () => {
    await singleFlight('ok', async () => 1);
    await singleFlight('ko', async () => { throw new Error('x'); }).catch(() => {});
    expect(inFlightCount()).toBe(0);
  });

  it('does not let a throw before the first await escape the sharing', async () => {
    // A guard that throws synchronously inside work() must still reject the
    // caller, not blow up the map and leave the key wedged forever.
    await expect(singleFlight('k', () => { throw new Error('ruta invalida'); }))
      .rejects.toThrow('ruta invalida');
    expect(inFlightCount()).toBe(0);
  });
});

describe('el plazo maximo de un vuelo compartido', () => {
  // The reason this exists: sharing an answer means sharing the hang that
  // comes with it. AEMET answers by not answering, and a body that drips
  // never trips the default timeout, so without this one slow provider would
  // wedge a key for the life of the process and every later caller with it.
  it('suelta a los que esperan cuando el proveedor no contesta', async () => {
    vi.useFakeTimers();
    try {
      const nunca = vi.fn(() => new Promise(() => {}));
      const first = singleFlight('k', nunca, 15_000);
      const joiner = singleFlight('k', nunca, 15_000);
      const caught = Promise.allSettled([first, joiner]);

      await vi.advanceTimersByTimeAsync(15_001);

      const [a, b] = await caught;
      expect(a.status).toBe('rejected');
      expect(b.status).toBe('rejected');
      expect(String((a as PromiseRejectedResult).reason)).toMatch(/15000 ms/);
      expect(nunca).toHaveBeenCalledTimes(1);
      expect(inFlightCount()).toBe(0); // the key is free again
    } finally {
      vi.useRealTimers();
    }
  });

  it('deja que la siguiente peticion lo intente de nuevo', async () => {
    vi.useFakeTimers();
    try {
      const colgado = singleFlight('k', () => new Promise(() => {}), 15_000);
      const swallowed = colgado.catch(() => 'caido');
      await vi.advanceTimersByTimeAsync(15_001);
      expect(await swallowed).toBe('caido');

      const ok = await singleFlight('k', async () => 'ya contesta', 15_000);
      expect(ok).toEqual({ value: 'ya contesta', joined: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it('no penaliza a quien contesta dentro de plazo', async () => {
    const r = await singleFlight('k', async () => 'rapido', 15_000);
    expect(r.value).toBe('rapido');
    expect(inFlightCount()).toBe(0);
  });
});
