/**
 * Puertos del Estado authorised the use of its buoy data (1-oct-2026) on the
 * condition that every use names it with the address of its portal. These pin
 * that the credit names the right providers, station by station.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BuoyCredit } from './BuoyCredit';
import { buoyProviders } from '../../api/buoyClient';

describe('buoyProviders', () => {
  it('a Puertos del Estado station names only them', () => {
    expect(buoyProviders([2248])).toEqual(['pde']);
  });

  it('Muros and the CETMAR moorings come from the Xunta only (not asked to Puertos del Estado)', () => {
    expect(buoyProviders([15009])).toEqual(['xunta']);
    expect(buoyProviders([1251])).toEqual(['xunta']);
    expect(buoyProviders([1250, 1253, 1255])).toEqual(['xunta']);
  });

  it('a list with both names both, Puertos del Estado first', () => {
    expect(buoyProviders([15009, 3221])).toEqual(['pde', 'xunta']);
  });

  it('unknown ids add nothing', () => {
    expect(buoyProviders([99999])).toEqual([]);
  });
});

describe('BuoyCredit', () => {
  it('shows the portal address as text, linked', () => {
    render(<BuoyCredit providers={['pde', 'xunta']} />);
    expect(screen.getByText(/Datos:/).textContent).toBe(
      'Datos: Puertos del Estado (portus.puertos.es) y Observatorio Costeiro da Xunta',
    );
    const link = screen.getByRole('link', { name: 'portus.puertos.es' });
    expect(link.getAttribute('href')).toBe('https://portus.puertos.es/');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('renders nothing without providers', () => {
    const { container } = render(<BuoyCredit providers={[]} />);
    expect(container.textContent).toBe('');
  });
});
