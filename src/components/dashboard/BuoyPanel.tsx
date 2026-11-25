/**
 * The marine buoys of the Estaciones tab, folded: one row each, with the sea or the wind and the water. Tapping a
 * row opens its card, where the rest is. Who publishes the data is said on every use, as they ask.
 */
import { memo, useMemo, useState } from 'react';
import { WeatherIcon } from '../icons/WeatherIcons';
import { BuoyCredit } from '../common/BuoyCredit';
import { buoyProviders, RIAS_BUOY_STATIONS, type BuoyReading } from '../../api/buoyClient';
import { useBuoyStore } from '../../store/buoyStore';
import { useUIStore } from '../../store/uiStore';
import { msToKnots } from '../../services/windUtils';
import { BUOY_STALE_MAX_MIN, BUOY_WAVE_MAX_MIN } from '../../services/buoyUtils';
import { ageMinutes, ageWords, dataAge, DATA_OLD_MIN } from '../../services/dataAge';
import { useMinuteClock } from '../../hooks/useMinuteClock';
import { listHoverHandlers } from '../../hooks/useListHover';

/** A buoy arrives up to two hours late by design: its figure stays in ink until then. */
const BUOY_AGE_LIMITS = { oldMin: BUOY_STALE_MAX_MIN, goneMin: BUOY_WAVE_MAX_MIN };

const dec = (v: number, digits = 1) => v.toFixed(digits).replace('.', ',');

export const BuoyPanel = memo(function BuoyPanel() {
  // Display-only — data fetching handled by useBuoyData hook in AppShell
  const buoys = useBuoyStore((s) => s.buoys);
  const loading = useBuoyStore((s) => s.loading);
  const error = useBuoyStore((s) => s.error);
  const lastFetch = useBuoyStore((s) => s.lastFetch);
  const selectedBuoyId = useBuoyStore((s) => s.selectedBuoyId);
  // Hooks MUST be before any early returns (React hooks rules)
  const [expanded, setExpanded] = useState(false);
  const providers = useMemo(() => buoyProviders(buoys.map((b) => b.stationId)), [buoys]);
  const now = useMinuteClock();

  // Only when there is nothing yet: every poll says «loading», and the open list would blink away.
  if (buoys.length === 0 && (loading || lastFetch === 0)) return <p className="gc-small" role="status">Cargando las boyas…</p>;
  if (error || buoys.length === 0) return <p className="gc-small" title={error ?? undefined}>{error ? 'No se pudieron cargar las boyas. Prueba en un rato.' : 'Sin datos de boyas marinas'}</p>;

  return (
    <section aria-label="Boyas marinas" className="gc-listwrap">
      <button type="button" className="gc-foldbtn" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        <WeatherIcon id="waves" size={18} />
        <span className="gc-foldbtn-name">Boyas marinas</span>
        <small>{buoys.length}</small>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: expanded ? 'rotate(180deg)' : undefined }}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {expanded && (
        <>
          <ul className="gc-list">
            {buoys.map((b) => <BuoyRow key={b.stationId} reading={b} isSelected={b.stationId === selectedBuoyId} now={now} />)}
          </ul>
          <BuoyCredit providers={providers} className="gc-small gc-credit" />
        </>
      )}
    </section>
  );
});

const BuoyRow = memo(function BuoyRow({ reading: b, isSelected, now }: { reading: BuoyReading; isSelected: boolean; now: number }) {
  const info = useMemo(() => RIAS_BUOY_STATIONS.find((s) => s.id === b.stationId), [b.stationId]);
  const ageMin = ageMinutes(b.timestamp, now);

  // What it measures that matters most: the sea, or the wind. A tide gauge is there for the level: it sits in the
  // harbour, and its «wave» of 0,02 m is the water of the dock, not the state of the sea.
  const gauge = info?.type === 'REDMAR';
  const main = gauge && b.seaLevel != null
    ? { value: `${dec(b.seaLevel, 2)} m`, word: 'nivel' }
    : !gauge && b.waveHeight != null
    ? { value: `${dec(b.waveHeight)} m`, word: 'ola' }
    : b.windSpeed != null
      ? { value: `${Math.round(msToKnots(b.windSpeed))} kt`, word: 'viento' }
      : b.seaLevel != null
        ? { value: `${dec(b.seaLevel, 2)} m`, word: 'nivel' }
        : null;

  const onSelect = () => {
    const ui = useUIStore.getState();
    useBuoyStore.getState().selectBuoy(isSelected ? null : b.stationId);
    if (ui.isMobile) ui.setSidebarOpen(false);
  };

  return (
    <li
      className="gc-listrow"
      data-current={isSelected ? '' : undefined}
      data-age={dataAge(ageMin, BUOY_AGE_LIMITS)}
      {...(info ? listHoverHandlers(info.lon, info.lat) : {})}
    >
      <button type="button" className="gc-rowbtn" aria-current={isSelected ? 'true' : undefined} onClick={onSelect}>
        <svg className="gc-rowshape" width="20" height="20" viewBox="0 0 26 26" aria-hidden="true">
          <polygon points="13,2 24,13 13,24 2,13" fill="var(--g-s-flojo)" stroke="var(--g-rule)" strokeWidth="1.5" />
        </svg>
        <span className="gc-rowmain">
          <span className="gc-rowname">{b.stationName}</span>
          {ageMin != null && ageMin > DATA_OLD_MIN && <span className="gc-rowsub"><span>{ageWords(ageMin)}</span></span>}
        </span>
        {main && (
          <span className="gc-rowfig">
            <b>{main.value}</b>{' '}
            <small>{main.word}</small>
          </span>
        )}
        {b.waterTemp != null && (
          <span className="gc-rowfig gc-rowfig--water">
            <b>{Math.round(b.waterTemp)}°</b>{' '}
            <small>agua</small>
          </span>
        )}
      </button>
    </li>
  );
});
