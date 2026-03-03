import { memo, useCallback, useMemo } from 'react';
import { Marker } from 'react-map-gl/maplibre';
import { useThermalStore } from '../../store/thermalStore';
import { ALERT_COLORS } from '../../config/alertColors';

// ── Individual badge (memoized to avoid re-render cascade) ──

interface BadgeProps {
  zoneId: string;
  lon: number;
  lat: number;
  alertLevel: string;
  maxScore: number;
  color: string;
}

const AlertBadge = memo(function AlertBadge({ zoneId, lon, lat, alertLevel, maxScore, color }: BadgeProps) {
  const selectZone = useThermalStore((s) => s.selectZone);

  const handleClick = useCallback((e: { originalEvent: MouseEvent }) => {
    e.originalEvent.stopPropagation();
    selectZone(zoneId);
  }, [selectZone, zoneId]);

  return (
    <Marker
      longitude={lon}
      latitude={lat}
      anchor="center"
      onClick={handleClick}
    >
      <div
        className={`flex items-center gap-1 px-2 py-1 rounded-full cursor-pointer shadow-lg ${
          alertLevel === 'high' ? 'animate-pulse' : ''
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
          {maxScore}%
        </span>
      </div>
    </Marker>
  );
});

// ── Container ──────────────────────────────────────────────

export function ThermalAlertMarkers() {
  const zones = useThermalStore((s) => s.zones);
  const zoneAlerts = useThermalStore((s) => s.zoneAlerts);
  const showZoneOverlays = useThermalStore((s) => s.showZoneOverlays);

  // Pre-compute visible alerts to avoid work inside JSX
  const visibleAlerts = useMemo(() => {
    if (!showZoneOverlays) return [];
    const result: BadgeProps[] = [];
    for (const zone of zones) {
      const alert = zoneAlerts.get(zone.id);
      if (!alert || alert.alertLevel === 'none') continue;
      result.push({
        zoneId: zone.id,
        lon: zone.center.lon,
        lat: zone.center.lat,
        alertLevel: alert.alertLevel,
        maxScore: alert.maxScore,
        color: ALERT_COLORS[alert.alertLevel],
      });
    }
    return result;
  }, [zones, zoneAlerts, showZoneOverlays]);

  if (visibleAlerts.length === 0) return null;

  return (
    <>
      {visibleAlerts.map((props) => (
        <AlertBadge key={props.zoneId} {...props} />
      ))}
    </>
  );
}
