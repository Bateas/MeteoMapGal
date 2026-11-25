import { describe, it, expect } from 'vitest';
import { bottomTabFor } from './bottomTab';

const base = { forecastPanelOpen: false, fieldDrawerOpen: false, sidebarOpen: false, current: 'map' as const };

describe('the tab the bottom bar marks', () => {
  it('Condiciones opened from the strip over the map is marked, not «Mapa» (review, 18-nov)', () => {
    expect(bottomTabFor({ ...base, fieldDrawerOpen: true })).toBe('datos');
  });
  it('the full-screen forecast wins over everything', () => {
    expect(bottomTabFor({ ...base, forecastPanelOpen: true, fieldDrawerOpen: true })).toBe('prevision');
  });
  it('nothing open is the map; the side panel opened from the map is Spots; otherwise it stays', () => {
    expect(bottomTabFor(base)).toBe('map');
    expect(bottomTabFor({ ...base, sidebarOpen: true })).toBe('spots');
    expect(bottomTabFor({ ...base, sidebarOpen: true, current: 'mas' as never })).toBeNull();
  });
});
