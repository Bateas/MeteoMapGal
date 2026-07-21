/**
 * pushClient — pure helpers + subscription flows against mocked browser APIs.
 *
 * jsdom ships neither serviceWorker nor Notification nor PushManager, so the
 * default environment doubles as the "unsupported browser" case; the push
 * environment is installed explicitly per test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  urlBase64ToUint8Array,
  getSubscribedSpots,
  setSubscribedSpots,
  isPushSupported,
  subscribeSpot,
  unsubscribeSpot,
  sendTestPush,
  PUSH_SPOTS_STORAGE_KEY,
} from './pushClient';

// 16 bytes (1..16) in base64 — also valid base64url, no padding chars needed
const FAKE_VAPID_KEY = 'AQIDBAUGBwgJCgsMDQ4PEA';

interface FakeSub {
  endpoint: string;
  toJSON: () => Record<string, unknown>;
  unsubscribe: ReturnType<typeof vi.fn>;
}

function fakeSub(): FakeSub {
  return {
    endpoint: 'https://push.example/ep1',
    toJSON: () => ({ endpoint: 'https://push.example/ep1', keys: { p256dh: 'k', auth: 'a' } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
}

/** Install serviceWorker + Notification + PushManager + fetch mocks. */
function installPushEnv(opts: {
  permission?: NotificationPermission;
  requestPermission?: ReturnType<typeof vi.fn>;
  existingSub?: FakeSub | null;
} = {}) {
  const subscribe = vi.fn().mockResolvedValue(fakeSub());
  const getSubscription = vi.fn().mockResolvedValue(opts.existingSub ?? null);
  const reg = { pushManager: { subscribe, getSubscription } };

  Object.defineProperty(navigator, 'serviceWorker', {
    value: {
      getRegistration: vi.fn().mockResolvedValue(reg),
      ready: Promise.resolve(reg),
    },
    configurable: true,
  });
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', {
    permission: opts.permission ?? 'granted',
    requestPermission:
      opts.requestPermission ?? vi.fn().mockResolvedValue(opts.permission ?? 'granted'),
  });

  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/push/vapid-key')) {
      return { ok: true, status: 200, text: async () => FAKE_VAPID_KEY } as Response;
    }
    return { ok: true, status: 200, text: async () => '{}' } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);

  return { subscribe, getSubscription, fetchMock };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  // Remove the per-test serviceWorker mock so the next test starts unsupported
  delete (navigator as unknown as Record<string, unknown>).serviceWorker;
});

describe('urlBase64ToUint8Array', () => {
  it('converts plain base64 to the exact byte sequence', () => {
    expect(Array.from(urlBase64ToUint8Array('AQID'))).toEqual([1, 2, 3]);
  });

  it('handles url-safe characters and missing padding', () => {
    // '_w' → '/w==' → 0xFF ; '-A' → '+A==' → 0xF8
    expect(Array.from(urlBase64ToUint8Array('_w'))).toEqual([255]);
    expect(Array.from(urlBase64ToUint8Array('-A'))).toEqual([248]);
  });

  it('converts a realistic key length without altering byte count', () => {
    const out = urlBase64ToUint8Array(FAKE_VAPID_KEY);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  });
});

describe('subscribed spots localStorage', () => {
  it('round-trips a list through set/get', () => {
    setSubscribedSpots(['cesantes', 'patos']);
    expect(getSubscribedSpots()).toEqual(['cesantes', 'patos']);
  });

  it('returns [] on corrupt JSON', () => {
    localStorage.setItem(PUSH_SPOTS_STORAGE_KEY, '{not json');
    expect(getSubscribedSpots()).toEqual([]);
  });

  it('returns [] on valid JSON that is not an array, and filters non-strings', () => {
    localStorage.setItem(PUSH_SPOTS_STORAGE_KEY, '{"a":1}');
    expect(getSubscribedSpots()).toEqual([]);
    localStorage.setItem(PUSH_SPOTS_STORAGE_KEY, '["a", 2, "b", null]');
    expect(getSubscribedSpots()).toEqual(['a', 'b']);
  });
});

