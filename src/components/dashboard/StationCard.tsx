import type { NormalizedStation, NormalizedReading } from '../../types/station';
import {
  formatWindSpeed,
  formatTemperature,
  formatHumidity,
  formatPrecipitation,
  windSpeedColor,
  temperatureColor,
  precipitationColor,
} from '../../services/windUtils';
import { useWeatherStore } from '../../store/weatherStore';
import { WindCompass } from '../common/WindCompass';

interface StationCardProps {
  station: NormalizedStation;
  reading?: NormalizedReading;
}

export function StationCard({ station, reading }: StationCardProps) {
  const selectStation = useWeatherStore((s) => s.selectStation);
  const selectedId = useWeatherStore((s) => s.selectedStationId);
  const isSelected = selectedId === station.id;

  return (
    <div
      onClick={() => selectStation(isSelected ? null : station.id)}
      className={`
        p-3 rounded-lg cursor-pointer transition-all border
        ${isSelected
          ? 'bg-slate-700 border-blue-500 shadow-lg shadow-blue-500/10'
          : 'bg-slate-800 border-slate-700 hover:border-slate-600'
        }
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded"
            style={{
              background: station.source === 'aemet' ? '#3b82f6'
                : station.source === 'meteoclimatic' ? '#10b981'
                : station.source === 'wunderground' ? '#f59e0b'
                : station.source === 'netatmo' ? '#06b6d4'
                : '#8b5cf6',
              color: 'white',
            }}
          >
            {station.source === 'aemet' ? 'A'
              : station.source === 'meteoclimatic' ? 'MC'
              : station.source === 'wunderground' ? 'WU'
              : station.source === 'netatmo' ? 'NT'
              : 'MG'}
          </span>
          <span className="text-xs font-semibold text-slate-200 truncate max-w-[140px]">
            {station.name}
          </span>
        </div>
        <span className="text-[10px] text-slate-500">{station.altitude}m</span>
      </div>

      {reading ? (
        <div className="flex gap-3">
          {/* Wind compass */}
          <WindCompass
            direction={reading.windDirection}
            speed={reading.windSpeed}
            size={56}
          />

          {/* Data grid */}
          <div className="flex-1 grid grid-cols-2 gap-x-3 gap-y-1.5">
            <div>
              <div className="text-[10px] text-slate-500">Viento</div>
              <div
                className="text-sm font-bold"
                style={{ color: windSpeedColor(reading.windSpeed) }}
              >
                {formatWindSpeed(reading.windSpeed)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">Temp</div>
              <div
                className="text-sm font-bold"
                style={{ color: temperatureColor(reading.temperature) }}
              >
                {formatTemperature(reading.temperature)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">Humedad</div>
              <div className="text-sm font-semibold text-slate-300">
                {formatHumidity(reading.humidity)}
              </div>
            </div>
            {reading.precipitation !== null && reading.precipitation > 0 && (
              <div>
                <div className="text-[10px] text-slate-500">Lluvia</div>
                <div
                  className="text-sm font-semibold"
                  style={{ color: precipitationColor(reading.precipitation) }}
                >
                  {formatPrecipitation(reading.precipitation)}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="text-xs text-slate-500">Cargando datos...</div>
      )}
    </div>
  );
}
