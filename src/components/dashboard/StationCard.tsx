import { memo, useMemo, useCallback } from 'react';
import type { NormalizedStation, NormalizedReading } from '../../types/station';
import {
  formatWindSpeed,
  formatTemperature,
  formatHumidity,
  formatPrecipitation,
  formatSolarRadiation,
  formatPressure,
  formatDewPoint,
  windSpeedColor,
  temperatureColor,
  precipitationColor,
  solarRadiationColor,
  solarRadiationIcon,
  pressureColor,
  dewPointSpreadColor,
  msToKnots,
} from '../../services/windUtils';
import { useWeatherStore } from '../../store/weatherStore';
import { WindCompass } from '../common/WindCompass';
import { SOURCE_CONFIG } from '../../config/sourceConfig';
import { WeatherIcon } from '../icons/WeatherIcons';
import type { IconId } from '../icons/WeatherIcons';
import { WindStatsPanel } from './WindStatsPanel';

// ── Wind sparkline (last ~1h of wind speed) ────────────────

const SPARKLINE_W = 40;
const SPARKLINE_H = 16;
const SPARKLINE_MAX_POINTS = 12;

function WindSparkline({ stationId }: { stationId: string }) {
  const history = useWeatherStore((s) => s.readingHistory.get(stationId));

  const path = useMemo(() => {
    if (!history || history.length < 3) return null;

    const recent = history.slice(-SPARKLINE_MAX_POINTS);
    const speeds = recent.map((r) => r.windSpeed ?? 0);
    const max = Math.max(...speeds, 1); // avoid division by 0
    const step = SPARKLINE_W / (speeds.length - 1);

    return speeds
      .map((s, i) => {
        const x = (i * step).toFixed(1);
        const y = (SPARKLINE_H - (s / max) * (SPARKLINE_H - 2) - 1).toFixed(1);
        return `${i === 0 ? 'M' : 'L'}${x},${y}`;
      })
      .join(' ');
  }, [history]);

  if (!path) return null;

  return (
    <svg
      width={SPARKLINE_W}
      height={SPARKLINE_H}
      className="ml-1 flex-shrink-0 opacity-60"
      aria-label="Tendencia viento 1h"
    >
      <path
        fill="none"
        stroke="#64748b"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d={path}
      />
    </svg>
  );
}

interface StationCardProps {
  station: NormalizedStation;
  reading?: NormalizedReading;
}

/** Compare current wind speed to recent history → trend indicator */
function useWindTrend(stationId: string, currentSpeed: number | null): { symbol: string; color: string } | null {
  const history = useWeatherStore((s) => s.readingHistory.get(stationId));

  return useMemo(() => {
    if (currentSpeed === null || !history || history.length < 3) return null;

    // Average of the 3 readings before the most recent one
    const recent = history.slice(-4, -1);
    const validSpeeds = recent.map((r) => r.windSpeed).filter((s): s is number => s !== null);
    if (validSpeeds.length === 0) return null;

    const avg = validSpeeds.reduce((a, b) => a + b, 0) / validSpeeds.length;
    const diff = currentSpeed - avg;
    const threshold = 0.5; // m/s (~1 kt)

    if (diff > threshold) return { symbol: '\u2191', color: '#22c55e' }; // ↑ green (increasing)
    if (diff < -threshold) return { symbol: '\u2193', color: '#ef4444' }; // ↓ red (decreasing)
    return { symbol: '\u2192', color: '#64748b' }; // → gray (stable)
  }, [currentSpeed, history]);
}

