import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SpotCard, widgetSpots } from './WidgetApp';
import { RIAS_SPOTS } from '../config/spots';
import type { SpotScore } from '../services/spotScoringEngine';

const cesantes = RIAS_SPOTS.find((s) => s.id === 'cesantes')!;

const score = (over: Partial<SpotScore>): SpotScore => ({
  spotId: 'cesantes', spotName: 'Cesantes', verdict: 'good', score: 70, summary: 'Buen viento del SW',
  wind: { avgSpeedKt: 9, dirDeg: 230, dominantDir: 'SW', dirSteadiness: 0.9, stationCount: 4 } as SpotScore['wind'],
  waves: null, waterTemp: 19.4, airTemp: 24, humidity: 60, windChill: null, heatIndex: null,
  windDirDeg: 230, hardGateTriggered: null, thermal: null, hasStormAlert: false, thermalBoosted: false,
  effectiveWindKt: 13, scoringConfidence: 'high', provisional: false, windTrend: null, gustKt: 15,
  dewPoint: null, humiditySignal: null, thetaVGradient: null, computedAt: new Date(),
  ...over,
} as SpotScore);

describe('widget spot card', () => {
  it('shows the wind the map shows, not a dash', () => {
    // It read fields that do not exist and printed "—" for every spot.
    render(<SpotCard spot={cesantes} score={score({})} />);
    expect(screen.getByText('13 kt')).toBeTruthy();       // the calibrated figure, as in the popup
    expect(screen.getByText('Buen día')).toBeTruthy();
    expect(screen.getByText('SW')).toBeTruthy();
    expect(screen.getByText('15 kt')).toBeTruthy();       // gust
  });

  it('says the direction is variable when the sources disagree', () => {
    render(<SpotCard spot={cesantes} score={score({ wind: { avgSpeedKt: 9, dirDeg: 230, dominantDir: 'SW', dirSteadiness: 0.3, stationCount: 4 } as SpotScore['wind'] })} />);
    expect(screen.getByText('variable')).toBeTruthy();
    expect(screen.queryByText('SW')).toBeNull();
  });

  it('says it is still calculating instead of a firm number while the score is provisional', () => {
    render(<SpotCard spot={cesantes} score={score({ provisional: true })} />);
    expect(screen.getByText('Calculando…')).toBeTruthy();
    expect(screen.queryByText('13 kt')).toBeNull();
    expect(screen.queryByText('Buen viento del SW')).toBeNull();
  });
});

describe('widgetSpots', () => {
  it('leaves out surf spots, which the app judges by the waves and not the wind', () => {
    expect(widgetSpots(null, 'rias').some((s) => s.category === 'surf')).toBe(false);
    expect(widgetSpots('surf-patos', 'rias')).toEqual([]);
    expect(widgetSpots('cesantes', 'rias').map((s) => s.id)).toEqual(['cesantes']);
  });
});
