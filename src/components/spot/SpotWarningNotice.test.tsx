/**
 * SpotWarningNotice — collapse behaviour of the sport-threshold notice.
 *
 * The wording itself is guarded in sportWarningService tests (including the
 * no-authorisation guardrail). What is asserted here is WHEN each piece is
 * visible: the informative orange-below case earns only one line by default,
 * while safety information (values above the threshold, red warning) is never
 * hidden behind a tap.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SpotWarningNotice } from './SpotWarningNotice';
import { useWarningsStore } from '../../hooks/useWarnings';
import {
  createSimulatedWarning,
  SPORT_RULE_SOURCE,
} from '../../services/sportWarningService';

/** Render with explicit props for a given sim case (never via ?simorange=). */
function renderCase(simCase: Parameters<typeof createSimulatedWarning>[0]) {
  const sim = createSimulatedWarning(simCase);
  return render(
    <SpotWarningNotice
      sectorId="rias"
      warnings={sim.warnings}
      waveHeightM={sim.waveHeightM}
      windKt={sim.windKt}
    />,
  );
}

describe('SpotWarningNotice — collapsible density', () => {
  beforeEach(() => {
    // The component reads ?simorange= from the URL; these tests drive it via
    // props only, so the search string must be clean or the sim would win.
    window.history.replaceState({}, '', '/');
    expect(window.location.search).toBe('');
    useWarningsStore.setState({ sectorWarnings: [] });
  });

  it('collapses to one line by default on orange below threshold', () => {
    renderCase('below');

    // The one-liner: headline + binding phrase, behind an accessible toggle
    const toggle = screen.getByRole('button');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText(/Aviso naranja por oleaje/)).toBeInTheDocument();
    expect(screen.getByText(/Aquí manda la ola/)).toBeInTheDocument();

    // The detail (threshold, readings, source, official link) stays hidden
    expect(screen.queryByText(/El umbral deportivo/)).toBeNull();
    expect(screen.queryByText(/Ahora mismo/)).toBeNull();
    expect(screen.queryByText(SPORT_RULE_SOURCE)).toBeNull();
    expect(screen.queryByText(/Aviso oficial de MeteoGalicia/)).toBeNull();
  });

  it('expands on tap and reveals the Xunta source and official link', () => {
    renderCase('below');

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(SPORT_RULE_SOURCE)).toBeInTheDocument();
    expect(screen.getByText(/El umbral deportivo/)).toBeInTheDocument();
    expect(screen.getByText(/Aviso oficial de MeteoGalicia/)).toBeInTheDocument();
  });

  it('renders fully expanded when a value is above the threshold', () => {
    renderCase('above');

    // Safety information is not hidden behind a tap: no toggle at all,
    // and the over-threshold status is visible from the first paint.
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/Por encima del umbral deportivo/)).toBeInTheDocument();
    expect(screen.getByText(SPORT_RULE_SOURCE)).toBeInTheDocument();
  });

  it('renders fully expanded on a red warning', () => {
    renderCase('red');

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/Aviso rojo por oleaje/)).toBeInTheDocument();
    expect(
      screen.getByText(/con aviso rojo no se aplica/),
    ).toBeInTheDocument();
  });

  it('keeps the missing-data case collapsed but reveals which datum is absent on tap', () => {
    renderCase('missing');

    // Missing data is informative, not a safety escalation → collapsed.
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/No hay dato de ola/)).toBeNull();

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/No hay dato de ola/)).toBeInTheDocument();
  });
});
