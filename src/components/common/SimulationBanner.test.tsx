import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SimulationBanner } from './SimulationBanner';

describe('SimulationBanner', () => {
  it('renders nothing without a simulation parameter', () => {
    const { container } = render(<SimulationBanner search="?sector=rias&spot=cesantes" />);
    expect(container.firstChild).toBeNull();
  });

  it('says the screen is invented and names the parameter', () => {
    render(<SimulationBanner search="?simstrike=cesantes" />);
    expect(screen.getByRole('alert').textContent).toContain('SIMULACIÓN');
    expect(screen.getByText(/no es el tiempo real/)).toBeTruthy();
    expect(screen.getByText('?simstrike')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Salir de la simulación' })).toBeTruthy();
  });
});
