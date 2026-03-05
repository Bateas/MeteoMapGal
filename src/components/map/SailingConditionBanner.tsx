import { useMemo } from 'react';
import { useWeatherStore } from '../../store/weatherStore';
import { useAlertStore } from '../../store/alertStore';
import { useThermalStore } from '../../store/thermalStore';
import { useUIStore } from '../../store/uiStore';
import { msToKnots } from '../../services/windUtils';
import { WeatherIcon, type IconId } from '../icons/WeatherIcons';

/**
 * Real-time Go/No-go sailing conditions banner on the map.
 * Combines: current wind at key stations, alert severity, and thermal score.
 * Shows a compact verdict that a sailor can glance at.
 */
export function SailingConditionBanner() {
  const stations = useWeatherStore((s) => s.stations);
  const readings = useWeatherStore((s) => s.currentReadings);
  const risk = useAlertStore((s) => s.risk);
  const thermalRules = useThermalStore((s) => s.rules);
  const isMobile = useUIStore((s) => s.isMobile);

  const condition = useMemo(() => {
    if (stations.length === 0 || readings.size === 0) return null;

    // Find best wind station (highest wind in valley stations <300m altitude)
    let bestWindKt = 0;
    let bestWindDir: number | null = null;
    let bestStationName = '';
    let avgHumidity: number | null = null;
    const humidities: number[] = [];

    for (const station of stations) {
      if (station.tempOnly) continue;
      const r = readings.get(station.id);
      if (!r || r.windSpeed === null) continue;

      const kt = msToKnots(r.windSpeed);
      if (r.humidity !== null) humidities.push(r.humidity);

      // Prefer valley stations (< 300m) for sailing relevance
      if (kt > bestWindKt && station.altitude < 400) {
        bestWindKt = kt;
        bestWindDir = r.windDirection;
        bestStationName = station.name;
      }
    }

    if (humidities.length > 0) {
      avgHumidity = humidities.reduce((a, b) => a + b, 0) / humidities.length;
    }

    // Thermal score from rules (if any match)
    const activeRules = thermalRules.filter((r) => r.score > 0);
    const thermalScore = activeRules.length > 0
      ? Math.max(...activeRules.map((r) => r.score))
      : 0;

    // Determine verdict
    // Wind thresholds: <4kt=calma, 4-6kt=light, 6-20kt=GO, 20-25kt=viento fuerte, >25kt=excesivo
    let verdict: 'go' | 'marginal' | 'nogo' | 'calma';
    let label: string;
    let sublabel: string;

    if (risk.severity === 'critical') {
      verdict = 'nogo';
      label = 'PRECAUCIÓN';
      sublabel = risk.activeCount > 0 ? `${risk.activeCount} alertas activas` : 'Condiciones adversas';
    } else if (bestWindKt > 25) {
      verdict = 'nogo';
      label = `${bestWindKt.toFixed(0)} kt`;
      sublabel = 'Viento muy fuerte';
    } else if (bestWindKt >= 20) {
      verdict = 'marginal';
      label = `${bestWindKt.toFixed(0)} kt`;
      sublabel = 'Viento fuerte — precaución';
    } else if (bestWindKt >= 6) {
      verdict = 'go';
      label = `${bestWindKt.toFixed(0)} kt`;
      sublabel = risk.severity === 'high'
        ? bestStationName
        : bestStationName;
    } else if (bestWindKt >= 4 && thermalScore >= 30) {
      verdict = 'marginal';
      label = `${bestWindKt.toFixed(0)} kt`;
      sublabel = `Térmico ${thermalScore}%`;
    } else if (bestWindKt >= 4) {
      // 4-6 kt without thermal: light wind, not alarming
      verdict = 'calma';
      label = `${bestWindKt.toFixed(0)} kt`;
      sublabel = bestStationName;
    } else {
      // < 4 kt: calm conditions
      if (thermalScore >= 50) {
        verdict = 'marginal';
        label = 'Esperar térmico';
        sublabel = `Previsión ${thermalScore}%`;
      } else {
        verdict = 'calma';
        label = 'Sin viento';
        sublabel = avgHumidity != null && avgHumidity > 75
          ? `HR ${avgHumidity.toFixed(0)}%`
          : 'Calma';
      }
    }

    return { verdict, label, sublabel, bestWindKt, bestWindDir };
  }, [stations, readings, risk, thermalRules]);

  // Don't show banner when conditions are good (verdict 'go') —
  // wind data is already visible on station markers, no need to state the obvious.
  // Only show when there's something noteworthy: calma, marginal, or nogo.
  if (!condition || condition.verdict === 'go') return null;

  const colors: Record<string, { bg: string; border: string; text: string; icon: IconId }> = {
    marginal: { bg: 'rgba(245, 158, 11, 0.15)', border: 'rgba(245, 158, 11, 0.4)', text: '#f59e0b', icon: 'alert-triangle' },
    nogo: { bg: 'rgba(239, 68, 68, 0.15)', border: 'rgba(239, 68, 68, 0.4)', text: '#ef4444', icon: 'alert-triangle' },
    calma: { bg: 'rgba(148, 163, 184, 0.12)', border: 'rgba(148, 163, 184, 0.3)', text: '#94a3b8', icon: 'sleep' },
  };
  const c = colors[condition.verdict];

  return (
    <div
      className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-auto"
    >
      <div
        className={`flex items-center rounded-lg backdrop-blur-sm font-semibold shadow-lg ${
          isMobile ? 'gap-1.5 px-2.5 py-1 text-[10px]' : 'gap-2 px-3 py-1.5 text-xs'
        }`}
        style={{
          background: c.bg,
          border: `1px solid ${c.border}`,
          color: c.text,
        }}
      >
        <WeatherIcon id={c.icon} size={isMobile ? 13 : 16} />
        <span className={`font-bold ${isMobile ? 'text-xs' : 'text-sm'}`}>{condition.label}</span>
        {!isMobile && (
          <span className="text-[10px] font-normal opacity-80">{condition.sublabel}</span>
        )}
      </div>
    </div>
  );
}
