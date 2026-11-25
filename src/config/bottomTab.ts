/** The tab the bottom bar marks for what is really on screen. The tab drives aria-current. */
export type BottomTabId = 'map' | 'spots' | 'datos' | 'prevision' | 'mas';

/**
 * The full-screen forecast covers everything; then Condiciones (opened from the strip over the map or by the
 * welcome: before, the bar kept «Mapa», review 18-nov); with nothing open, the map; the side panel opened
 * from outside the bar (the spot pill) marks «Spots». Otherwise the tab stays as it is (null).
 */
export function bottomTabFor(s: { forecastPanelOpen: boolean; fieldDrawerOpen: boolean; sidebarOpen: boolean; current: BottomTabId | null }): BottomTabId | null {
  if (s.forecastPanelOpen) return 'prevision';
  if (s.fieldDrawerOpen) return 'datos';
  if (!s.sidebarOpen) return 'map';
  if (s.current === 'map') return 'spots';
  return null;
}
