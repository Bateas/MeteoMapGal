import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  captureObserverCodeFromUrl, currentObserverCode, saveObserverCode, fetchObserver, takeObserverGreeting,
  pendingObserverCode, resolvePendingObserverCode, __clearObserverCacheForTests,
} from './fieldReportClient';

const CODE = 'abcdefgh23456k';

describe('observer code on this device', () => {
  beforeEach(() => { localStorage.clear(); __clearObserverCacheForTests(); takeObserverGreeting(); });
  afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

  it('a personal link saves the code and takes it out of the address bar, keeping the rest', () => {
    window.history.replaceState(null, '', `/?sector=rias&obs=${CODE}#mapa`);
    expect(captureObserverCodeFromUrl()).toBe(true);
    expect(currentObserverCode()).toBe(CODE);
    expect(window.location.search).toBe('?sector=rias');
    expect(window.location.hash).toBe('#mapa');
    expect(takeObserverGreeting()).toBe(true);
    expect(takeObserverGreeting()).toBe(false);                        // hello only once
    window.history.replaceState(null, '', `/?obs=${CODE}`);
    expect(captureObserverCodeFromUrl()).toBe(false);                  // same code again: not new
  });

  it('someone else\'s link never replaces this device\'s code silently: it waits for a yes', () => {
    saveObserverCode(CODE);
    const OTHER = 'zzzzzzzz23456k';
    window.history.replaceState(null, '', `/?obs=${OTHER}`);
    expect(captureObserverCodeFromUrl()).toBe(false);
    expect(currentObserverCode()).toBe(CODE);
    expect(pendingObserverCode()).toBe(OTHER);
    resolvePendingObserverCode(false);
    expect(currentObserverCode()).toBe(CODE);
    expect(pendingObserverCode()).toBeNull();
    window.history.replaceState(null, '', `/?obs=${OTHER}`);
    captureObserverCodeFromUrl();
    resolvePendingObserverCode(true);
    expect(currentObserverCode()).toBe(OTHER);
  });

  it('a malformed code leaves the address bar too, but is not saved', () => {
    window.history.replaceState(null, '', '/?obs=../../x');
    expect(captureObserverCodeFromUrl()).toBe(false);
    expect(window.location.search).toBe('');
    expect(currentObserverCode()).toBeNull();
  });

  it('typed by hand: the code or the whole link', () => {
    expect(saveObserverCode(`https://meteomapgal.com/?obs=${CODE.toUpperCase()}`)).toBe(true);
    expect(currentObserverCode()).toBe(CODE);
    expect(saveObserverCode('no vale')).toBe(false);
  });

  it('asks the server with a POST; an unknown or switched-off code is forgotten', async () => {
    saveObserverCode(CODE);
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchObserver()).toBeNull();
    expect((fetchMock.mock.calls[0] as unknown as [string, { method: string }])[1].method).toBe('POST');
    expect(currentObserverCode()).toBeNull();
  });

  it('a failure that is not a 404 keeps the code for next time, and one answer is shared', async () => {
    saveObserverCode(CODE);
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('red'))));
    expect(await fetchObserver()).toBeNull();
    expect(currentObserverCode()).toBe(CODE);
    const ok = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ name: 'Ana', reports: [] }) }));
    vi.stubGlobal('fetch', ok);
    const [a, b] = await Promise.all([fetchObserver(), fetchObserver()]);
    expect(a?.name).toBe('Ana');
    expect(b).toBe(a);
    expect(ok).toHaveBeenCalledTimes(1);
  });
});
