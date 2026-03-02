import { useMemo } from 'react';
import { useWeatherStore } from '../../store/weatherStore';
import { useAlertStore } from '../../store/alertStore';
import { useThermalStore } from '../../store/thermalStore';
import { msToKnots } from '../../services/windUtils';

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
    let verdict: 'go' | 'marginal' | 'nogo';
    let label: string;
    let sublabel: string;

    if (risk.severity === 'critical') {
      verdict = 'nogo';
      label = 'NO SALIR';
      sublabel = risk.activeCount > 0 ? `${risk.activeCount} alertas activas` : 'Condiciones peligrosas';
    } else if (bestWindKt >= 6 && bestWindKt <= 25 && risk.severity !== 'high') {
      verdict = 'go';
      label = `${bestWindKt.toFixed(0)} kt`;
      sublabel = bestStationName;
    } else if (bestWindKt >= 4 && thermalScore >= 30) {
      verdict = 'marginal';
      label = `${bestWindKt.toFixed(0)} kt`;
      sublabel = `Térmico ${thermalScore}%`;
    } else if (bestWindKt > 25) {
      verdict = 'nogo';
      label = `${bestWindKt.toFixed(0)} kt`;
      sublabel = 'Viento excesivo';
    } else if (bestWindKt < 4) {
      if (thermalScore >= 50) {
        verdict = 'marginal';
        label = 'Esperar térmico';
        sublabel = `Previsión ${thermalScore}%`;
      } else {
        verdict = 'nogo';
        label = 'Sin viento';
        sublabel = avgHumidity !== null && avgHumidity > 75
          ? `HR ${avgHumidity.toFixed(0)}% — térmico improbable`
          : 'Calma';
      }
    } else {
      verdict = 'marginal';
      label = `${bestWindKt.toFixed(0)} kt`;
      sublabel = risk.severity === 'high' ? 'Precaución alertas' : bestStationName;
    }

    return { verdict, label, sublabel, bestWindKt, bestWindDir };
  }, [stations, readings, risk, thermalRules]);

  if (!condition) return null;

  const colors = {
    go: { bg: 'rgba(34, 197, 94, 0.15)', border: 'rgba(34, 197, 94, 0.4)', text: '#22c55e', icon: '⛵' },
    marginal: { bg: 'rgba(245, 158, 11, 0.15)', border: 'rgba(245, 158, 11, 0.4)', text: '#f59e0b', icon: '⚠️' },
    nogo: { bg: 'rgba(239, 68, 68, 0.15)', border: 'rgba(239, 68, 68, 0.4)', text: '#ef4444', icon: '🚫' },
  };
  const c = colors[condition.verdict];

  return (
    <div
      className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-auto"
    >
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg backdrop-blur-sm text-xs font-semibold shadow-lg"
        style={{
          background: c.bg,
          border: `1px solid ${c.border}`,
          color: c.text,
        }}
      >
        <span className="text-base">{c.icon}</span>
        <span className="text-sm font-bold">{condition.label}</span>
        <span className="text-[10px] font-normal opacity-80">{condition.sublabel}</span>
      </div>
    </div>
  );
}
