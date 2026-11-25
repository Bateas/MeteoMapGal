/**
 * Sidebar tab widget wiring — the selected tab must point at a real panel.
 *
 * Every tab button declared aria-controls="tabpanel-<name>", but no element
 * carried those ids, so a screen reader following the selected tab to its
 * panel found nothing. The lazy panels are stubbed: the test is about the
 * tablist/tabpanel contract, and loading recharts & co. in jsdom only adds
 * noise (and unhandled errors after the test when the 1.5 s prefetch fires).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../dashboard/StationTable', () => ({ StationTable: () => null }));
vi.mock('../charts/ForecastTimeline', () => ({ ForecastTimeline: () => null }));
vi.mock('../dashboard/HistoryDashboard', () => ({ HistoryDashboard: () => null }));
vi.mock('../dashboard/BuoyPanel', () => ({ BuoyPanel: () => null }));
vi.mock('../dashboard/SpotSelector', () => ({ SpotSelector: () => null }));

import { Sidebar } from './Sidebar';
import { useUIStore } from '../../store/uiStore';
import { useSectorStore } from '../../store/sectorStore';
import { SECTORS } from '../../config/sectors';

function expectSelectedTabWired() {
  const tab = screen.getByRole('tab', { selected: true });
  const panelId = tab.getAttribute('aria-controls');
  expect(panelId).toBeTruthy();
  const panel = document.getElementById(panelId!);
  expect(panel).not.toBeNull();
  expect(panel!.getAttribute('role')).toBe('tabpanel');
  // The panel is named by its tab, so it is announced as "Previsión", etc.
  expect(panel!.getAttribute('aria-labelledby')).toBe(tab.id);
  expect(screen.getByRole('tabpanel')).toHaveAccessibleName(tab.textContent!.trim());
}

beforeEach(() => {
  // Advanced mode: every one of the 4 tabs is rendered.
  useUIStore.setState({ simpleMode: false, requestedTab: null, isMobile: false });
  useSectorStore.setState({ activeSector: SECTORS.find((s) => s.id === 'embalse')! } as never);
});

describe('Sidebar tabs', () => {
  it('the default selected tab controls an existing tabpanel', () => {
    render(<Sidebar />);
    expectSelectedTabWired();
  });

  it('every tab, once selected, controls an existing tabpanel', () => {
    render(<Sidebar />);
    const names = screen.getAllByRole('tab').map((t) => t.textContent!.trim());
    expect(names).toEqual(['Spots', 'Estaciones', 'Previsión', 'Historial']);
    for (const name of names) {
      fireEvent.click(screen.getByRole('tab', { name }));
      expect(screen.getByRole('tab', { selected: true }).textContent!.trim()).toBe(name);
      expectSelectedTabWired();
    }
  });

  it('the tabs are the same in both sectors', () => {
    useSectorStore.setState({ activeSector: SECTORS.find((s) => s.id === 'rias')! } as never);
    render(<Sidebar />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent!.trim())).toEqual(['Spots', 'Estaciones', 'Previsión', 'Historial']);
  });

  it('simple mode keeps only Previsión: the spots are already on the map', () => {
    useUIStore.setState({ simpleMode: true });
    render(<Sidebar />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent!.trim())).toEqual(['Previsión']);
  });
});
