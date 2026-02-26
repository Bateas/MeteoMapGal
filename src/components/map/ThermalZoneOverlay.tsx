import { useMemo, memo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { useShallow } from 'zustand/react/shallow';
import { useThermalStore } from '../../store/thermalStore';
import type { AlertLevel } from '../../types/thermal';

const ALERT_OPACITIES: Record<AlertLevel, number> = {
  none: 0.03,
  low: 0.08,
  medium: 0.18,
  high: 0.30,
};

export const ThermalZoneOverlay = memo(function ThermalZoneOverlay() {
  const { zones, zoneAlerts, showZoneOverlays } = useThermalStore(
    useShallow((s) => ({
      zones: s.zones,
      zoneAlerts: s.zoneAlerts,
      showZoneOverlays: s.showZoneOverlays,
    }))
  );

  const geojson = useMemo(() => {
    const features = zones.map((zone) => {
      const alert = zoneAlerts.get(zone.id);
      const alertLevel = alert?.alertLevel || 'none';
      const score = alert?.maxScore || 0;

      return {
        type: 'Feature' as const,
        properties: {
          id: zone.id,
          name: zone.name,
          color: zone.color,
          alertLevel,
          score,
          fillOpacity: ALERT_OPACITIES[alertLevel],
        },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            // Close the polygon
            [...zone.polygon, zone.polygon[0]],
          ],
        },
      };
    });

    return {
      type: 'FeatureCollection' as const,
      features,
    };
  }, [zones, zoneAlerts]);

  if (!showZoneOverlays) return null;

  return (
    <Source id="thermal-zones" type="geojson" data={geojson}>
      {/* Fill */}
      <Layer
        id="thermal-zones-fill"
        type="fill"
        paint={{
          'fill-color': ['get', 'color'],
          'fill-opacity': ['get', 'fillOpacity'],
        }}
      />
      {/* Border */}
      <Layer
        id="thermal-zones-border"
        type="line"
        paint={{
          'line-color': ['get', 'color'],
          'line-width': 1.5,
          'line-opacity': 0.4,
          'line-dasharray': [4, 2],
        }}
      />
    </Source>
  );
});