export const StationCard = memo(function StationCard({ station, reading }: StationCardProps) {
  const selectStation = useWeatherStore((s) => s.selectStation);
  const selectedId = useWeatherStore((s) => s.selectedStationId);
  const isSelected = selectedId === station.id;
  const trend = useWindTrend(station.id, reading?.windSpeed ?? null);

  const handleClick = useCallback(() => {
    selectStation(isSelected ? null : station.id);
  }, [selectStation, isSelected, station.id]);

  // Stale/offline detection based on reading timestamp
  const staleness = useMemo(() => {
    if (!reading) return null;
    const ageMs = Date.now() - reading.timestamp.getTime();
    const ageMin = ageMs / 60_000;
    if (ageMin > 120) return { label: 'offline', color: '#ef4444' };
    if (ageMin > 30) return { label: `${Math.round(ageMin)}min`, color: '#f59e0b' };
    return null;
  }, [reading]);

  // Memoize source badge style to avoid inline object re-creation
  const sourceBadgeStyle = useMemo(() => ({
    background: SOURCE_CONFIG[station.source].color, color: 'white',
  }), [station.source]);

  // Memoize staleness badge style
  const staleStyle = useMemo(() => staleness ? ({
    background: `${staleness.color}20`, color: staleness.color, border: `1px solid ${staleness.color}40`,
  }) : undefined, [staleness]);

  return (
    <div
      onClick={handleClick}
      className={`
        p-3 rounded-lg cursor-pointer transition-all border active:scale-[0.98] active:bg-slate-600/50
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
            style={sourceBadgeStyle}
          >
            {SOURCE_CONFIG[station.source].label}
          </span>
          <span className="text-xs font-semibold text-slate-200 truncate max-w-[140px]">
            {station.name}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {staleness && (
            <span
              className="text-[8px] font-bold px-1 py-0.5 rounded"
              style={staleStyle}
            >
              {staleness.label}
            </span>
          )}
          <span className="text-[10px] text-slate-500">{station.altitude}m</span>
        </div>
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
              <div className="flex items-baseline gap-1">
                <span
                  className="text-sm font-bold"
                  style={{ color: windSpeedColor(reading.windSpeed) }}
                >
                  {formatWindSpeed(reading.windSpeed)}
                </span>
                {trend && (
                  <span
                    className="text-xs font-bold leading-none"
                    style={{ color: trend.color }}
                    title="Tendencia viento"
                  >
                    {trend.symbol}
                  </span>
                )}
                <WindSparkline stationId={station.id} />
              </div>
              {reading.windGust !== null && reading.windGust > 0 && (
                <div className="text-[9px] text-slate-500 mt-0.5" title="Racha máxima">
                  Racha {formatWindSpeed(reading.windGust)}
                </div>
              )}
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
            {reading.solarRadiation != null && (
              <div>
                <div className="text-[10px] text-slate-500">Radiación</div>
                <div className="flex items-baseline gap-1">
                  {solarRadiationIcon(reading.solarRadiation) && (
                    <WeatherIcon id={solarRadiationIcon(reading.solarRadiation) as IconId} size={12} />
                  )}
                  <span
                    className="text-sm font-semibold"
                    style={{ color: solarRadiationColor(reading.solarRadiation) }}
                  >
                    {formatSolarRadiation(reading.solarRadiation)}
                  </span>
                </div>
              </div>
            )}
            {reading.pressure != null && (
              <div>
                <div className="text-[10px] text-slate-500">Presión</div>
                <div
                  className="text-sm font-semibold"
                  style={{ color: pressureColor(reading.pressure) }}
                >
                  {formatPressure(reading.pressure)}
                </div>
              </div>
            )}
            {reading.dewPoint != null && (
              <div>
                <div className="text-[10px] text-slate-500">P. rocío</div>
                <div className="flex items-baseline gap-1">
                  <span
                    className="text-sm font-semibold"
                    style={{ color: dewPointSpreadColor(
                      reading.temperature != null && reading.dewPoint != null ? reading.temperature - reading.dewPoint : null
                    ) }}
                  >
                    {formatDewPoint(reading.dewPoint)}
                  </span>
                  {reading.temperature != null && reading.dewPoint != null && (
                    <span className="text-[9px] text-slate-500" title="Spread T − Td">
                      Δ{(reading.temperature - reading.dewPoint).toFixed(1)}°
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="text-xs text-slate-500">Cargando datos...</div>
      )}

      {/* Wind statistics — shown only when selected */}
      {isSelected && reading && (
        <WindStatsPanel stationId={station.id} />
      )}
    </div>
  );
});
