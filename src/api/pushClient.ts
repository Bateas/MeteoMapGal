/**
 * pushClient — Web Push opt-in for the lightning safety alerts (per-spot).
 *
 * Talks to the ingestor push endpoints (/api/v1/push/*) built by the backend:
 *   GET  /api/v1/push/vapid-key   → VAPID public key (raw base64url text or
 *                                   JSON { publicKey })
 *   POST /api/v1/push/subscribe   → { subscription, spotIds } (full list)
 *   POST /api/v1/push/unsubscribe → { endpoint }
 *   POST /api/v1/push/test        → { endpoint }
 *
 * Degradation rules: every network/API failure logs via console.debug (never
 * console.error — the endpoint may not exist yet in dev) and returns a state
 * the UI can render. Nothing here ever throws to the caller.
 */

/** localStorage key holding the JSON array of subscribed spot ids. */
export const PUSH_SPOTS_STORAGE_KEY = 'meteomap-push-spots';

export type PushSubscribeResult = 'on' | 'denied' | 'error';

/**
 * Whether this browser can receive Web Push at all.
 * iOS Safari only exposes PushManager once the PWA is installed to the home
 * screen (A2HS) — when unsupported the opt-in UI hides itself silently
 * instead of explaining why.
 */
export function isPushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Standard VAPID applicationServerKey conversion: base64url → Uint8Array.
 * Pure function (testable without any browser push API).
 * Return type pins the ArrayBuffer generic so it satisfies DOM BufferSource
 * (TS 5.7+ generic typed arrays — plain Uint8Array widens to ArrayBufferLike).
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** Read the subscribed spot ids from localStorage. Corrupt data → []. */
export function getSubscribedSpots(): string[] {
  try {
    const raw = localStorage.getItem(PUSH_SPOTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

/** Persist the subscribed spot ids. Storage failures are non-fatal. */
export function setSubscribedSpots(spotIds: string[]): void {
  try {
    localStorage.setItem(PUSH_SPOTS_STORAGE_KEY, JSON.stringify(spotIds));
  } catch (err) {
    // Quota/blocked storage — the server still holds the list, so next
    // subscribe call resyncs it.
    console.debug('[Push] localStorage write failed:', err);
  }
}

/**
 * The SW only registers in production (main.tsx gates on import.meta.env.PROD).
 * `navigator.serviceWorker.ready` NEVER resolves without a registration, so we
 * probe getRegistration() first to avoid hanging forever in dev.
 */
async function getActiveRegistration(): Promise<ServiceWorkerRegistration | null> {
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (!existing) {
      console.debug('[Push] no service worker registration (dev mode?)');
      return null;
    }
    return await navigator.serviceWorker.ready;
  } catch (err) {
    console.debug('[Push] service worker not ready:', err);
    return null;
  }
}

async function fetchVapidKey(): Promise<string | null> {
  try {
    const res = await fetch('/api/v1/push/vapid-key');
    if (!res.ok) {
      console.debug(`[Push] vapid-key responded ${res.status}`);
      return null;
    }
    const text = (await res.text()).trim();
    // Contract tolerance: raw base64url text OR JSON { publicKey } / "key".
    try {
      const json: unknown = JSON.parse(text);
      if (typeof json === 'string') return json.length > 0 ? json : null;
      if (json && typeof json === 'object') {
        const obj = json as Record<string, unknown>;
        const key = obj.publicKey ?? obj.key ?? obj.vapidKey;
        return typeof key === 'string' && key.length > 0 ? key : null;
      }
      return null;
    } catch {
      // Not JSON → raw key text
      return text.length > 0 ? text : null;
    }
  } catch (err) {
    console.debug('[Push] vapid-key fetch failed:', err);
    return null;
  }
}

async function postJson(path: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.debug(`[Push] POST ${path} responded ${res.status}`);
    return res.ok;
  } catch (err) {
    console.debug(`[Push] POST ${path} failed:`, err);
    return false;
  }
}

/**
 * Opt this spot into the lightning safety pushes.
 * Reuses the existing browser subscription when there is one; the backend
 * always receives the FULL updated spot list (idempotent upsert by endpoint).
 */
export async function subscribeSpot(spotId: string): Promise<PushSubscribeResult> {
  if (!isPushSupported()) return 'error';
  try {
    let permission: NotificationPermission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') return 'denied';

    const reg = await getActiveRegistration();
    if (!reg) return 'error';

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const key = await fetchVapidKey();
      if (!key) return 'error';
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    }

    const current = getSubscribedSpots();
    const next = current.includes(spotId) ? current : [...current, spotId];
    const ok = await postJson('/api/v1/push/subscribe', {
      subscription: sub.toJSON(),
      spotIds: next,
    });
    if (!ok) return 'error';

    setSubscribedSpots(next);
    return 'on';
  } catch (err) {
    console.debug('[Push] subscribe failed:', err);
    return 'error';
  }
}

/**
 * Remove this spot from the push list. Last spot removed → tear down the
 * whole browser subscription. The local list is ALWAYS updated (best-effort
 * network): the user's intent to stop being notified wins over transport.
 */
export async function unsubscribeSpot(spotId: string): Promise<'off'> {
  const next = getSubscribedSpots().filter((id) => id !== spotId);
  try {
    if (isPushSupported()) {
      const reg = await getActiveRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        if (next.length === 0) {
          await postJson('/api/v1/push/unsubscribe', { endpoint: sub.endpoint });
          await sub.unsubscribe().catch(() => false);
        } else {
          await postJson('/api/v1/push/subscribe', {
            subscription: sub.toJSON(),
            spotIds: next,
          });
        }
      }
    }
  } catch (err) {
    console.debug('[Push] unsubscribe failed:', err);
  }
  setSubscribedSpots(next);
  return 'off';
}

/** Ask the backend to fire a test notification at the current subscription. */
export async function sendTestPush(): Promise<boolean> {
  try {
    if (!isPushSupported()) return false;
    const reg = await getActiveRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (!sub) return false;
    return await postJson('/api/v1/push/test', { endpoint: sub.endpoint });
  } catch (err) {
    console.debug('[Push] test push failed:', err);
    return false;
  }
}
