/**
 * Card of a station: what it measures now, whether that is recent, where it is going and how it got here.
 * Its history is the panel's. Shell: Ficha.
 */
import { useMemo, useCallback, memo, useId } from 'react';
import { Ficha, FichaGroup, Note, dec } from './Ficha';
import { Cell } from '../spot/Cell';
import type { NormalizedStation, NormalizedReading } from '../../types/station';
import { useWeatherStore } from '../../store/weatherStore';
import { useWeatherSelectionStore } from '../../store/weatherSelectionStore';
import { degreesToCardinal, msToKnots, temperatureColor, windTone, WIND_TONE_NAMES } from '../../services/windUtils';

/**
 * The colour of a figure goes in a chip, the words stay in ink (18-nov): the eye found the wind and the gust by their
 * colour in the old card, and colouring the text itself read badly on the light theme. Same tokens as the spot shapes,
 * the app's one wind scale, past the verdict too.
 */
const toneChip = (kt: number) => {
  const name = WIND_TONE_NAMES[windTone(kt)];
  return { background: `var(--g-c-${name})`, color: `var(--g-ct-${name})` };
};
/** Under this, the dew point is near the air: fog close (the same reading as the fog detectors, in words). */
const FOG_NEAR_SPREAD = 1;
import { isWindBlacklisted } from '../../services/spotScoringEngine';
import { windDrift } from '../../services/windTrendService';
import { TrendMark } from '../spot/TrendMark';
import { WindPlot, type PlotStop } from '../spot/WindPlot';
import { WindCompass } from '../common/WindCompass';
import { SOURCE_CONFIG } from '../../config/sourceConfig';
import { timeAgoEs } from '../spot/spotColors';
import { ageMinutes, dataAge } from '../../services/dataAge';
import { useUIStore } from '../../store/uiStore';

interface StationPopupProps {
  station: NormalizedStation;
  reading?: NormalizedReading;
}

/** Past this, the big figure is not «now»: AEMET publishes every hour with some lag, and the rest far sooner. */
const STALE_MIN = 90;
/** What the page loads on opening (`/api/v1/readings/recent`): no request of its own. */
const TREND_HOURS = 3;
/** Past this between two readings the line breaks: joining them would draw a wind nobody measured. */
const TREND_GAP_MIN = 40;

const hhmm = (d: Date) => d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

/** The last hours of wind, mean and gust. A figure alone does not say whether it is rising or dying. */
function WindLastHours({ stationId }: { stationId: string }) {
  const history = useWeatherStore((s) => s.readingHistory.get(stationId));

  const chart = useMemo(() => {
    const now = Date.now();
    const span = TREND_HOURS * 3_600_000;
    const points = (history ?? [])
      .filter((r) => r.windSpeed != null && r.timestamp && now - r.timestamp.getTime() <= span)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    if (points.length < 3) return null;

    const peak = points.reduce((a, b) => ((b.windGust ?? b.windSpeed ?? 0) > (a.windGust ?? a.windSpeed ?? 0) ? b : a));
    const mean = points.map((r) => ({ t: r.timestamp.getTime(), kt: msToKnots(r.windSpeed!) }));
    const gust = points.filter((r) => r.windGust != null).map((r) => ({ t: r.timestamp.getTime(), kt: msToKnots(r.windGust!) }));
    const stops: PlotStop[] = points.map((r) => ({
      t: r.timestamp.getTime(),
      kt: msToKnots(r.windSpeed!),
      value: `${msToKnots(r.windSpeed!).toFixed(0)} kt`,
      note: `${r.windGust != null ? `racha ${msToKnots(r.windGust).toFixed(0)}, ` : ''}${hhmm(r.timestamp)}`,
    }));
    return { mean, gust, stops, from: now - span, to: now, peakKt: msToKnots(peak.windGust ?? peak.windSpeed ?? 0), peakAt: peak.timestamp };
  }, [history]);

  if (!chart) return null;

  const sentence = `Viento de las últimas ${TREND_HOURS} horas. Racha máxima ${chart.peakKt.toFixed(0)} nudos a las ${hhmm(chart.peakAt)}`;
  return (
    <FichaGroup title={`Últimas ${TREND_HOURS} horas`} note={`máx. ${chart.peakKt.toFixed(0)} kt a las ${hhmm(chart.peakAt)}`}>
      <WindPlot
        from={chart.from}
        to={chart.to}
        series={[
          { points: chart.gust, kind: 'thin', gapMs: TREND_GAP_MIN * 60_000 },
          { points: chart.mean, kind: 'main', gapMs: TREND_GAP_MIN * 60_000 },
        ]}
        stops={chart.stops}
        label={sentence}
        foot={(
          <>
            <span>hace {TREND_HOURS} h</span>
            <span>{chart.gust.length > 0 ? 'línea fina: racha' : ''}</span>
            <span>ahora</span>
          </>
        )}
      />
    </FichaGroup>
  );
}

