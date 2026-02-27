import { useEffect, memo } from 'react';
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import { useWeatherLayerStore } from '../../store/weatherLayerStore';
import { buildWmsUrl, getWmsImageCoordinates } from '../../api/wrfWmsClient';

/**
 * WRF model raster overlay rendered inside <Map> using MapLibre's
 * native image source + raster layer for GPU-accelerated rendering.
 */
export const WrfOverlay = memo(function WrfOverlay() {
  const { current: mapInstance } = useMap();

  const activeLayer = useWeatherLayerStore((s) => s.activeLayer);
  const opacity = useWeatherLayerStore((s) => s.layerOpacity);
  const wrfVariable = useWeatherLayerStore((s) => s.wrfVariable);
  const wrfTimeIndex = useWeatherLayerStore((s) => s.wrfTimeIndex);
  const wrfAvailableTimes = useWeatherLayerStore((s) => s.wrfAvailableTimes);
  const wrfModelRun = useWeatherLayerStore((s) => s.wrfModelRun);

  const isActive = activeLayer === 'wrf';

  // Build WMS URL when params change
  const wmsUrl = isActive && wrfModelRun && wrfAvailableTimes.length > 0
    ? buildWmsUrl({
        modelRun: wrfModelRun,
        variable: wrfVariable,
        time: wrfAvailableTimes[wrfTimeIndex]?.time ?? new Date(),
      })
    : null;

  // Update the image source URL when WMS params change
  // (MapLibre doesn't support reactive URL changes on image sources via react-map-gl,
  //  so we update the source directly)
  useEffect(() => {
    if (!isActive || !wmsUrl || !mapInstance) return;

    const map = mapInstance.getMap();
    if (!map) return;

    const source = map.getSource('wrf-image') as maplibregl.ImageSource | undefined;
    if (source) {
      source.updateImage({
        url: wmsUrl,
        coordinates: getWmsImageCoordinates(),
      });
    }
  }, [isActive, wmsUrl, mapInstance]);

  if (!isActive || !wmsUrl) return null;

  const coordinates = getWmsImageCoordinates();

  return (
    <>
      <Source
        id="wrf-image"
        type="image"
        url={wmsUrl}
        coordinates={coordinates}
      >
        <Layer
          id="wrf-raster"
          type="raster"
          paint={{
            'raster-opacity': opacity,
            'raster-fade-duration': 300,
          }}
        />
      </Source>
    </>
  );
});
