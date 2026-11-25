/**
 * Simple mode has no layer menu and no layer button at all: it keeps what the map shows by itself (rain,
 * arrows, gauges, fog, lightning). Whatever is on when it starts could not be turned off from there: the
 * radar with its player, the nautical chart, the temperature... and these choices persist, so a visitor
 * came back to them. Going simple turns them off.
 */
import { useWeatherLayerStore } from '../store/weatherLayerStore';
import { useWebcamStore } from '../store/webcamStore';
import { useMapStyleStore } from '../store/mapStyleStore';
import { useTemperatureOverlayStore } from '../store/temperatureOverlayStore';

export function clearAdvancedLayers(): void {
  const layer = useWeatherLayerStore.getState();
  if (layer.activeLayer !== 'none') layer.setActiveLayer('none');

  const webcams = useWebcamStore.getState();
  if (webcams.showOverlay) webcams.toggleOverlay();

  const temperature = useTemperatureOverlayStore.getState();
  if (temperature.showOverlay) temperature.toggleOverlay();

  const map = useMapStyleStore.getState();
  if (map.showNauticalChart) map.toggleNauticalChart();
  if (map.showSwan) map.toggleSwan();
}
