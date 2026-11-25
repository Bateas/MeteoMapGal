/**
 * When a source fails the banner names it. A count says nothing to someone who does not know how many there are, and
 * «no responde» on a source that answered a minute ago would be a false alarm.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SourceStatusBanner } from './SourceStatusBanner';
import { useWeatherStore } from '../../store/weatherStore';

const MIN = 60_000;
const down = (errorMessage?: string) => ({ lastSuccess: new Date(Date.now() - 60 * MIN), lastError: new Date(), readingCount: 0, errorMessage });
const up = () => ({ lastSuccess: new Date(), lastError: null, readingCount: 12 });

function seed(sources: Record<string, unknown>) {
  useWeatherStore.setState({ sourceFreshness: new Map(Object.entries(sources)) } as never);
}

afterEach(() => {
  cleanup();
  useWeatherStore.setState({ sourceFreshness: new Map() } as never);
});

describe('the banner of missing sources', () => {
  it('names them, it does not count them', () => {
    seed({ aemet: down(), meteogalicia: down(), meteoclimatic: up() });
    render(<SourceStatusBanner />);
    expect(screen.getByRole('alert').textContent).toContain('Faltan datos de AEMET y MeteoGalicia');
    expect(screen.getByRole('alert').textContent).not.toMatch(/\d+ fuentes/);
  });

  it('with three, a list that reads', () => {
    seed({ aemet: down(), meteogalicia: down(), netatmo: down() });
    render(<SourceStatusBanner />);
    expect(screen.getByRole('alert').textContent).toContain('Faltan datos de AEMET, MeteoGalicia y Netatmo');
  });

  it('all well: nothing at all', () => {
    seed({ aemet: up(), meteogalicia: up() });
    render(<SourceStatusBanner />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('an error right after a success a minute ago is not a source down', () => {
    seed({ aemet: { lastSuccess: new Date(Date.now() - MIN), lastError: new Date(), readingCount: 8 } });
    render(<SourceStatusBanner />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('one secondary source down does not raise it; a critical one does', () => {
    seed({ netatmo: down() });
    render(<SourceStatusBanner />);
    expect(screen.queryByRole('alert')).toBeNull();
    cleanup();
    seed({ aemet: down('Sin respuesta') });
    render(<SourceStatusBanner />);
    expect(screen.getByRole('alert').textContent).toContain('Faltan datos de AEMET');
  });

  it('can be closed', () => {
    seed({ aemet: down() });
    render(<SourceStatusBanner />);
    fireEvent.click(screen.getByRole('alert').querySelector('button')!);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
