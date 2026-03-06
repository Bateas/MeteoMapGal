import { memo, useMemo } from 'react';
import { useWeatherStore } from '../../store/weatherStore';
import { msToKnots, degreesToCardinal, windSpeedColor } from '../../services/windUtils';
import type { NormalizedReading } from '../../types/station';
import { BarChart3, Compass, Wind } from 'lucide-react';

/**
 * Minimalist wind statistics panel shown below a selected StationCard.
 * Computes stats from readingHistory (real observations + Open-Meteo backfill).
 */
export const WindStatsPanel = memo(function WindStatsPanel({ stationId }: { stationId: string }) {
  const history = useWeatherStore((s) => s.readingHistory.get(stationId));

  const stats = useMemo(() => {
    if (!history || history.length < 3) return null;
    return computeWindStats(history);
  }, [history]);

  if (!stats) {
    return (
      <div className="text-[10px] text-slate-500 text-center py-2">
        Acumulando datos para estadísticas...
      </div>
    );
  }

  return (
    <div className="space-y-2 pt-2 border-t border-slate-700/50">
      <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider flex items-center gap-1">
        <BarChart3 className="w-3 h-3" />
        Estadísticas ({stats.periodLabel})
      </div>

      {/* Key metrics grid */}
      <div className="grid grid-cols-3 gap-2">
        <StatBox
          label="Media"
          value={`${stats.avgSpeedKt.toFixed(1)} kt`}
          color={windSpeedColor(stats.avgSpeedMs)}
        />
        <StatBox
          label="Máx"
          value={`${stats.maxSpeedKt.toFixed(1)} kt`}
          color={windSpeedColor(stats.maxSpeedMs)}
        />
        <StatBox
          label="Calma"
          value={`${stats.calmPercent}%`}
          color={stats.calmPercent > 50 ? '#ef4444' : stats.calmPercent > 25 ? '#f59e0b' : '#22c55e'}
        />
      </div>

      {/* Wind direction distribution — mini bar chart */}
      <div className="space-y-1">
        <div className="text-[10px] text-slate-500 flex items-center gap-1">
          <Compass className="w-3 h-3" />
          Distribución dirección
        </div>
        <MiniWindRose distribution={stats.dirDistribution} />
      </div>

      {/* Dominant direction */}
      <div className="flex items-center gap-2">
        <Wind className="w-3 h-3 text-sky-400" />
        <span className="text-[10px] text-slate-400">Dominante:</span>
        <span className="text-[11px] font-bold text-sky-300">{stats.dominantDir}</span>
        <span className="text-[10px] text-slate-500">({stats.dominantPercent}%)</span>
      </div>
    </div>
  );
});

// ── Stats computation ────────────────────────────────────────

const DIR_LABELS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

interface WindStats {
  avgSpeedKt: number;
  avgSpeedMs: number;
  maxSpeedKt: number;
  maxSpeedMs: number;
  calmPercent: number;
  dirDistribution: Array<{ dir: string; percent: number }>;
  dominantDir: string;
  dominantPercent: number;
  periodLabel: string;
}

function computeWindStats(readings: NormalizedReading[]): WindStats {
  const withWind = readings.filter((r) => r.windSpeed !== null);
  if (withWind.length === 0) {
    return {
      avgSpeedKt: 0, avgSpeedMs: 0, maxSpeedKt: 0, maxSpeedMs: 0,
      calmPercent: 100, dirDistribution: DIR_LABELS.map((d) => ({ dir: d, percent: 0 })),
      dominantDir: '—', dominantPercent: 0, periodLabel: '—',
    };
  }

  // Speed stats
  const speeds = withWind.map((r) => r.windSpeed!);
  const avgMs = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const maxMs = Math.max(...speeds);

  // Calm percentage (<1kt ≈ <0.51 m/s)
  const calmCount = speeds.filter((s) => s < 0.51).length;
  const calmPercent = Math.round((calmCount / speeds.length) * 100);

  // Direction distribution (8 sectors)
  const dirCounts = new Map<string, number>();
  for (const d of DIR_LABELS) dirCounts.set(d, 0);

  const withDir = withWind.filter((r) => r.windDirection !== null && r.windSpeed! >= 0.51);
  for (const r of withDir) {
    const idx = Math.round(((r.windDirection! % 360 + 360) % 360) / 45) % 8;
    const label = DIR_LABELS[idx];
    dirCounts.set(label, (dirCounts.get(label) ?? 0) + 1);
  }

  const total = withDir.length || 1;
  const distribution = DIR_LABELS.map((d) => ({
    dir: d,
    percent: Math.round(((dirCounts.get(d) ?? 0) / total) * 100),
  }));

  // Dominant direction
  let maxCount = 0;
  let dominant = '—';
  for (const [dir, count] of dirCounts) {
    if (count > maxCount) { maxCount = count; dominant = dir; }
  }

  // Period label
  const oldest = readings[0]?.timestamp;
  const newest = readings[readings.length - 1]?.timestamp;
  const hoursSpan = oldest && newest
    ? Math.round((newest.getTime() - oldest.getTime()) / 3600000)
    : 0;
  const periodLabel = hoursSpan >= 24 ? `${Math.round(hoursSpan / 24)}d`
    : hoursSpan >= 1 ? `${hoursSpan}h`
    : `${readings.length} lecturas`;

  return {
    avgSpeedKt: msToKnots(avgMs),
    avgSpeedMs: avgMs,
    maxSpeedKt: msToKnots(maxMs),
    maxSpeedMs: maxMs,
    calmPercent,
    dirDistribution: distribution,
    dominantDir: dominant,
    dominantPercent: Math.round((maxCount / total) * 100),
    periodLabel,
  };
}

// ── Sub-components ───────────────────────────────────────────

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="text-center rounded bg-slate-800/60 px-1 py-1">
      <div className="text-[9px] text-slate-500">{label}</div>
      <div className="text-[11px] font-bold" style={{ color }}>{value}</div>
    </div>
  );
}

function MiniWindRose({ distribution }: { distribution: Array<{ dir: string; percent: number }> }) {
  const maxPercent = Math.max(...distribution.map((d) => d.percent), 1);

  return (
    <div className="flex items-end gap-0.5 h-8">
      {distribution.map(({ dir, percent }) => (
        <div key={dir} className="flex-1 flex flex-col items-center gap-0.5">
          <div
            className="w-full rounded-t transition-all"
            style={{
              height: `${Math.max((percent / maxPercent) * 24, 1)}px`,
              backgroundColor: percent === maxPercent && percent > 0 ? '#38bdf8' : '#475569',
            }}
          />
          <span className="text-[7px] text-slate-500 leading-none">{dir}</span>
        </div>
      ))}
    </div>
  );
}
