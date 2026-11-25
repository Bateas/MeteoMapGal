/**
 * MobileBottomNav — persistent bottom navigation bar for mobile.
 * Replaces hamburger menu with direct tab access.
 * Desktop: never rendered (gated by isMobile in AppShell).
 */
import { memo, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useUIStore } from '../../store/uiStore';
import { WeatherIcon } from '../icons/WeatherIcons';
import type { IconId } from '../icons/WeatherIcons';
import { visibleSidebarTabs } from '../../config/simpleTabs';
import { useBackCloses } from '../../hooks/useBackCloses';
import { CONDITIONS_LEVEL_WORD } from '../../config/levelWords';

// 'datos' is the Condiciones panel. The Simple/Avanzado switch lives in the "Más" menu.
type BottomTab = 'map' | 'spots' | 'prevision' | 'datos' | 'mas';

const MENU_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" />
  </svg>
);

function MobileBottomNavInner({ fieldAlertLevel = 'none' }: { fieldAlertLevel?: 'none' | 'riesgo' | 'moderado' | 'alto' | 'critico' }) {
  const activeTab = useUIStore((s) => s.activeBottomTab) ?? 'map';
  const setActiveTab = useUIStore((s) => s.setActiveBottomTab);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const setFieldDrawerOpen = useUIStore((s) => s.setFieldDrawerOpen);
  const setRequestedTab = useUIStore((s) => s.setRequestedTab);
  const setForecastPanelOpen = useUIStore((s) => s.setForecastPanelOpen);
  const toggleGuide = useUIStore((s) => s.toggleGuide);
  const setFeedbackOpen = useUIStore((s) => s.setFeedbackOpen);
  const simpleMode = useUIStore((s) => s.simpleMode);
  const toggleSimpleMode = useUIStore((s) => s.toggleSimpleMode);

  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLElement>(null);

  useBackCloses(moreOpen, () => setMoreOpen(false), 'menu');

  // Escape closes the "Más" menu, same as tapping its backdrop, and puts the focus back on the
  // button that opened it. The items that open a modal (Guía, Opinión) close the menu first, so
  // this never takes the Escape that belongs to a dialog.
  useEffect(() => {
    if (!moreOpen) return;
    menuRef.current?.querySelector<HTMLElement>('button, a')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMoreOpen(false);
      moreButtonRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  // Highlighted tab. The open "Más" menu wins: it is an overlay, not a view, so
  // it is kept out of activeBottomTab. That value says what is on screen and
  // AppShell rewrites it whenever panels open or close (to 'map' when tapping
  // Más closes the forecast), which would otherwise move the highlight to Mapa
  // with the menu still open. Closing the menu hands it back to the real view.
  const currentTab: BottomTab = moreOpen ? 'mas' : activeTab;

  // Primary bottom nav entries.
  const TABS: { id: BottomTab; label: string; icon: IconId | ReactNode }[] = [
    { id: 'map', label: 'Mapa', icon: 'map' },
    // Simple mode: no list of spots, they are on the map (same rule as the side panel, simpleTabs.ts)
    ...(simpleMode ? [] : [{ id: 'spots' as BottomTab, label: 'Spots', icon: 'map-pin' as IconId }]),
    { id: 'prevision', label: 'Previsión', icon: 'cloud-sun' },
    { id: 'datos', label: 'Condiciones', icon: 'activity' },
    { id: 'mas', label: 'Más', icon: MENU_ICON },
  ];

  const openSidebarTab = useCallback((tab: string, navTab: BottomTab) => {
    setRequestedTab(tab);
    setSidebarOpen(true);
    setFieldDrawerOpen(false);
    setActiveTab(navTab);
    setMoreOpen(false);
  }, [setRequestedTab, setSidebarOpen, setFieldDrawerOpen, setActiveTab]);

  const handleTab = useCallback((id: BottomTab) => {
    setMoreOpen(false);

    // The forecast overlay (z-50) covers everything except this bar: the
    // sidebar (z-40), the FieldDrawer and the "Más" menu (z-[45]) all open
    // UNDER it. Any destination other than Previsión closes it first, or the
    // tap looks dead.
    if (id !== 'prevision') setForecastPanelOpen(false);

    if (id === 'map') {
      // Close all panels — return to map
      setSidebarOpen(false);
      setFieldDrawerOpen(false);
      setActiveTab('map');
      return;
    }

    if (id === 'spots') {
      openSidebarTab('spots', 'spots');
      return;
    }

    if (id === 'datos') {
      setSidebarOpen(false);
      setFieldDrawerOpen(true);
      setActiveTab('datos');
      return;
    }

    if (id === 'prevision') {
      // Open fullscreen forecast panel instead of sidebar
      setForecastPanelOpen(true);
      setActiveTab('prevision');
      return;
    }

    if (id === 'mas') {
      // Toggle from the rendered value: the setMoreOpen(false) above is already
      // queued, so an updater (o => !o) always reopened the menu and a keyboard
      // user (who cannot reach the backdrop) could not close it from here.
      // No setActiveTab('mas'): the highlight comes from moreOpen (currentTab).
      setMoreOpen(!moreOpen);
      return;
    }
  }, [setSidebarOpen, setFieldDrawerOpen, setActiveTab, openSidebarTab, setForecastPanelOpen, moreOpen]);

  // Spots and Previsión have their own place on the bar. The rest of the panel's tabs, under the
  // same names as on a desktop, and only those the panel shows right now (no silent bounce).
  const panelTabs = visibleSidebarTabs(simpleMode)
    .filter((t) => t.id !== 'spots' && t.id !== 'forecast');

  return (
    <>
      {moreOpen && (
        <>
          <div className="fixed inset-0 z-[44]" onClick={() => setMoreOpen(false)} />
          <nav
            ref={menuRef}
            aria-label="Más opciones"
            className="g-theme gc-menu"
            style={{ bottom: 'calc(50px + env(safe-area-inset-bottom, 0px) + 4px)' }}
          >
            {panelTabs.map((t) => (
              <button key={t.id} type="button" className="gc-option" onClick={() => openSidebarTab(t.id, 'mas')}>
                <WeatherIcon id={t.icon} size={18} />
                <span>{t.label}</span>
              </button>
            ))}
            {panelTabs.length > 0 && <div className="gc-menu-rule" />}
            {/* An action, not a place: its label says where it takes you. */}
            <button
              type="button"
              className="gc-option"
              aria-label={simpleMode ? 'Pasar a modo avanzado' : 'Pasar a modo simple'}
              onClick={() => { toggleSimpleMode(); setMoreOpen(false); }}
            >
              <WeatherIcon id={simpleMode ? 'eye' : 'eye-off'} size={18} />
              <span>{simpleMode ? 'Avanzado' : 'Simple'}</span>
            </button>
            <button type="button" className="gc-option" onClick={() => { toggleGuide(); setMoreOpen(false); }}>
              <WeatherIcon id="book-open" size={18} />
              <span>Guía</span>
            </button>
            <button type="button" className="gc-option" onClick={() => { setFeedbackOpen(true); setMoreOpen(false); }}>
              <WeatherIcon id="message-square" size={18} />
              <span>Opinión</span>
            </button>
            <a href="https://ko-fi.com/bateas" target="_blank" rel="noopener noreferrer" className="gc-option">
              <WeatherIcon id="anchor" size={18} />
              <span>Apoyar el proyecto</span>
            </a>
          </nav>
        </>
      )}

      <nav className="g-theme gc-bottomnav" aria-label="Navegación principal">
        {TABS.map(({ id, label, icon }) => {
          // Each one is a place, marked while it is on screen.
          const isActive = currentTab === id;
          return (
            <button
              key={id}
              ref={id === 'mas' ? moreButtonRef : undefined}
              type="button"
              data-tour={id === 'spots' ? 'sidebar' : id === 'datos' ? 'panel' : id === 'mas' ? 'guide simple-toggle' : undefined}
              className={simpleMode && id === 'prevision' ? 'gc-navitem gc-navitem--lead' : 'gc-navitem'}
              onClick={() => handleTab(id)}
              // The dot says the level by colour only: the name says it in words, like the header
              aria-label={id === 'datos' && fieldAlertLevel !== 'none' ? `${label}.${CONDITIONS_LEVEL_WORD[fieldAlertLevel]}` : label}
              // Same rule as the highlight, so a screen reader hears what is shown.
              aria-current={isActive ? 'page' : undefined}
              aria-expanded={id === 'mas' ? moreOpen : undefined}
            >
              <span style={{ position: 'relative', display: 'flex' }}>
                {typeof icon === 'string' ? <WeatherIcon id={icon as IconId} size={20} /> : icon}
                {/* The level AppShell passes for the Condiciones panel: what lights it is decided there, not here */}
                {id === 'datos' && fieldAlertLevel !== 'none' && <span className={`gc-dot gc-t-${fieldAlertLevel}`} style={{ position: 'absolute', top: -2, right: -5 }} />}
              </span>
              <span>{label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}

export const MobileBottomNav = memo(MobileBottomNavInner);
