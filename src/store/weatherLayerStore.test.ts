import { describe, it, expect, beforeEach } from 'vitest';
import { useWeatherLayerStore, MIN_LAYER_OPACITY, DEFAULT_LAYER_OPACITY } from './weatherLayerStore';

describe('weatherLayerStore opacity', () => {
  beforeEach(() => useWeatherLayerStore.setState({ layerOpacity: DEFAULT_LAYER_OPACITY }));

  it('never lets a layer go fully transparent (it looked like a broken radar)', () => {
    useWeatherLayerStore.getState().setLayerOpacity(0);
    expect(useWeatherLayerStore.getState().layerOpacity).toBe(MIN_LAYER_OPACITY);
  });

  it('keeps any value inside the range', () => {
    useWeatherLayerStore.getState().setLayerOpacity(0.4);
    expect(useWeatherLayerStore.getState().layerOpacity).toBe(0.4);
    useWeatherLayerStore.getState().setLayerOpacity(3);
    expect(useWeatherLayerStore.getState().layerOpacity).toBe(1);
  });

  it('a saved zero comes back as the default on load', async () => {
    const options = useWeatherLayerStore.persist.getOptions();
    const migrated = await options.migrate!({ activeLayer: 'radar', layerOpacity: 0 }, 1) as { layerOpacity: number; activeLayer: string };
    expect(migrated.layerOpacity).toBe(DEFAULT_LAYER_OPACITY);
    expect(migrated.activeLayer).toBe('radar');
  });
});
