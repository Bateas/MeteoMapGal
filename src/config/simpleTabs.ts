/**
 * simpleTabs — single source of truth for which sidebar tabs remain
 * visible in simpleMode ("lo más limpio posible para no abrumar").
 *
 * Consumed by Sidebar (tab bar + fallback) and MobileBottomNav ("Más" menu)
 * so both surfaces always offer exactly the same tabs. Without a shared
 * source, the bottom nav could request a tab the Sidebar refuses to show
 * (silent bounce back to 'stations').
 */

export type SidebarTab =
  | 'stations'
  | 'chart'
  | 'compare'
  | 'forecast'
  | 'thermal'
  | 'history'
  | 'rankings';

// Tabs visible in simpleMode. Other tabs are hidden to reduce overwhelm.
// Keep only Estaciones + Previsión (+ Térmico in Embalse via isEmbalse gate).
// If the active tab is not in this set when simpleMode toggles ON,
// Sidebar falls back to 'stations'.
export const SIMPLE_TABS: ReadonlySet<SidebarTab> = new Set<SidebarTab>([
  'stations',
  'forecast',
  'thermal',
]);

/** True if the given tab id stays available while simpleMode is active. */
export function isSimpleTab(tab: string): boolean {
  return (SIMPLE_TABS as ReadonlySet<string>).has(tab);
}
