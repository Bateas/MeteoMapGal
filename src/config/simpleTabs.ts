/**
 * simpleTabs — single source of truth for the side panel's tabs: their names and icons, and
 * which ones stay in simple mode ("lo más limpio posible para no abrumar").
 *
 * Consumed by Sidebar (tab bar + fallback), the collapsed panel (AppShell) and MobileBottomNav
 * ("Más" menu) so all three always offer exactly the same tabs under the same names. Without a
 * shared source, the bottom nav could request a tab the Sidebar refuses to show (silent bounce
 * back to the first tab).
 */
import type { IconId } from '../components/icons/WeatherIcons';

export type SidebarTab = 'spots' | 'stations' | 'forecast' | 'history';

export interface SidebarTabInfo {
  id: SidebarTab;
  label: string;
  icon: IconId;
}

export const SIDEBAR_TABS: readonly SidebarTabInfo[] = [
  { id: 'spots', label: 'Spots', icon: 'map-pin' },
  { id: 'stations', label: 'Estaciones', icon: 'wind' },
  { id: 'forecast', label: 'Previsión', icon: 'cloud-sun' },
  { id: 'history', label: 'Historial', icon: 'clock' },
];

// Tabs visible in simpleMode. Only the forecast: whoever comes in simple wants the map and what is
// coming, and the spots are already on the map (11-nov). The list of spots is one tap away
// under «Avanzado».
export const SIMPLE_TABS: ReadonlySet<SidebarTab> = new Set<SidebarTab>([
  'forecast',
]);

/** The tab the panel falls back to when the mode hides the one that was open. */
export function fallbackTab(simpleMode: boolean): SidebarTab {
  return simpleMode ? 'forecast' : 'spots';
}

/** The tabs on offer right now, in order. */
export function visibleSidebarTabs(simpleMode: boolean): SidebarTabInfo[] {
  return SIDEBAR_TABS.filter((t) => !simpleMode || SIMPLE_TABS.has(t.id));
}
