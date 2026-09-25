/**
 * MobileBottomNav tests.
 *
 * On a phone the forecast overlay (z-50) covers everything except this bar,
 * so every tab other than Previsión must close it or the tap does nothing
 * visible. The tests also pin the ARIA state (aria-current follows the
 * highlighted tab, aria-expanded follows the "Más" menu) and check that
 * Escape closes the "Más" menu.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MobileBottomNav } from './MobileBottomNav';
import { useUIStore } from '../../store/uiStore';

const tab = (name: string) => screen.getByRole('button', { name });

describe('MobileBottomNav', () => {
  beforeEach(() => {
    useUIStore.setState({
      isMobile: true,
      forecastPanelOpen: false,
      forecastPanelSpotId: null,
      sidebarOpen: false,
      fieldDrawerOpen: false,
      activeBottomTab: 'map',
      simpleMode: false,
      guideOpen: false,
      feedbackOpen: false,
    });
  });

  describe('with the forecast overlay open', () => {
    beforeEach(() => {
      useUIStore.setState({ forecastPanelOpen: true, activeBottomTab: 'prevision' });
    });

    it('Mapa closes the forecast and becomes the current page', () => {
      render(<MobileBottomNav />);
      fireEvent.click(tab('Mapa'));

      const s = useUIStore.getState();
      expect(s.forecastPanelOpen).toBe(false);
      expect(s.activeBottomTab).toBe('map');
      expect(tab('Mapa')).toHaveAttribute('aria-current', 'page');
      expect(tab('Previsión')).not.toHaveAttribute('aria-current');
      // The Simple/Avanzado toggle is an action, never a page.
      expect(tab('Pasar a modo simple')).not.toHaveAttribute('aria-current');
    });

    it('Spots closes the forecast so the sidebar does not open underneath it', () => {
      render(<MobileBottomNav />);
      fireEvent.click(tab('Spots'));

      const s = useUIStore.getState();
      expect(s.forecastPanelOpen).toBe(false);
      expect(s.sidebarOpen).toBe(true);
      expect(tab('Spots')).toHaveAttribute('aria-current', 'page');
    });

    it('Más stays highlighted while its menu is open, even after the tab is synced to the map', () => {
      render(<MobileBottomNav />);
      fireEvent.click(tab('Más'));
      expect(useUIStore.getState().forecastPanelOpen).toBe(false);

      // AppShell rewrites activeBottomTab to 'map' once the forecast closes
      // with no other panel open. Replay that write: the open menu must win.
      act(() => useUIStore.getState().setActiveBottomTab('map'));
      expect(tab('Más')).toHaveAttribute('aria-current', 'page');
      expect(tab('Más')).toHaveAttribute('aria-expanded', 'true');
      expect(tab('Mapa')).not.toHaveAttribute('aria-current');

      // Closing the menu hands the highlight back to what is on screen.
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(tab('Mapa')).toHaveAttribute('aria-current', 'page');
      expect(tab('Más')).not.toHaveAttribute('aria-current');
    });
  });

  it('Previsión opens the forecast and is the current page', () => {
    render(<MobileBottomNav />);
    fireEvent.click(tab('Previsión'));

    expect(useUIStore.getState().forecastPanelOpen).toBe(true);
    expect(tab('Previsión')).toHaveAttribute('aria-current', 'page');
    expect(tab('Mapa')).not.toHaveAttribute('aria-current');
  });

  describe('"Más" menu', () => {
    it('Escape closes the menu', () => {
      render(<MobileBottomNav />);
      fireEvent.click(tab('Más'));
      expect(screen.getByText('Guía MeteoMapGal')).toBeInTheDocument();

      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(screen.queryByText('Guía MeteoMapGal')).toBeNull();
      expect(tab('Más')).toHaveAttribute('aria-expanded', 'false');
    });

    it('the Más button closes the menu it opened (keyboard users cannot reach the backdrop)', () => {
      render(<MobileBottomNav />);
      fireEvent.click(tab('Más'));
      fireEvent.click(tab('Más'));
      expect(screen.queryByText('Guía MeteoMapGal')).toBeNull();
    });

    it('closing the menu without choosing leaves the view underneath as the current page', () => {
      useUIStore.setState({ sidebarOpen: true, activeBottomTab: 'spots' });
      render(<MobileBottomNav />);
      fireEvent.click(tab('Más'));
      fireEvent.keyDown(document.body, { key: 'Escape' });

      expect(tab('Spots')).toHaveAttribute('aria-current', 'page');
      expect(tab('Más')).not.toHaveAttribute('aria-current');
    });
  });
});
