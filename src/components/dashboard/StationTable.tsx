import { useMemo, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useWeatherStore } from '../../store/weatherStore';
import { useUIStore } from '../../store/uiStore';
import { StationCard } from './StationCard';
import type { NormalizedStation } from '../../types/station';
import { SOURCE_CONFIG } from '../../config/sourceConfig';
import { WeatherIcon } from '../icons/WeatherIcons';

type SourceKey = NormalizedStation['source'];

type SortMode = 'wind' | 'temp' | 'name';

/**
 * PERF: content-visibility tells the browser to skip layout/paint for off-screen
 * cards. With ~40 cards and only ~7-10 visible at a time, this avoids rendering
 * ~30 cards on every update. `contain-intrinsic-size: auto 140px` uses the real
 * height after first render, 140px as initial estimate before first layout.
 * Zero JS overhead — pure browser optimization.
 */
const CARD_CONTAIN_STYLE: React.CSSProperties = {
  contentVisibility: 'auto',
  containIntrinsicSize: 'auto 140px',
};

// ── Component ────────────────────────────────────────────

export function StationTable() {
  const stations = useWeatherStore((s) => s.stations);
  const currentReadings = useWeatherStore((s) => s.currentReadings);
  const selectedStationId = useWeatherStore((s) => s.selectedStationId);
  const isMobile = useUIStore((s) => s.isMobile);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

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

  // Auto-scroll to selected station
  useEffect(() => {
    if (!selectedStationId) return;
    const el = cardRefs.current.get(selectedStationId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedStationId]);

  // Memo 1: full stations (exclude temp-only) + source counts
  const { fullStations, sourceCounts, tempOnlyCount } = useMemo(() => {
    const full: NormalizedStation[] = [];
    const counts = new Map<SourceKey, number>();
    for (const s of stations) {
      if (s.tempOnly) continue;
      full.push(s);
      counts.set(s.source, (counts.get(s.source) || 0) + 1);
    }
    return { fullStations: full, sourceCounts: counts, tempOnlyCount: stations.length - full.length };
  }, [stations]);

  // Memo 2: filtered by source + sorted in one pass
  const { filteredStations, sortedStations } = useMemo(() => {
    const filtered = hiddenSources.size === 0
      ? fullStations
      : fullStations.filter((s) => !hiddenSources.has(s.source));

    const sorted = [...filtered].sort((a, b) => {
      if (sortMode === 'name') return a.name.localeCompare(b.name);
      const readingA = currentReadings.get(a.id);
      const readingB = currentReadings.get(b.id);
      if (sortMode === 'temp') {
        return (readingB?.temperature ?? -999) - (readingA?.temperature ?? -999);
      }
      return (readingB?.windSpeed ?? -1) - (readingA?.windSpeed ?? -1);
    });

    return { filteredStations: filtered, sortedStations: sorted };
  }, [fullStations, hiddenSources, currentReadings, sortMode]);

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

  const sortLabels: Record<SortMode, ReactNode> = {
    wind: <WeatherIcon id="wind" size={12} />,
    temp: <WeatherIcon id="thermometer" size={12} />,
    name: <>AZ</>,
  };

  return (
    <div className="space-y-2">
      {/* Source filter bar */}
      <div className={`flex items-center gap-1.5 px-1 flex-wrap ${isMobile ? 'py-1' : ''}`}>
        {(Object.keys(SOURCE_CONFIG) as SourceKey[]).map((src) => {
          const count = sourceCounts.get(src);
          if (!count) return null;
          const { label, color } = SOURCE_CONFIG[src];
          const isHidden = hiddenSources.has(src);
          return (
            <button
              key={src}
              onClick={() => toggleSource(src)}
              className={`flex items-center gap-0.5 rounded font-bold transition-all ${
                isMobile ? 'px-2.5 py-1.5 text-[11px] min-h-[36px]' : 'px-1.5 py-0.5 text-[9px]'
              }`}
              style={{
                background: isHidden ? 'transparent' : color,
                color: isHidden ? color : 'white',
                border: `1px solid ${color}`,
                opacity: isHidden ? 0.45 : 1,
              }}
              title={`${isHidden ? 'Mostrar' : 'Ocultar'} ${src} (${count})`}
            >
              {label}
              <span className={`font-normal ${isMobile ? 'text-[10px]' : 'text-[8px]'}`} style={{ opacity: 0.8 }}>
                {count}
              </span>
            </button>
          );
        })}

        {/* Sort toggle */}
        <button
          onClick={cycleSortMode}
          className={`ml-auto rounded border border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors ${
            isMobile ? 'px-2.5 py-1.5 text-[11px] min-h-[36px] min-w-[36px] flex items-center justify-center' : 'text-[9px] px-1.5 py-0.5'
          }`}
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
        <div
          key={station.id}
          ref={(el) => {
            if (el) cardRefs.current.set(station.id, el);
            else cardRefs.current.delete(station.id);
          }}
          style={CARD_CONTAIN_STYLE}
        >
          <StationCard
            station={station}
            reading={currentReadings.get(station.id)}
          />
        </div>
      ))}
    </div>
  );
}
