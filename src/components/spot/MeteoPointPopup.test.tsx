import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MeteoPointPopup } from './MeteoPointPopup';
import { METEO_POINTS, withMeteoPoints, isInGalicia, type UserSpot } from '../../config/userSpots';
import { SECTORS } from '../../config/sectors';
import { useUserSpotStore } from '../../store/userSpotStore';
import { useUIStore } from '../../store/uiStore';

vi.mock('react-map-gl/maplibre', () => ({
  Popup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useMap: () => ({ current: null }),
}));
vi.mock('./PointForecast', () => ({ PointForecast: () => <div>previsión del punto</div> }));

const point = METEO_POINTS[0];

describe('MeteoPointPopup', () => {
  beforeEach(() => useUserSpotStore.setState({ scores: new Map() } as never));

  it('shows the forecast and BETA, and nothing about sailing or editing', () => {
    render(<MeteoPointPopup spot={point} />);
    expect(screen.getByText('previsión del punto')).toBeTruthy();
    expect(screen.getByText('BETA')).toBeTruthy();
    expect(screen.queryByText(/sin calibrar/i)).toBeNull();
    expect(screen.queryByText('Eliminar')).toBeNull();
    expect(screen.queryByText(/Sugerir/)).toBeNull();
  });

  it('is a bottom sheet on a phone', () => {
    useUIStore.setState({ isMobile: true } as never);
    render(<MeteoPointPopup spot={point} />);
    expect(screen.getByRole('dialog', { name: point.name })).toBeTruthy();
    expect(screen.getByLabelText('Cerrar')).toBeTruthy();
    useUIStore.setState({ isMobile: false } as never);
  });

  it('names the nearest station only when there is one', () => {
    const { unmount } = render(<MeteoPointPopup spot={point} />);
    expect(screen.queryByText(/Ahora en/)).toBeNull();
    unmount();
    useUserSpotStore.setState({
      scores: new Map([[point.id, { wind: { contributions: [
        { name: 'Estación Lejos', speedKt: 20, dir: 'N', distKm: 7 },
        { name: 'Estación A', speedKt: 7.2, dir: 'E', distKm: 3.5 },
      ] } }]]),
    } as never);
    render(<MeteoPointPopup spot={point} />);
    expect(screen.getByText('Ahora en Estación A (3,5 km): 7 kt E')).toBeTruthy();
  });
});

describe('METEO_POINTS', () => {
  const pin: UserSpot = { id: 'user-1', name: 'Mi spot 1', center: [-8.1, 42.3], sectorId: 'embalse', createdAt: 1 };

  it('are valid weather points in a sector that exists', () => {
    for (const p of METEO_POINTS) {
      expect(p.meteoOnly).toBe(true);
      expect(isInGalicia(p.center[0], p.center[1])).toBe(true);
      expect(SECTORS.some((s) => s.id === p.sectorId)).toBe(true);
    }
  });

  it('come before the pins and leave the list untouched', () => {
    const mine = [pin];
    expect(withMeteoPoints(mine).map((s) => s.id)).toEqual([...METEO_POINTS.map((s) => s.id), 'user-1']);
    expect(mine).toEqual([pin]);
  });
});
