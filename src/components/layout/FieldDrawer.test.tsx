/**
 * The Condiciones drawer and the strip on the map: one list, one column, nothing under 13 px.
 * This panel has no other guard: it is lazy, so without a test only the type check would see it break.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FieldDrawer } from './FieldDrawer';
import { AlertPanel } from '../map/AlertPanel';
import { useAlertStore } from '../../store/alertStore';
import { useUIStore } from '../../store/uiStore';
import { useSectorStore } from '../../store/sectorStore';
import { useWarningsStore } from '../../hooks/useWarnings';
import { useForecastStore } from '../../hooks/useForecastTimeline';
import { useAirQualityStore } from '../../store/airQualityStore';
import { useIcaStore } from '../../store/icaStore';
import { SECTORS } from '../../config/sectors';
import type { HourlyForecast } from '../../types/forecast';
import type { MGWarning } from '../../api/mgWarningsClient';

// Node modules through a string variable: the app tsconfig carries no Node types, and vitest empties
// a stylesheet imported with ?raw. The test always runs under Node, from the root of the repo.
const fsModule = 'node:fs';
const { readFileSync } = await import(/* @vite-ignore */ fsModule);

vi.mock('../../api/tideClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/tideClient')>();
  return {
    ...actual,
    fetchTides48h: vi.fn().mockResolvedValue({ today: [{ time: '12:15', height: 0.8, type: 'low' }], tomorrow: [] }),
    fetchTidePredictions: vi.fn().mockResolvedValue([]),
  };
});

const sector = (id: string) => useSectorStore.setState({ activeSector: SECTORS.find((s) => s.id === id)! });

function warning(): MGWarning {
  const start = new Date(); start.setHours(start.getHours() + 1, 0, 0, 0);
  const end = new Date(start.getTime() + 2 * 3_600_000);
  return { type: 'Vento', typeId: 3, maxLevel: 2, publishedAt: new Date(), link: '', zones: [{ name: 'Rías Baixas', id: 336, level: 2, startTime: start, endTime: end, comment: 'Rachas de 80 km/h' }] };
}

beforeEach(() => {
  cleanup();
  // «En el campo» remembers its fold in the store since 18-nov: each test starts folded
  useUIStore.setState({ campoOpen: false });
  useAlertStore.setState({ alerts: [] });
  useWarningsStore.setState({ sectorWarnings: [], ipmaSectorWarnings: [], lastFetch: null });
  useForecastStore.setState({ hourly: [], convectionData: [] });
  useAirQualityStore.setState({ data: null });
  useIcaStore.setState({ readings: [] });
  useUIStore.setState({ isMobile: false, fieldDrawerOpen: true });
  sector('embalse');
});

