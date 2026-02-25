import { Popup } from 'react-map-gl/maplibre';
import type { NormalizedStation, NormalizedReading } from '../../types/station';
import { useWeatherStore } from '../../store/weatherStore';
import {
  formatWindSpeed,
  formatTemperature,
  formatHumidity,
  windSpeedColor,
} from '../../services/windUtils';
import { WindCompass } from '../common/WindCompass';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

interface StationPopupProps {
  station: NormalizedStation;
  reading?: NormalizedReading;
}

export function StationPopup({ station, reading }: StationPopupProps) {
  const selectStation = useWeatherStore((s) => s.selectStation);
  const toggleChartStation = useWeatherStore((s) => s.toggleChartStation);
  const chartStations = useWeatherStore((s) => s.chartSelectedStations);
  const isInChart = chartStations.includes(station.id);

  return (
    <Popup
      longitude={station.lon}
      latitude={station.lat}
      anchor="bottom"
      offset={[0, -40]}
      closeOnClick={false}
      onClose={() => selectStation(null)}
      className="station-popup"
    >
      <div style={{ minWidth: 200, fontFamily: 'system-ui, sans-serif' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '1px 5px',
              borderRadius: 3,
              background: station.source === 'aemet' ? '#3b82f6' : station.source === 'meteoclimatic' ? '#10b981' : '#8b5cf6',
              color: 'white',
            }}
          >
            {station.source === 'aemet' ? 'AEMET' : station.source === 'meteoclimatic' ? 'Meteoclimatic' : 'MeteoGalicia'}
          </span>
          <strong style={{ fontSize: 13 }}>{station.name}</strong>
        </div>

        {reading ? (
          <>
            {/* Wind compass + data */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 6 }}>
              <WindCompass
                direction={reading.windDirection}
                speed={reading.windSpeed}
                size={64}
              />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', fontSize: 12, flex: 1 }}>
                <div>
                  <div style={{ color: '#64748b', fontSize: 10, marginBottom: 2 }}>Viento</div>
                  <div style={{ fontWeight: 600, color: windSpeedColor(reading.windSpeed) }}>
                    {formatWindSpeed(reading.windSpeed)}
                  </div>
                </div>
                <div>
                  <div style={{ color: '#64748b', fontSize: 10, marginBottom: 2 }}>Temperatura</div>
                  <div style={{ fontWeight: 600 }}>{formatTemperature(reading.temperature)}</div>
                </div>
                <div>
                  <div style={{ color: '#64748b', fontSize: 10, marginBottom: 2 }}>Humedad</div>
                  <div style={{ fontWeight: 600 }}>{formatHumidity(reading.humidity)}</div>
                </div>
              </div>
            </div>

            {/* Altitude */}
            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 6 }}>
              Alt: {station.altitude}m
            </div>

            {/* Timestamp */}
            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
              {reading.timestamp && !isNaN(reading.timestamp.getTime())
                ? `Actualizado ${formatDistanceToNow(reading.timestamp, { addSuffix: true, locale: es })}`
                : 'Hora desconocida'}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12, color: '#94a3b8' }}>Sin datos disponibles</div>
        )}

        {/* Add to chart button */}
        <button
          onClick={() => toggleChartStation(station.id)}
          style={{
            marginTop: 8,
            width: '100%',
            padding: '4px 8px',
            fontSize: 11,
            fontWeight: 600,
            border: '1px solid #e2e8f0',
            borderRadius: 4,
            background: isInChart ? '#eff6ff' : 'white',
            color: isInChart ? '#3b82f6' : '#64748b',
            cursor: 'pointer',
          }}
        >
          {isInChart ? 'Quitar de gráfica' : 'Añadir a gráfica'}
        </button>
      </div>
    </Popup>
  );
}
