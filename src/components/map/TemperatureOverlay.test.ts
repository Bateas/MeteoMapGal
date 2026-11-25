import { describe, it, expect } from 'vitest';
import { buildTemperatureFeatures } from './TemperatureOverlay';
import { temperatureColor } from '../../services/windUtils';

const air = { lat: 42.3, lon: -8.6, temperature: 8.7, altitude: 12, name: 'Cesantes' };

describe('buildTemperatureFeatures', () => {
  it('air: a coloured reading, its name and altitude', () => {
    const [f] = buildTemperatureFeatures([air], []);
    expect(f.properties).toMatchObject({ kind: 'air', label: '8,7°', sublabel: 'Cesantes · 12 m', color: temperatureColor(8.7) });
  });

  it('water: says so in the label itself, not only at zoom 11, and carries no temperature colour', () => {
    const [f] = buildTemperatureFeatures([], [{ stationId: 1250, stationName: 'Cortegada', waterTemp: 13.8 }]);
    expect(f.properties).toMatchObject({ kind: 'water', label: 'agua 13,8°' });
    expect(f.properties?.color).toBeUndefined();
  });

  it('leaves out buoys with no water reading or no known place', () => {
    const features = buildTemperatureFeatures([], [
      { stationId: 1250, stationName: 'Cortegada', waterTemp: null },
      { stationId: 999999, stationName: 'Nadie', waterTemp: 14 },
    ]);
    expect(features).toHaveLength(0);
  });
});
