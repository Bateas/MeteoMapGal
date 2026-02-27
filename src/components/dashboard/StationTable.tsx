import { useMemo, useState, useCallback, useEffect } from 'react';
import { useWeatherStore } from '../../store/weatherStore';
import { StationCard } from './StationCard';
import type { NormalizedStation } from '../../types/station';
import { SOURCE_CONFIG } from '../../config/sourceConfig';

type SourceKey = NormalizedStation['source'];

type SortMode = 'wind' | 'temp' | 'name';

// ── Component ────────────────────────────────────────────

export function StationTable() {
  const stations = useWeatherStore((s) => s.stations);
  const currentReadings = useWeatherStore((s) => s.currentReadings);

  // Filters (persisted to localStorage)
  const [hiddenSources, setHiddenSources] = useState<Set<SourceKey>>(() => {
    try {
      const saved = localStorage.getItem('meteomap_hiddenSources');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    return (localStorage.getItem('meteomap_sortMode') as SortMode) || 'wind';
  });

  useEffect(() => {
    localStorage.setItem('meteomap_hiddenSources', JSON.stringify([...hiddenSources]));
  }, [hiddenSources]);

  useEffect(() => {
    localStorage.setItem('meteomap_sortMode', sortMode);
  }, [sortMode]);

  const fullStations = useMemo(() => stations.filter((s) => !s.tempOnly), [stations]);
  const tempOnlyCount = stations.length - fullStations.length;

  // Count per source (only full stations)
  const sourceCounts = useMemo(() => {
    const counts = new Map<SourceKey, number>();
    for (const s of fullStations) {
      counts.set(s.source, (counts.get(s.source) || 0) + 1);
    }
    return counts;
  }, [fullStations]);

  // Filter by source
  const filteredStations = useMemo(() => {
    if (hiddenSources.size === 0) return fullStations;
    return fullStations.filter((s) => !hiddenSources.has(s.source));
  }, [fullStations, hiddenSources]);

  // Sort
  const sortedStations = useMemo(() => {
    return [...filteredStations].sort((a, b) => {
      if (sortMode === 'name') return a.name.localeCompare(b.name);
      const readingA = currentReadings.get(a.id);
      const readingB = currentReadings.get(b.id);
      if (sortMode === 'temp') {
        const tA = readingA?.temperature ?? -999;
        const tB = readingB?.temperature ?? -999;
        return tB - tA;
      }
      // Default: wind
      const wA = readingA?.windSpeed ?? -1;
      const wB = readingB?.windSpeed ?? -1;
      return wB - wA;
    });
  }, [filteredStations, currentReadings, sortMode]);

  const toggleSource = useCallback((source: SourceKey) => {
    setHiddenSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  }, []);

  const cycleSortMode = useCallback(() => {
    setSortMode((prev) => {
      if (prev === 'wind') return 'temp';
      if (prev === 'temp') return 'name';
      return 'wind';
    });
  }, []);

  if (stations.length === 0) {
    return (
      <div className="text-center text-slate-500 text-xs py-4">
        Buscando estaciones...
      </div>
    );
  }

  const sortLabels: Record<SortMode, string> = { wind: '💨', temp: '🌡', name: 'AZ' };

  return (
    <div className="space-y-2">
      {/* Source filter bar */}
      <div className="flex items-center gap-1 px-1 flex-wrap">
        {(Object.keys(SOURCE_CONFIG) as SourceKey[]).map((src) => {
          const count = sourceCounts.get(src);
          if (!count) return null;
          const { label, color } = SOURCE_CONFIG[src];
          const isHidden = hiddenSources.has(src);
          return (
            <button
              key={src}
              onClick={() => toggleSource(src)}
              className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-bold transition-all"
              style={{
                background: isHidden ? 'transparent' : color,
                color: isHidden ? color : 'white',
                border: `1px solid ${color}`,
                opacity: isHidden ? 0.45 : 1,
              }}
              title={`${isHidden ? 'Mostrar' : 'Ocultar'} ${src} (${count})`}
            >
              {label}
              <span className="font-normal text-[8px]" style={{ opacity: 0.8 }}>
                {count}
              </span>
            </button>
          );
        })}

        {/* Sort toggle */}
        <button
          onClick={cycleSortMode}
          className="ml-auto text-[9px] px-1.5 py-0.5 rounded border border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
          title={`Orden: ${sortMode === 'wind' ? 'viento' : sortMode === 'temp' ? 'temperatura' : 'nombre'}`}
        >
          {sortLabels[sortMode]}
        </button>

        {tempOnlyCount > 0 && (
          <span className="text-[9px] text-slate-500" title={`${tempOnlyCount} estaciones solo temperatura (puntos en mapa)`}>
            +{tempOnlyCount}t
          </span>
        )}
      </div>

      {/* Count line */}
      <div className="text-[10px] text-slate-500 px-1">
        {filteredStations.length === fullStations.length
          ? `${fullStations.length} estaciones`
          : `${filteredStations.length} de ${fullStations.length} estaciones`}
      </div>

      {sortedStations.map((station) => (
        <StationCard
          key={station.id}
          station={station}
          reading={currentReadings.get(station.id)}
        />
      ))}
    </div>
  );
}
