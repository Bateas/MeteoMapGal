/**
 * Card of a marine buoy, opened from its marker. V3 style: what matters most in one big line (the sea, or
 * the wind, or the water where it measures neither), and the rest in the grid. Shell: Ficha.
 */
import { memo, useCallback, useId, useMemo } from 'react';
import { Ficha, FichaGroup, Note, dec } from './Ficha';
import { Cell } from '../spot/Cell';
import type { BuoyReading } from '../../api/buoyClient';
import { RIAS_BUOY_STATIONS } from '../../api/buoyClient';
import { useBuoyStore } from '../../store/buoyStore';
import { useUIStore } from '../../store/uiStore';
import { useWeatherSelectionStore } from '../../store/weatherSelectionStore';
import { msToKnots, degreesToCardinal } from '../../services/windUtils';
import { seaStateLabel, isBuoyFresh, BUOY_WATER_MAX_MIN } from '../../services/buoyUtils';
import { classifyWaterMass } from '../../services/upwellingDetector';
import { BuoyTrend48h } from './BuoyTrend48h';
import { BuoyCredit } from '../common/BuoyCredit';

/** Lightweight relative-time in Spanish (avoids date-fns locale bundle) */
function timeAgoEs(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'Actualizado ahora';
  if (mins < 60) return `Actualizado hace ${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `Actualizado hace ${hrs} h`;
  return `Actualizado hace ${Math.round(hrs / 24)} d`;
}

interface BuoyPopupProps {
  reading: BuoyReading;
}

function getBuoyInfo(stationId: number) {
  return RIAS_BUOY_STATIONS.find((s) => s.id === stationId) ?? null;
}

/** «NW 315°»; in simple mode only the word: the degrees change nothing a person does. */
const dirText = (deg: number, plain = false) => (plain ? degreesToCardinal(deg) : `${degreesToCardinal(deg)} ${Math.round(deg)}°`);

export const BuoyPopup = memo(function BuoyPopup({ reading }: BuoyPopupProps) {
  const selectBuoy = useBuoyStore((s) => s.selectBuoy);
  const simpleMode = useUIStore((s) => s.simpleMode);
  const info = getBuoyInfo(reading.stationId);
  const dismiss = useCallback(() => selectBuoy(null), [selectBuoy]);
  const titleId = useId();

  const waterMass = useMemo(
    () => classifyWaterMass(reading.waterTemp, reading.salinity),
    [reading.waterTemp, reading.salinity]
  );

  if (!info) return null;

  // A buoy that stopped publishing keeps serving its last reading. Its values stay visible, labelled as
  // old, but the water-mass diagnosis is a statement about the water now, so it is withheld.
  const isStale = !isBuoyFresh(reading, BUOY_WATER_MAX_MIN);

  // A tide gauge sits in the harbour: its «wave» of 0,02 m is the water of the dock, not the state of the sea
  const gauge = info.type === 'REDMAR';
  const hasWaves = !gauge && reading.waveHeight != null;
  const hasWind = reading.windSpeed != null;
  const coldWater = reading.waterTemp != null && reading.waterTemp < 10.5;

  // The big line: the sea if it measures it, otherwise the wind, otherwise the water.
  const big = hasWaves
    ? { figure: `${dec(reading.waveHeight!)} m`, side: seaStateLabel(reading.waveHeight), sub: reading.waveDir != null ? `del ${dirText(reading.waveDir, simpleMode)}` : null }
    : hasWind
      ? { figure: msToKnots(reading.windSpeed!).toFixed(0), side: `nudos${reading.windDir != null ? ` del ${dirText(reading.windDir, simpleMode)}` : ''}`, sub: reading.windGust != null ? `racha ${msToKnots(reading.windGust).toFixed(0)}` : null }
      : reading.waterTemp != null
        ? { figure: `${dec(reading.waterTemp)} °C`, side: 'en el agua', sub: null }
        : null;

  return (
    <Ficha longitude={info.lon} latitude={info.lat} onClose={dismiss} titleId={titleId}>
      <div className="gf-head">
        <div className="gf-titles">
          <h2 id={titleId} className="gf-name">{reading.stationName}</h2>
          <div className="gf-sub">
            Boya · {reading.timestamp ? timeAgoEs(reading.timestamp).replace('Actualizado ', '') : 'hora desconocida'}
          </div>
        </div>
      </div>

      {isStale && (
        <div className="gf-note gf-note--block gc-t-alto" style={{ display: 'block' }}>
          Sin datos nuevos: {reading.timestamp ? timeAgoEs(reading.timestamp).replace('Actualizado hace', 'último envío hace') : 'hora desconocida'}. Los valores son de entonces.
        </div>
      )}

      {big && (
        <div className="gf-big">
          <svg className="gf-chip" width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
            <polygon points="13,2 24,13 13,24 2,13" fill="var(--g-s-flojo)" stroke="var(--g-rule)" strokeWidth="1.5" />
          </svg>
          <span key={big.figure} className="gf-figure">{big.figure}</span>
          <span className="gf-side">
            <b>{big.side}</b>
            {big.sub && <span>{big.sub}</span>}
          </span>
        </div>
      )}

      <FichaGroup title="Medido aquí">
      <dl className="gf-data">
        {hasWaves && (
          <>
            {reading.wavePeriod != null && <Cell label="Periodo" value={`${dec(reading.wavePeriod)} s`} />}
            {reading.waveHeightMax != null && <Cell label="Ola máxima" value={`${dec(reading.waveHeightMax)} m`} />}
            {!simpleMode && reading.wavePeriodMean != null && <Cell label="Periodo medio" value={`${dec(reading.wavePeriodMean)} s`} />}
          </>
        )}
        {/* Wind is in the big line when the buoy measures no sea */}
        {hasWaves && hasWind && (
          <Cell label="Viento" value={`${msToKnots(reading.windSpeed!).toFixed(0)} kt${reading.windDir != null ? ` ${degreesToCardinal(reading.windDir)}` : ''}`} />
        )}
        {hasWaves && reading.windGust != null && <Cell label="Racha" value={`${msToKnots(reading.windGust).toFixed(0)} kt`} />}
        {reading.waterTemp != null && (hasWaves || hasWind) && (
          <Cell label="Agua" warn={coldWater}>
            {dec(reading.waterTemp)} °C{coldWater && <small> muy fría para la zona</small>}
          </Cell>
        )}
        {reading.airTemp != null && <Cell label="Aire" value={`${dec(reading.airTemp)} °C`} />}
        {!simpleMode && reading.airPressure != null && <Cell label="Presión" value={`${reading.airPressure.toFixed(0)} hPa`} />}
        {!simpleMode && reading.currentSpeed != null && (
          <Cell label="Corriente" value={`${(reading.currentSpeed * 100).toFixed(0)} cm/s${reading.currentDir != null ? ` hacia ${degreesToCardinal(reading.currentDir)}` : ''}`} />
        )}
        {!simpleMode && reading.salinity != null && <Cell label="Salinidad" value={`${dec(reading.salinity)} PSU`} />}
        {/* A tide gauge measures this and little else: it is its main figure in any mode */}
        {(!simpleMode || gauge || (!hasWaves && !hasWind)) && reading.seaLevel != null && <Cell label="Nivel del mar" value={`${dec(reading.seaLevel, 2)} m`} />}
        {!simpleMode && reading.humidity != null && <Cell label="Humedad" value={`${reading.humidity.toFixed(0)} %`} />}
        {!simpleMode && reading.dewPoint != null && <Cell label="Punto de rocío" value={`${dec(reading.dewPoint)} °C`} />}
      </dl>

      {/* What kind of water it is, when it says something: warm surface water or «transitional» do not */}
      {/* Simple mode keeps only the one that warns: the names of water masses are for who asks for more */}
      {(waterMass.type === 'anomaly' || (!simpleMode && (waterMass.type === 'acna' || waterMass.type === 'fluvial'))) && !isStale && (
        <div className="gf-notes">
          <Note
            icon={waterMass.type === 'acna' ? 'waves' : waterMass.type === 'fluvial' ? 'droplets' : waterMass.type === 'anomaly' ? 'alert-triangle' : 'thermometer'}
            tone={waterMass.type === 'anomaly' ? 'alto' : 'riesgo'}
          >
            <span className="gf-strong">{waterMass.badgeText}</span>
            <small>{waterMass.description}</small>
          </Note>
        </div>
      )}
      </FichaGroup>

      {!simpleMode && (
        <FichaGroup title="Más" list>
          <BuoyTrend48h stationId={reading.stationId} />
        </FichaGroup>
      )}

      {/* History is an advanced tab: in simple mode the panel would bounce back to the list */}
      {!simpleMode && (
        <button
          type="button"
          className="gc-btn gf-action"
          onClick={() => {
            useWeatherSelectionStore.getState().openHistory(`buoy_${reading.stationId}`);
            useUIStore.getState().setRequestedTab('history');
          }}
        >
          Ver historial
        </button>
      )}

      {/* Who the data come from: Puertos del Estado and the Xunta ask for it on every use */}
      <p className="gf-credit">{!simpleMode && `Red ${info.type}. `}<BuoyCredit providers={info.providers} /></p>
    </Ficha>
  );
});
