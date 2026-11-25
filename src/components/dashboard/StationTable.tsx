/**
 * The Estaciones tab: the stations of the sector, one row each, in the order chosen. To see several at once and
 * find where it blows; what each one says in detail is in its card.
 */
import { useMemo, useState, useEffect } from 'react';
import { useWeatherStore } from '../../store/weatherStore';
import { useWeatherSelectionStore } from '../../store/weatherSelectionStore';
import { StationCard } from './StationCard';
import { isWindBlacklisted } from '../../services/spotScoringEngine';
import { sortStations, type StationSortMode } from '../../services/stationSort';
import { useMinuteClock } from '../../hooks/useMinuteClock';
import { useClearListHover } from '../../hooks/useListHover';

const INITIAL_VISIBLE = 15;

const SORTS: { mode: StationSortMode; label: string }[] = [
  { mode: 'wind', label: 'Viento' },
  { mode: 'temp', label: 'Temperatura' },
  { mode: 'name', label: 'Nombre' },
];

export function StationTable() {
  const stations = useWeatherStore((s) => s.stations);
  const currentReadings = useWeatherStore((s) => s.currentReadings);
  const selectedStationId = useWeatherSelectionStore((s) => s.selectedStationId);
  const now = useMinuteClock();
  useClearListHover();

  const [sortMode, setSortMode] = useState<StationSortMode>(() => {
    const saved = localStorage.getItem('meteomap_sortMode');
    return saved === 'temp' || saved === 'name' ? saved : 'wind';
  });
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    localStorage.setItem('meteomap_sortMode', sortMode);
  }, [sortMode]);

  const fullStations = useMemo(() => stations.filter((s) => !s.tempOnly), [stations]);
  const sortedStations = useMemo(
    () => sortStations(fullStations, currentReadings, sortMode, now, isWindBlacklisted),
    [fullStations, currentReadings, sortMode, now],
  );

  // A station chosen on the map that is further down opens the list, and comes into view
  const chosenFarDown = !!selectedStationId && sortedStations.findIndex((s) => s.id === selectedStationId) >= INITIAL_VISIBLE;
  const expanded = showAll || chosenFarDown;
  useEffect(() => {
    if (!selectedStationId) return;
    requestAnimationFrame(() => {
      document.querySelector(`[data-station-row="${CSS.escape(selectedStationId)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, [selectedStationId]);

  if (stations.length === 0) {
    return <p className="gc-small">Buscando estaciones…</p>;
  }

  const visible = expanded ? sortedStations : sortedStations.slice(0, INITIAL_VISIBLE);

  return (
    <section className="gc-listwrap" aria-label="Estaciones">
      <div className="gc-seg gc-seg--fill" role="group" aria-label="Ordenar estaciones por">
        {SORTS.map((s) => (
          <button key={s.mode} type="button" aria-pressed={sortMode === s.mode} onClick={() => setSortMode(s.mode)}>{s.label}</button>
        ))}
      </div>
      <ul className="gc-list">
        {visible.map((station) => (
          <StationCard key={station.id} station={station} reading={currentReadings.get(station.id)} now={now} />
        ))}
      </ul>
      {sortedStations.length > INITIAL_VISIBLE && !chosenFarDown && (
        <button type="button" className="gc-btn gc-btn--grow" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Mostrar menos' : `Ver ${sortedStations.length - INITIAL_VISIBLE} estaciones más`}
        </button>
      )}
    </section>
  );
}
