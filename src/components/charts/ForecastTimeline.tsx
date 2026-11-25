/**
 * The one forecast view: «el parte» and the hour-by-hour table, the same in the side panel's
 * Previsión tab and in the full-screen panel. The WRF of MeteoGalicia with its own fallback, no
 * model selector (it was a global switch that emptied and reloaded the forecast of the whole app).
 */
import { useState, useEffect, useMemo } from 'react';
import { ForecastPartG, ForecastHoursG, ForecastSimpleG } from './ForecastPartG';
import { useForecastStore } from '../../hooks/useForecastTimeline';
import { useSectorStore } from '../../store/sectorStore';
import { useUIStore } from '../../store/uiStore';
import type { HourlyForecast } from '../../types/forecast';
import { fetchMeteoSixForecast } from '../../api/meteoSixClient';
import { AtmosphericProfile } from '../dashboard/AtmosphericProfile';
import { useAloft } from '../../hooks/useAloft';
import { detectThermalForecast } from '../../services/thermalForecastDetector';
import '../../styles/archivoFonts.css';
import './forecastG.css';

/** Whether the coming days look like thermal days, in one line: what the Térmico tab left that decides. */
function ThermalDayLine({ hourly }: { hourly: HourlyForecast[] }) {
  const aloft = useAloft();
  const signals = useMemo(() => detectThermalForecast(hourly, aloft), [hourly, aloft]);
  if (signals.length === 0) return null;
  return <p className="g-how" style={{ marginBottom: 12 }}>{signals[0].label}</p>;
}

/**
 * `wide`: the full-screen panel on a desktop. There is room, so simple mode shows the wind hour by hour and
 * the table open instead of folded (18-nov).
 */
export function ForecastTimeline({ spotCoords, wide = false }: { spotCoords?: { lat: number; lon: number }; wide?: boolean } = {}) {
  const storeHourly = useForecastStore((s) => s.hourly);
  const storeFetchedAt = useForecastStore((s) => s.fetchedAt);
  const storeError = useForecastStore((s) => s.error);

  // Spot-specific forecast: fetch MeteoSIX for spot coords when provided
  const [spotHourly, setSpotHourly] = useState<HourlyForecast[]>([]);
  const [spotFetchedAt, setSpotFetchedAt] = useState<Date | null>(null);
  const [spotFailed, setSpotFailed] = useState(false);
  useEffect(() => {
    if (!spotCoords) return;
    let stale = false;
    setSpotFailed(false);
    // The previous spot's hours must not stay on screen under this spot's name
    setSpotHourly([]);
    fetchMeteoSixForecast(spotCoords.lat, spotCoords.lon)
      .then(data => {
        if (stale) return;
        setSpotHourly(data);
        setSpotFetchedAt(new Date());
        setSpotFailed(data.length === 0);
      })
      .catch(() => { if (!stale) setSpotFailed(true); });
    return () => { stale = true; };
  }, [spotCoords?.lat, spotCoords?.lon]);

  // Use spot data when available, otherwise sector data
  const hourly = spotCoords && spotHourly.length > 0 ? spotHourly : storeHourly;
  const fetchedAt = spotCoords && spotFetchedAt ? spotFetchedAt : storeFetchedAt;
  const error = spotCoords
    ? (spotFailed && storeHourly.length === 0 ? 'no hay previsión disponible ahora' : null)
    : storeError;
  // It falls back to the sector's forecast, and the title still names the spot: say so.
  const sectorFallback = !!spotCoords && spotFailed && storeHourly.length > 0;

  const sectorId = useSectorStore((s) => s.activeSector.id);
  const simpleMode = useUIStore((s) => s.simpleMode);
  // Reference point for the forecast (so users know WHERE the data is for)
  const forecastRef = spotCoords
    ? '' // The spot's name is already on screen (panel header, spot selector)
    : sectorId === 'embalse' ? 'Embalse de Castrelo' : 'Cesantes (interior ria)';

  if (error && hourly.length === 0) {
    return (
      <div className="gc-errorline" role="alert" title={error}>
        No hay previsión ahora. Prueba en un rato.
      </div>
    );
  }

  const partSource = `Modelo WRF de MeteoGalicia a 1 km${forecastRef ? ` en ${forecastRef}` : ''}${fetchedAt ? `, descargado a las ${fetchedAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}` : ''}`;

  return (
    <div className="flex flex-col">
      {sectorFallback && <p className="g-how" role="status" style={{ marginBottom: 12 }}><strong>No hay previsión propia de este spot ahora.</strong> Se muestra la de la zona.</p>}
      {sectorId === 'embalse' && <ThermalDayLine hourly={hourly} />}
      {simpleMode ? (
        // Simple mode: the answer first (rain, wind, cold, today and tomorrow), then the wind hour by hour;
        // the full table is one tap below, folded (open on a desktop full screen).
        <>
          <ForecastSimpleG hourly={hourly} place={spotCoords} />
          {/* The wind hour by hour is always in sight (18-nov: «un pelín más de detalle sin clicar»); only
              the full table folds, and not on a desktop full screen, where there is room for it. */}
          <div className="g-detailbody g-detailbody--open">
            <ForecastPartG hourly={hourly} notices={false} place={spotCoords} />
            {wide && <ForecastHoursG hourly={hourly} />}
          </div>
          {!wide && (
            <details className="g-howfold g-detailfold">
              <summary>Tabla hora a hora</summary>
              <div className="g-detailbody">
                <ForecastHoursG hourly={hourly} />
              </div>
            </details>
          )}
        </>
      ) : (
        <>
          <ForecastPartG hourly={hourly} place={spotCoords} />
          <ForecastHoursG hourly={hourly} />
        </>
      )}
      {/* The convection context of Castrelo: folded, and not in simple mode */}
      {sectorId === 'embalse' && !simpleMode && <AtmosphericProfile />}
      {/* Where the figures come from, once, at the end (it was a fold and two notes in the parte). */}
      <p className="g-under">{partSource}.</p>
    </div>
  );
}
