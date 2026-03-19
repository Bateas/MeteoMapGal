import { useMemo } from 'react';
import { useWeatherStore } from '../../store/weatherStore';
import { useWeatherSelectionStore } from '../../store/weatherSelectionStore';
import {
  msToKnots,
  windSpeedColor,
  temperatureColor,
  degreesToCardinal,
} from '../../services/windUtils';
import type { NormalizedStation, NormalizedReading } from '../../types/station';

// ── Types ──────────────────────────────────────────────────

interface RankedEntry {
  station: NormalizedStation;
  reading: NormalizedReading;
}

interface RankingCategory {
  label: string;
  icon: string;
  entries: { entry: RankedEntry; display: string; color: string }[];
}

// ── Helpers ────────────────────────────────────────────────

function getValidEntries(
  stations: NormalizedStation[],
  readings: Map<string, NormalizedReading>,
): RankedEntry[] {
  const now = Date.now();
  const MAX_AGE = 30 * 60_000; // 30 min — stale readings excluded
  const result: RankedEntry[] = [];
  for (const s of stations) {
    const r = readings.get(s.id);
    if (!r) continue;
    if (now - r.timestamp.getTime() > MAX_AGE) continue;
    result.push({ station: s, reading: r });
  }
  return result;
}

// ── Component ──────────────────────────────────────────────

export function RankingsPanel() {
  const stations = useWeatherStore((s) => s.stations);
  const currentReadings = useWeatherStore((s) => s.currentReadings);

  const categories = useMemo((): RankingCategory[] => {
    const entries = getValidEntries(stations, currentReadings);
    if (entries.length === 0) return [];

    const TOP_N = 5;

    // ── Windiest (by wind speed, tiebreak by gust) ──
    const windiest = [...entries]
      .filter((e) => e.reading.windSpeed !== null)
      .sort((a, b) => {
        const diff = (b.reading.windSpeed ?? 0) - (a.reading.windSpeed ?? 0);
        if (diff !== 0) return diff;
        return (b.reading.windGust ?? 0) - (a.reading.windGust ?? 0);
      })
      .slice(0, TOP_N)
      .map((e) => {
        const kt = msToKnots(e.reading.windSpeed ?? 0);
        const dir = e.reading.windDirection !== null
          ? degreesToCardinal(e.reading.windDirection)
          : '';
        const gust = e.reading.windGust !== null
          ? ` (ráfaga ${Math.round(msToKnots(e.reading.windGust))})`
          : '';
        return {
          entry: e,
          display: `${Math.round(kt)} kt ${dir}${gust}`,
          color: windSpeedColor(e.reading.windSpeed),
        };
      });

    // ── Gustiest (by wind gust) ──
    const gustiest = [...entries]
      .filter((e) => e.reading.windGust !== null && (e.reading.windGust ?? 0) > 0)
      .sort((a, b) => (b.reading.windGust ?? 0) - (a.reading.windGust ?? 0))
      .slice(0, TOP_N)
      .map((e) => {
        const kt = Math.round(msToKnots(e.reading.windGust ?? 0));
        const dir = e.reading.windDirection !== null
          ? degreesToCardinal(e.reading.windDirection)
          : '';
        return {
          entry: e,
          display: `${kt} kt ${dir}`,
          color: windSpeedColor(e.reading.windGust),
        };
      });

    // ── Warmest ──
    const warmest = [...entries]
      .filter((e) => e.reading.temperature !== null)
      .sort((a, b) => (b.reading.temperature ?? -99) - (a.reading.temperature ?? -99))
      .slice(0, TOP_N)
      .map((e) => ({
        entry: e,
        display: `${(e.reading.temperature ?? 0).toFixed(1)}°C`,
        color: temperatureColor(e.reading.temperature),
      }));

    // ── Coldest ──
    const coldest = [...entries]
      .filter((e) => e.reading.temperature !== null)
      .sort((a, b) => (a.reading.temperature ?? 99) - (b.reading.temperature ?? 99))
      .slice(0, TOP_N)
      .map((e) => ({
        entry: e,
        display: `${(e.reading.temperature ?? 0).toFixed(1)}°C`,
        color: temperatureColor(e.reading.temperature),
      }));

    // ── Most humid ──
    const mostHumid = [...entries]
      .filter((e) => e.reading.humidity !== null)
      .sort((a, b) => (b.reading.humidity ?? 0) - (a.reading.humidity ?? 0))
      .slice(0, TOP_N)
      .map((e) => ({
        entry: e,
        display: `${Math.round(e.reading.humidity ?? 0)}%`,
        color: (e.reading.humidity ?? 0) > 90 ? '#3b82f6' : (e.reading.humidity ?? 0) > 70 ? '#22c55e' : '#eab308',
      }));

    // ── Highest pressure ──
    const highPressure = [...entries]
      .filter((e) => e.reading.pressure !== null)
      .sort((a, b) => (b.reading.pressure ?? 0) - (a.reading.pressure ?? 0))
      .slice(0, TOP_N)
      .map((e) => ({
        entry: e,
        display: `${(e.reading.pressure ?? 0).toFixed(1)} hPa`,
        color: (e.reading.pressure ?? 0) > 1020 ? '#3b82f6' : '#22c55e',
      }));

    // ── Lowest pressure ──
    const lowPressure = [...entries]
      .filter((e) => e.reading.pressure !== null)
      .sort((a, b) => (a.reading.pressure ?? 9999) - (b.reading.pressure ?? 9999))
      .slice(0, TOP_N)
      .map((e) => ({
        entry: e,
        display: `${(e.reading.pressure ?? 0).toFixed(1)} hPa`,
        color: (e.reading.pressure ?? 0) < 1010 ? '#f97316' : '#22c55e',
      }));

    return [
      { label: 'Más ventosa', icon: '💨', entries: windiest },
      { label: 'Rachas más fuertes', icon: '🌊', entries: gustiest },
      { label: 'Más cálida', icon: '🌡️', entries: warmest },
      { label: 'Más fría', icon: '❄️', entries: coldest },
      { label: 'Más húmeda', icon: '💧', entries: mostHumid },
      { label: 'Mayor presión', icon: '⬆', entries: highPressure },
      { label: 'Menor presión', icon: '⬇', entries: lowPressure },
    ].filter((c) => c.entries.length > 0);
  }, [stations, currentReadings]);

  if (categories.length === 0) {
    return (
      <div className="text-center text-slate-500 text-xs py-8">
        Sin datos suficientes para rankings
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
        Rankings en tiempo real
      </div>
      {categories.map((cat) => (
        <RankingCard key={cat.label} category={cat} />
      ))}
    </div>
  );
}

// ── Ranking card ───────────────────────────────────────────

function RankingCard({ category }: { category: RankingCategory }) {
  const selectStation = useWeatherSelectionStore((s) => s.selectStation);

  return (
    <div className="bg-slate-800/60 rounded-lg border border-slate-700/50 overflow-hidden">
      <div className="px-3 py-1.5 bg-slate-700/40 text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
        <span>{category.icon}</span>
        <span>{category.label}</span>
      </div>
      <div className="divide-y divide-slate-700/30">
        {category.entries.map(({ entry, display, color }, i) => (
          <button
            key={entry.station.id}
            onClick={() => selectStation(entry.station.id)}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-700/30 transition-colors text-left"
          >
            <span className="text-[10px] font-bold text-slate-500 w-4 text-right">
              {i + 1}
            </span>
            <span className="flex-1 text-xs text-slate-300 truncate">
              {entry.station.name}
            </span>
            <span
              className="text-xs font-semibold tabular-nums"
              style={{ color }}
            >
              {display}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