describe('FieldDrawer', () => {
  it('with nothing to say: a few lines, without «sin riesgo», and no tabs', () => {
    const { container } = render(<FieldDrawer onClose={() => {}} />);
    expect(screen.getByText(/Nada que avisar ahora en/)).toBeTruthy();
    expect(screen.getByText('Ahora')).toBeTruthy();
    expect(screen.getByText('Hoy y mañana')).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(container.textContent?.toLowerCase()).not.toContain('sin riesgo');
  });

  it('what was cut is not there', () => {
    const { container } = render(<FieldDrawer onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /En el campo/ }));
    const text = container.textContent ?? '';
    for (const gone of [/ET₀/, /Fitosanitario/, /Grados-Día/, /Mildiu/, /Viento en estaciones/, /Historial/, /Dron/, /Perfil Atmosférico/, /Tratamientos/, /Siembra/, /Poda/, /Actualizado hace/, /Timeline/, /Beta/]) {
      expect(text).not.toMatch(gone);
    }
  });

  it('official warning with day and hour, its agency, and its numbers folded', () => {
    // Fixed at ten in the morning: the warning starts and ends relative to now, and run after nine at night
    // it crossed midnight and read «hasta mañana…» instead of «de N a M h» (seen 11-nov 22:30).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 11, 10, 0));
    useWarningsStore.setState({ sectorWarnings: [warning()] });
    render(<FieldDrawer onClose={() => {}} />);
    expect(screen.getByText(/Aviso naranja de MeteoGalicia por viento/)).toBeTruthy();
    // The agency is in the text; «(oficial)» after it repeated it (18-nov).
    expect(screen.queryByText('(oficial)')).toBeNull();
    expect(screen.getByText(/ de \d+ a \d+ h · Rías Baixas/)).toBeTruthy();
    expect(screen.queryByText('Rachas de 80 km/h')).toBeNull();
    const row = screen.getByRole('button', { expanded: false, name: /Aviso naranja/ });
    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Rachas de 80 km/h')).toBeTruthy();
    vi.useRealTimers();
  });

  it('mareas only on the coast', async () => {
    const { unmount } = render(<FieldDrawer onClose={() => {}} />);
    expect(screen.queryByText('Mareas')).toBeNull();
    unmount();
    sector('rias');
    render(<FieldDrawer onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Mareas')).toBeTruthy());
  });

  it('En el campo leads to the official notices on pests, without saying anything of its own', () => {
    render(<FieldDrawer onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /En el campo/ }));
    expect(screen.getByRole('link', { name: /Areeiro/ }).getAttribute('href')).toContain('areeiro.depo.gal');
    expect(screen.getByRole('link', { name: /Medio Rural/ }).getAttribute('rel')).toContain('noopener');
  });

  it('En el campo is folded, says the frost in its row and keeps phase and calendar', () => {
    useAlertStore.setState({
      alerts: [{ id: 'frost-forecast', category: 'frost', severity: 'moderate', score: 50, icon: 'snowflake', title: 'Riesgo de helada', detail: 'Mín prevista -1.0°C', urgent: false, updatedAt: new Date() }],
    });
    render(<FieldDrawer onClose={() => {}} />);
    const fold = screen.getByRole('button', { name: /En el campo/ });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(fold.textContent).toContain('Riesgo de helada (modelo)');
    fireEvent.click(fold);
    expect(screen.getByText(/% iluminada/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Calendario lunar/ }));
    expect(screen.getByText('L')).toBeTruthy();
  });

  it('the strip by hours is folded and only with something to show', () => {
    const now = new Date();
    const hourly = Array.from({ length: 12 }, (_, i) => ({ time: new Date(now.getTime() + i * 3_600_000), precipitation: 3, precipProbability: 80, cape: 0, temperature: 12, cloudCover: 50, windSpeed: 3 } as HourlyForecast));
    useForecastStore.setState({ hourly });
    render(<FieldDrawer onClose={() => {}} />);
    const fold = screen.getByRole('button', { name: /Por horas/ });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(fold);
    expect(screen.getByRole('img', { name: /^Lluvia\./ })).toBeTruthy();
  });

  it('calima and air quality are lines of the list, now that they are not painted', () => {
    useAirQualityStore.setState({ data: { uvIndex: 1, pm2_5: 5, europeanAqi: 10, dust: 30, aerosolOpticalDepth: 0.1, fetchedAt: Date.now() } });
    const c = SECTORS.find((s) => s.id === 'embalse')!.center;
    useIcaStore.setState({ readings: [{ station: 'Ourense', ica: 3, dominantPollutant: 'O3', categoryEs: 'Deficiente', color: '#f00', lat: c[1] + 0.1, lon: c[0], timestamp: new Date() }] });
    render(<FieldDrawer onClose={() => {}} />);
    expect(screen.getByText(/Calima prevista/)).toBeTruthy();
    expect(screen.getByText(/Calidad del aire deficiente en Ourense, a \d+ km/)).toBeTruthy();
  });

  it('on a desktop it is a panel beside the map: focus goes in, Tab may leave (P3 review, 19-nov)', () => {
    render(<FieldDrawer onClose={() => {}} />);
    const panel = screen.getByRole('region', { name: 'Condiciones' });
    expect(panel.contains(document.activeElement)).toBe(true);
    const buttons = panel.querySelectorAll<HTMLElement>('button');
    const last = buttons[buttons.length - 1];
    last.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    last.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
  });

  it('on a phone it is a dialog that keeps the focus', () => {
    useUIStore.setState({ isMobile: true });
    try {
      render(<FieldDrawer onClose={() => {}} />);
      const dialog = screen.getByRole('dialog', { name: 'Condiciones' });
      const buttons = dialog.querySelectorAll<HTMLElement>('button');
      const last = buttons[buttons.length - 1];
      last.focus();
      const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      last.dispatchEvent(tab);
      expect(tab.defaultPrevented).toBe(true);
    } finally {
      useUIStore.setState({ isMobile: false });
    }
  });

  it('Escape closes it, so the focus trap has a way out from the keyboard', () => {
    const onClose = vi.fn();
    render(<FieldDrawer onClose={onClose} />);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('the strip on the map reads the same list', () => {
  // Advanced: in simple mode the strip only says what the strip over the map does not, and with
  // nothing left it is not drawn at all (AlertPanel.test.tsx, «one voice per fact»). It still never
  // reads «nothing» under a warning: there it is simply absent.
  beforeEach(() => useUIStore.setState({ simpleMode: false }));
  afterEach(() => useUIStore.setState({ simpleMode: true }));

  it('nothing active: grey, without claiming more than it knows', () => {
    const { container } = render(<AlertPanel />);
    expect(screen.getByText('Nada activo')).toBeTruthy();
    expect(container.textContent).not.toContain('Sin alertas');
    expect(container.querySelector('.gc-t-ok')).toBeNull();
  });

  it('an official warning counts: it used to read «Sin alertas» under a red warning', () => {
    useWarningsStore.setState({ sectorWarnings: [warning()] });
    render(<AlertPanel />);
    expect(screen.getByText('Alerta')).toBeTruthy();
    expect(screen.getByText(/Aviso naranja/)).toBeTruthy();
  });

  it('it opens the drawer', () => {
    useUIStore.setState({ fieldDrawerOpen: false });
    render(<AlertPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Ver condiciones/ }));
    expect(useUIStore.getState().fieldDrawerOpen).toBe(true);
  });
});

describe('nothing under 13 px', () => {
  it('in its stylesheet', () => {
    const css: string = readFileSync('src/styles/condiciones.css', 'utf8');
    const sizes = [...css.matchAll(/(?:font-size:\s*|font:\s*\d*\s*)(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(10);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(13);
  });

  it('and in the components: no old tiny classes', () => {
    for (const f of ['src/components/layout/FieldDrawer.tsx', 'src/components/dashboard/TidePanel.tsx', 'src/components/map/AlertPanel.tsx']) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/text-\[(8|9|10|11|12)px\]|text-xs|badge-beta/);
    }
  });
});
