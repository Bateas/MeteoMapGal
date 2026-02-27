import { Marker } from 'react-map-gl/maplibre';
import { useThermalStore } from '../../store/thermalStore';
import { ALERT_COLORS } from '../../config/alertColors';

export function ThermalAlertMarkers() {
  const zones = useThermalStore((s) => s.zones);
  const zoneAlerts = useThermalStore((s) => s.zoneAlerts);
  const showZoneOverlays = useThermalStore((s) => s.showZoneOverlays);
  const selectZone = useThermalStore((s) => s.selectZone);

  if (!showZoneOverlays) return null;

  return (
    <>
      {zones.map((zone) => {
        const alert = zoneAlerts.get(zone.id);
        if (!alert || alert.alertLevel === 'none') return null;

        const color = ALERT_COLORS[alert.alertLevel];

        return (
          <Marker
            key={zone.id}
            longitude={zone.center.lon}
            latitude={zone.center.lat}
            anchor="center"
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              selectZone(zone.id);
            }}
          >
            <div
              className={`flex items-center gap-1 px-2 py-1 rounded-full cursor-pointer shadow-lg ${
                alert.alertLevel === 'high' ? 'animate-pulse' : ''
              }`}
              style={{
                background: `${color}20`,
                border: `1.5px solid ${color}60`,
                backdropFilter: 'blur(4px)',
              }}
            >
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: color }}
              />
              <span
                className="text-[10px] font-bold font-mono"
                style={{ color }}
              >
                {alert.maxScore}%
              </span>
            </div>
          </Marker>
        );
      })}
    </>
  );
}
