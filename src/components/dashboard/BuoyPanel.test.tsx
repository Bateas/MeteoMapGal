import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { BuoyPanel } from './BuoyPanel';
import { useBuoyStore } from '../../store/buoyStore';

afterEach(() => {
  cleanup();
  useBuoyStore.setState({ buoys: [], error: null, loading: false, lastFetch: 0 } as never);
});

describe('the buoy panel with nothing to show', () => {
  it('a request that fails says so in words, not with the message of the request', () => {
    useBuoyStore.setState({ buoys: [], error: 'HTTP 500 Internal Server Error', loading: false, lastFetch: Date.now() } as never);
    const { container } = render(<BuoyPanel />);
    expect(container.textContent).toContain('No se pudieron cargar las boyas');
    expect(container.textContent).not.toContain('HTTP 500');
  });

  it('no buoys and no failure is another thing, and says another thing', () => {
    useBuoyStore.setState({ buoys: [], error: null, loading: false, lastFetch: Date.now() } as never);
    const { container } = render(<BuoyPanel />);
    expect(container.textContent).toContain('Sin datos de boyas');
    expect(container.textContent).not.toContain('No se pudieron');
  });
});
