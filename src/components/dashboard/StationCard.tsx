/**
 * One row of the Estaciones tab: arrow, name, wind and where it is going, gust, temperature, and the age once it
 * passes 30 minutes. The figure loses ink as the data ages. Everything else about a station is in its card, which
 * the row opens. Each row reads its own history: a selector per row, or the whole list repaints on every reading.
 */
import { memo, useMemo } from 'react';
import type { NormalizedReading, NormalizedStation } from '../../types/station';
import { msToKnots } from '../../services/windUtils';
import { useWeatherStore } from '../../store/weatherStore';
import { useWeatherSelectionStore } from '../../store/weatherSelectionStore';
import { isWindBlacklisted } from '../../services/spotScoringEngine';
import { windDrift, TREND_MAX_AGE_MIN } from '../../services/windTrendService';
import { ageMinutes, ageWords, dataAge, DATA_OLD_MIN } from '../../services/dataAge';
import { TrendMark } from '../spot/TrendMark';
import { listHoverHandlers } from '../../hooks/useListHover';


/** Where the wind goes (the head drawn at the top, turned by from + 180). */
function WindArrow({ fromDeg }: { fromDeg: number }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `rotate(${(fromDeg + 180) % 360}deg)` }}>
      <path d="M12 21V3M12 3l-6 6M12 3l6 6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StationDrift({ stationId, now }: { stationId: string; now: number }) {
  const history = useWeatherStore((s) => s.readingHistory.get(stationId));
  const drift = useMemo(
    () => windDrift((history ?? []).filter((r) => r.windSpeed != null && r.timestamp).map((r) => ({ t: r.timestamp.getTime(), kt: msToKnots(r.windSpeed!) })), now),
    [history, now],
  );
  return <TrendMark drift={drift} />;
}

interface StationCardProps {
  station: NormalizedStation;
  reading?: NormalizedReading;
  now: number;
}

export const StationCard = memo(function StationCard({ station, reading, now }: StationCardProps) {
  const selectStation = useWeatherSelectionStore((s) => s.selectStation);
  const isSelected = useWeatherSelectionStore((s) => s.selectedStationId === station.id);

  const setAside = isWindBlacklisted(station.id);
  const ageMin = ageMinutes(reading?.timestamp, now);
  const age = dataAge(ageMin);

  const windKt = !setAside && reading?.windSpeed != null ? msToKnots(reading.windSpeed) : null;
  const gustKt = !setAside && reading?.windGust != null && reading.windGust > 0 ? msToKnots(reading.windGust) : null;
  const showArrow = windKt != null && windKt >= 1 && reading?.windDirection != null;
  const hasGust = gustKt != null && windKt != null && Math.round(gustKt) > Math.round(windKt);
  const temperature = reading?.temperature ?? null;

  return (
    <li
      className="gc-listrow"
      data-station-row={station.id}
      data-current={isSelected ? '' : undefined}
      data-age={reading ? age : 'gone'}
      {...listHoverHandlers(station.lon, station.lat)}
    >
      <button
        type="button"
        className="gc-rowbtn"
        aria-current={isSelected ? 'true' : undefined}
        onClick={() => selectStation(isSelected ? null : station.id)}
      >
        <span className="gc-rowarrow">{showArrow && <WindArrow fromDeg={reading!.windDirection!} />}</span>
        <span className="gc-rowmain">
          <span className="gc-rowname">{station.name}</span>
          <span className="gc-rowsub">
            {windKt != null && ageMin != null && ageMin <= TREND_MAX_AGE_MIN && <StationDrift stationId={station.id} now={now} />}
            {!reading && <span>Sin datos</span>}
            {reading && ageMin != null && ageMin > DATA_OLD_MIN && <span>{ageWords(ageMin)}</span>}
            {setAside && reading?.windSpeed != null && <span title="Su viento no entra en el cálculo de los spots">Su viento no cuenta</span>}
          </span>
        </span>
        {windKt != null && (
          <span className="gc-rowfig">
            <b>{Math.round(windKt)} kt</b>{' '}
            {hasGust && <small>racha {Math.round(gustKt!)}</small>}
          </span>
        )}
        {temperature != null && <span className="gc-rowtemp">{Math.round(temperature)}°</span>}
      </button>
    </li>
  );
});
