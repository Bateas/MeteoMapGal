import { describe, it, expect } from 'vitest';
import { clearAdvancedLayers } from './simpleModeLayers';
import { useWeatherLayerStore } from '../store/weatherLayerStore';
import { useWebcamStore } from '../store/webcamStore';
import { useMapStyleStore } from '../store/mapStyleStore';
import { useTemperatureOverlayStore } from '../store/temperatureOverlayStore';

describe('clearAdvancedLayers', () => {
  it('turns off every layer whose switch simple mode hides, the temperature too, and leaves the base map', () => {
    useWeatherLayerStore.setState({ activeLayer: 'radar' });
    useWebcamStore.setState({ showOverlay: true });
    useMapStyleStore.setState({ activeStyleId: 'ign-topo', showNauticalChart: true, showSwan: true });
    useTemperatureOverlayStore.setState({ showOverlay: true });

    clearAdvancedLayers();
    clearAdvancedLayers();

    expect(useWeatherLayerStore.getState().activeLayer).toBe('none');
    expect(useWebcamStore.getState().showOverlay).toBe(false);
    const map = useMapStyleStore.getState();
    expect([map.showNauticalChart, map.showSwan]).toEqual([false, false]);
    expect(map.activeStyleId).toBe('ign-topo');
    expect(useTemperatureOverlayStore.getState().showOverlay).toBe(false);
  });
});
