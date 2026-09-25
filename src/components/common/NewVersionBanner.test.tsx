import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { NewVersionBanner } from './NewVersionBanner';

const page = (hash: string) => `<script type="module" crossorigin src="/assets/main-${hash}.js"></script>`;

describe('NewVersionBanner', () => {
  let script: HTMLScriptElement;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    script = document.createElement('script');
    script.type = 'module';
    script.src = '/assets/main-OLD111.js';
    document.head.appendChild(script);
  });
  afterEach(() => {
    script.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const settle = async (ms: number) => {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  };

  it('asks to reload once a newer deploy is published, and "Luego" hides it for that deploy', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(page('NEW222')) }));
    render(<NewVersionBanner enabled />);
    expect(screen.queryByText('Hay una versión nueva')).toBeNull();   // no check before the first minute
    await settle(61_000);
    expect(screen.getByText('Hay una versión nueva')).toBeTruthy();
    fireEvent.click(screen.getByText('Luego'));
    expect(screen.queryByText('Hay una versión nueva')).toBeNull();
    await settle(10 * 60_000);                                        // same deploy on the next check
    expect(screen.queryByText('Hay una versión nueva')).toBeNull();
  });

  it('stays silent when the published page is the one already loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(page('OLD111')) }));
    render(<NewVersionBanner enabled />);
    await settle(61_000);
    expect(screen.queryByText('Hay una versión nueva')).toBeNull();
  });

  it('does nothing at all when disabled (development)', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    render(<NewVersionBanner enabled={false} />);
    await settle(61_000);
    expect(f).not.toHaveBeenCalled();
  });
});
