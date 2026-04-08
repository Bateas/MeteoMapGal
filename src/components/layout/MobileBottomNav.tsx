/**
 * MobileBottomNav — persistent bottom navigation bar for mobile.
 * Replaces hamburger menu with direct tab access.
 * Desktop: never rendered (gated by isMobile in AppShell).
 */
import { memo, useState, useCallback } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useSectorStore } from '../../store/sectorStore';
import { WeatherIcon } from '../icons/WeatherIcons';
import type { IconId } from '../icons/WeatherIcons';

type BottomTab = 'map' | 'spots' | 'datos' | 'prevision' | 'mas';

const TABS: { id: BottomTab; label: string; icon: IconId }[] = [
  { id: 'map', label: 'Mapa', icon: 'map' },
  { id: 'spots', label: 'Spots', icon: 'map-pin' },
  { id: 'datos', label: 'Datos', icon: 'activity' },
  { id: 'prevision', label: 'Previsión', icon: 'cloud-sun' },
  { id: 'mas', label: 'Más', icon: 'layers' },
];

// ── "Más" menu items ────────────────────────────────────

interface MenuItem {
  icon: IconId;
  label: string;
  tab?: string;          // sidebar tab to open
  action?: () => void;   // custom action instead of sidebar tab
  embalseOnly?: boolean;
  highlight?: string;    // text color class for prominent items
}

function MobileBottomNavInner() {
  const activeTab = useUIStore((s) => s.activeBottomTab) ?? 'map';
  const setActiveTab = useUIStore((s) => s.setActiveBottomTab);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const setFieldDrawerOpen = useUIStore((s) => s.setFieldDrawerOpen);
  const setRequestedTab = useUIStore((s) => s.setRequestedTab);
  const setForecastPanelOpen = useUIStore((s) => s.setForecastPanelOpen);
  const toggleGuide = useUIStore((s) => s.toggleGuide);
  const setFeedbackOpen = useUIStore((s) => s.setFeedbackOpen);
  const sectorId = useSectorStore((s) => s.activeSector.id);

  const [moreOpen, setMoreOpen] = useState(false);

  const openSidebarTab = useCallback((tab: string, navTab: BottomTab) => {
    setRequestedTab(tab);
    setSidebarOpen(true);
    setFieldDrawerOpen(false);
    setActiveTab(navTab);
    setMoreOpen(false);
  }, [setRequestedTab, setSidebarOpen, setFieldDrawerOpen, setActiveTab]);

  const handleTab = useCallback((id: BottomTab) => {
    setMoreOpen(false);

    if (id === 'map') {
      // Close all panels — return to map
      setSidebarOpen(false);
      setFieldDrawerOpen(false);
      setActiveTab('map');
      return;
    }

    if (id === 'spots') {
      openSidebarTab('stations', 'spots');
      return;
    }

    if (id === 'datos') {
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
      setMoreOpen((o) => !o);
      setActiveTab('mas');
      return;
    }
  }, [setSidebarOpen, setFieldDrawerOpen, setActiveTab, openSidebarTab, setForecastPanelOpen]);

  const menuItems: MenuItem[] = [
    { icon: 'book-open', label: 'Guía MeteoMapGal', action: () => { toggleGuide(); setMoreOpen(false); }, highlight: 'text-sky-400' },
    { icon: 'message-square', label: 'Enviar Feedback', action: () => { setFeedbackOpen(true); setMoreOpen(false); }, highlight: 'text-emerald-400' },
    { icon: 'activity', label: 'Gráfica', tab: 'chart' },
    { icon: 'compass', label: 'Comparar', tab: 'compare' },
    { icon: 'layers', label: 'Rankings', tab: 'rankings' },
    { icon: 'clock', label: 'Historial', tab: 'history' },
    { icon: 'flame', label: 'Térmico', tab: 'thermal', embalseOnly: true },
  ];

  return (
    <>
      {/* "More" menu popover */}
      {moreOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-[44]"
            onClick={() => setMoreOpen(false)}
          />
          {/* Menu panel */}
          <div
            className="fixed z-[45] right-2 w-52 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-1.5 animate-fade-in-up"
            style={{ bottom: 'calc(48px + env(safe-area-inset-bottom, 0px) + 4px)' }}
          >
            {menuItems
              .filter((item) => !item.embalseOnly || sectorId === 'embalse')
              .map((item) => (
                <button
                  key={item.label}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-800 transition-colors text-left min-h-[40px] ${item.highlight ?? 'text-slate-300 hover:text-white'}`}
                  onClick={() => {
                    if (item.action) {
                      item.action();
                    } else if (item.tab) {
                      openSidebarTab(item.tab, 'mas');
                    }
                  }}
                >
                  <WeatherIcon id={item.icon} size={16} className="text-slate-400 shrink-0" />
                  <span className="text-[13px] font-medium">{item.label}</span>
                </button>
              ))}
            {/* Donation link */}
            <a
              href="https://ko-fi.com/bateas"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-emerald-400 hover:bg-emerald-500/10 transition-colors min-h-[40px]"
            >
              <WeatherIcon id="anchor" size={16} className="shrink-0" />
              <span className="text-[13px] font-medium">Apoyar</span>
            </a>
          </div>
        </>
      )}

      {/* Bottom nav bar */}
      <nav
        className="fixed bottom-0 inset-x-0 z-40 bg-slate-900 border-t border-slate-700/50"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="flex items-stretch justify-around">
          {TABS.map(({ id, label, icon }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[48px] pt-1.5 pb-1 transition-colors ${
                  isActive ? 'text-sky-400' : 'text-slate-400'
                }`}
                onClick={() => handleTab(id)}
                aria-label={label}
              >
                <WeatherIcon id={icon} size={20} />
                <span className="text-[10px] font-medium leading-none">{label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}

export const MobileBottomNav = memo(MobileBottomNavInner);