/** Where its wind is going, from what the page already holds. */
function StationDrift({ stationId }: { stationId: string }) {
  const history = useWeatherStore((s) => s.readingHistory.get(stationId));
  const drift = useMemo(
    () => windDrift((history ?? []).filter((r) => r.windSpeed != null && r.timestamp).map((r) => ({ t: r.timestamp.getTime(), kt: msToKnots(r.windSpeed!) }))),
    [history],
  );
  return <TrendMark drift={drift} />;
}

export const StationPopup = memo(function StationPopup({ station, reading }: StationPopupProps) {
  const selectStation = useWeatherSelectionStore((s) => s.selectStation);
  const openHistory = useWeatherSelectionStore((s) => s.openHistory);
  const setRequestedTab = useUIStore((s) => s.setRequestedTab);
  const simpleMode = useUIStore((s) => s.simpleMode);
  const dismiss = useCallback(() => selectStation(null), [selectStation]);
  const titleId = useId();

  const sourceName = SOURCE_CONFIG[station.source]?.fullName ?? station.source;
  const speedKt = reading?.windSpeed != null ? msToKnots(reading.windSpeed) : null;
  const gustKt = reading?.windGust != null && reading.windGust > 0 ? msToKnots(reading.windGust) : null;
  const hasTime = !!reading?.timestamp && !isNaN(reading.timestamp.getTime());
  const isStale = hasTime && Date.now() - reading!.timestamp.getTime() > STALE_MIN * 60_000;
  const ago = hasTime ? timeAgoEs(reading!.timestamp) : null;
  // How recent it is says nothing while it is recent
  const isOld = hasTime && dataAge(ageMinutes(reading!.timestamp, Date.now())) !== 'fresh';

  // Gust factor: how turbulent the wind is at this station
  const gustFactor = reading?.windGust != null && reading.windSpeed != null && reading.windSpeed > 0.5
    ? reading.windGust / reading.windSpeed
    : null;
  const turbulence = gustFactor == null ? '' : gustFactor >= 2 ? 'turbulencia severa' : gustFactor >= 1.6 ? 'turbulencia moderada' : 'turbulencia ligera';

  // Dew point spread
  const dpSpread = reading?.temperature != null && reading?.dewPoint != null
    ? reading.temperature - reading.dewPoint
    : null;

  return (
    <Ficha longitude={station.lon} latitude={station.lat} onClose={dismiss} titleId={titleId}>
      <div className="gf-head">
        <div className="gf-titles">
          <h2 id={titleId} className="gf-name">{station.name}</h2>
          {reading && !isStale && isOld && <div className="gf-sub">{ago}</div>}
          {/* Peeking on a phone the credit line with the age is out of view: the head says it */}
          {reading && !isStale && !isOld && ago && <div className="gf-sub gf-peekonly">{ago}</div>}
        </div>
      </div>

      {reading ? (
        <>
          <div className="gf-big">
            <WindCompass direction={reading.windDirection} speed={reading.windSpeed} size={56} ink hideLabel />
            <span key={speedKt != null ? speedKt.toFixed(0) : ''} className={speedKt != null && !isStale ? 'gf-figure gf-figchip' : 'gf-figure'}
              style={speedKt != null && !isStale ? toneChip(speedKt) : undefined}>{speedKt != null ? speedKt.toFixed(0) : '–'}</span>
            <span className="gf-side">
              <b>
                nudos{reading.windDirection != null && speedKt != null && speedKt > 0.5
                  ? ` del ${degreesToCardinal(reading.windDirection)}${simpleMode ? '' : ` ${Math.round(reading.windDirection)}°`}`
                  : ''}
              </b>
              {!isStale && speedKt != null && <StationDrift stationId={station.id} />}
              {gustKt != null && (
                <span title={gustFactor != null ? `Factor de racha ×${dec(gustFactor)}: ${turbulence}` : undefined}>
                  racha {isStale ? gustKt.toFixed(0) : <span className="gf-chip" style={toneChip(gustKt)}>{gustKt.toFixed(0)}</span>}
                  {gustFactor != null && gustFactor >= 2 ? ', muy racheado' : gustFactor != null && gustFactor >= 1.6 ? ', racheado' : ''}
                </span>
              )}
            </span>
          </div>

          {isStale && (
            <div className="gf-note gf-note--block gc-t-alto" style={{ display: 'block' }}>
              Sin datos nuevos: último envío {ago}. Los valores son de entonces.
            </div>
          )}

          {/* How the spots are worked out is for who asks for more */}
          {!simpleMode && speedKt != null && isWindBlacklisted(station.id) && (
            <div className="gf-notes gf-notes--now">
              <Note icon="info">Su viento no entra en el cálculo de los spots.</Note>
            </div>
          )}

          {speedKt != null && <WindLastHours stationId={station.id} />}

          <FichaGroup title="Medido aquí">
          <dl className="gf-data">
            {reading.temperature != null && (
              <Cell label="Temperatura">
                {/* The colour of the station's centre on the map */}
                <i className="gf-dot" style={{ background: temperatureColor(reading.temperature) }} aria-hidden="true" />
                {dec(reading.temperature)} °C
              </Cell>
            )}
            {reading.humidity != null && <Cell label="Humedad" value={`${reading.humidity.toFixed(0)} %`} />}
            {reading.precipitation != null && reading.precipitation > 0 && (
              <Cell label="Lluvia">
                <i className="gf-dot" style={{ background: 'var(--g-s-flojo)' }} aria-hidden="true" />
                {dec(reading.precipitation)} mm
              </Cell>
            )}
            {!simpleMode && reading.solarRadiation != null && <Cell label="Radiación" value={`${reading.solarRadiation.toFixed(0)} W/m²`} />}
            {!simpleMode && reading.pressure != null && <Cell label="Presión" value={`${reading.pressure.toFixed(0)} hPa`} />}
            {!simpleMode && reading.dewPoint != null && (
              <Cell label="Punto de rocío" title="La diferencia con la temperatura: cuanto menor, más cerca de la niebla">
                {dec(reading.dewPoint)} °C
                {dpSpread != null && <small> a {dec(dpSpread)}° del aire{dpSpread < FOG_NEAR_SPREAD ? ' · niebla cerca' : ''}</small>}
              </Cell>
            )}
          </dl>
          </FichaGroup>
        </>
      ) : (
        <div className="gf-row gf-row--static">Sin datos disponibles</div>
      )}

      {/* What has to be there and says nothing on a first read: at the foot, subtle. */}
      {/* History is an advanced tab: in simple mode the panel would bounce back to the list. */}
      {!simpleMode && (
        <button
          type="button"
          className="gc-btn gf-action"
          onClick={() => { openHistory(station.id); setRequestedTab('history'); }}
        >
          Ver historial
        </button>
      )}
      <p className="gf-credit">
        {sourceName}{!simpleMode && ` · a ${station.altitude} m`}
        {reading && !isOld && ` · ${ago ?? 'hora desconocida'}`}
      </p>
    </Ficha>
  );
});
