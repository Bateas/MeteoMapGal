/**
 * An old error is not a source down. The random breaks of 11-nov turned «an error AFTER the last good answer» into
 * «any error on record», and the suite stayed green: every test had its error newer than its success.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SourceStatusBanner } from './SourceStatusBanner';
import { useWeatherStore } from '../../store/weatherStore';

const MIN = 60_000;
const ago = (min: number) => new Date(Date.now() - min * MIN);

function seed(sources: Record<string, unknown>) {
  useWeatherStore.setState({ sourceFreshness: new Map(Object.entries(sources)) } as never);
}

afterEach(() => {
  cleanup();
  useWeatherStore.setState({ sourceFreshness: new Map() } as never);
});

describe('the banner of missing sources and the order of error and success', () => {
  it('an error two hours ago and a good answer half an hour ago: it answered last, no banner', () => {
    seed({ aemet: { lastSuccess: ago(30), lastError: ago(120), readingCount: 8, errorMessage: 'HTTP 429' } });
    render(<SourceStatusBanner />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('the same two the other way round: it failed last, banner', () => {
    seed({ aemet: { lastSuccess: ago(120), lastError: ago(30), readingCount: 0, errorMessage: 'HTTP 429' } });
    render(<SourceStatusBanner />);
    expect(screen.getByRole('alert').textContent).toContain('Faltan datos de AEMET');
  });

  it('never a good answer and an error: banner', () => {
    seed({ meteogalicia: { lastSuccess: null, lastError: ago(1), readingCount: 0 } });
    render(<SourceStatusBanner />);
    expect(screen.getByRole('alert').textContent).toContain('Faltan datos de MeteoGalicia');
  });
});