describe('isPushSupported', () => {
  it('is false in a bare jsdom environment (no serviceWorker/PushManager)', () => {
    expect(isPushSupported()).toBe(false);
  });

  it('is true once serviceWorker + PushManager + Notification exist', () => {
    installPushEnv();
    expect(isPushSupported()).toBe(true);
  });
});

describe('subscribeSpot', () => {
  it('returns denied when the user rejects the permission prompt', async () => {
    const requestPermission = vi.fn().mockResolvedValue('denied');
    installPushEnv({ permission: 'default', requestPermission });

    const result = await subscribeSpot('patos');

    expect(result).toBe('denied');
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(getSubscribedSpots()).toEqual([]);
  });

  it('merges the new spot with the stored list and POSTs the full list', async () => {
    setSubscribedSpots(['cesantes']);
    const { fetchMock } = installPushEnv();

    const result = await subscribeSpot('patos');

    expect(result).toBe('on');
    expect(getSubscribedSpots()).toEqual(['cesantes', 'patos']);

    const subscribeCall = fetchMock.mock.calls.find(
      ([url]) => String(url).includes('/push/subscribe'),
    );
    expect(subscribeCall).toBeDefined();
    const body = JSON.parse((subscribeCall![1] as RequestInit).body as string);
    expect(body.spotIds).toEqual(['cesantes', 'patos']);
    expect(body.subscription.endpoint).toBe('https://push.example/ep1');
  });

  it('reuses an existing browser subscription without fetching the VAPID key', async () => {
    const { fetchMock, subscribe } = installPushEnv({ existingSub: fakeSub() });

    const result = await subscribeSpot('patos');

    expect(result).toBe('on');
    expect(subscribe).not.toHaveBeenCalled();
    const vapidCall = fetchMock.mock.calls.find(([url]) => String(url).includes('vapid-key'));
    expect(vapidCall).toBeUndefined();
  });

  it('returns error (not throw) when the browser has no push support', async () => {
    expect(await subscribeSpot('patos')).toBe('error');
  });
});

describe('unsubscribeSpot', () => {
  it('removes the spot and tears down the subscription when the list empties', async () => {
    setSubscribedSpots(['patos']);
    const sub = fakeSub();
    const { fetchMock } = installPushEnv({ existingSub: sub });

    const result = await unsubscribeSpot('patos');

    expect(result).toBe('off');
    expect(getSubscribedSpots()).toEqual([]);
    expect(sub.unsubscribe).toHaveBeenCalledTimes(1);
    const unsubCall = fetchMock.mock.calls.find(
      ([url]) => String(url).includes('/push/unsubscribe'),
    );
    expect(unsubCall).toBeDefined();
    const body = JSON.parse((unsubCall![1] as RequestInit).body as string);
    expect(body.endpoint).toBe('https://push.example/ep1');
  });

  it('re-POSTs the remaining list when other spots stay subscribed', async () => {
    setSubscribedSpots(['patos', 'cesantes']);
    const sub = fakeSub();
    const { fetchMock } = installPushEnv({ existingSub: sub });

    await unsubscribeSpot('patos');

    expect(getSubscribedSpots()).toEqual(['cesantes']);
    expect(sub.unsubscribe).not.toHaveBeenCalled();
    const subscribeCall = fetchMock.mock.calls.find(
      ([url]) => String(url).includes('/push/subscribe'),
    );
    expect(subscribeCall).toBeDefined();
    const body = JSON.parse((subscribeCall![1] as RequestInit).body as string);
    expect(body.spotIds).toEqual(['cesantes']);
  });

  it('still clears localStorage when the environment is unsupported', async () => {
    setSubscribedSpots(['patos']);
    expect(await unsubscribeSpot('patos')).toBe('off');
    expect(getSubscribedSpots()).toEqual([]);
  });
});

describe('sendTestPush', () => {
  it('POSTs the current endpoint and reports success', async () => {
    const { fetchMock } = installPushEnv({ existingSub: fakeSub() });

    expect(await sendTestPush()).toBe(true);

    const testCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/push/test'));
    expect(testCall).toBeDefined();
    const body = JSON.parse((testCall![1] as RequestInit).body as string);
    expect(body.endpoint).toBe('https://push.example/ep1');
  });

  it('reports failure without a subscription', async () => {
    installPushEnv({ existingSub: null });
    expect(await sendTestPush()).toBe(false);
  });
});
