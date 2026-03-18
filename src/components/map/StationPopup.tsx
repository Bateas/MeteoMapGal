import { useState, useEffect, memo } from 'react';
import { Popup } from 'react-map-gl/maplibre';
import type { NormalizedStation, NormalizedReading } from '../../types/station';
import { useWeatherStore } from '../../store/weatherStore';
import { useSwipeToDismiss } from '../../hooks/useSwipeToDismiss';
import {
  formatWindSpeed,
  formatTemperature,
  formatHumidity,
  formatPrecipitation,
  formatSolarRadiation,
  formatPressure,
  formatDewPoint,
  windSpeedColor,
  precipitationColor,
  temperatureColor,
  solarRadiationColor,
  solarRadiationIcon,
  pressureColor,
  dewPointSpreadColor,
} from '../../services/windUtils';
import { WindCompass } from '../common/WindCompass';
import { SOURCE_CONFIG } from '../../config/sourceConfig';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { loadAemetHistory, filterByStation, filterBySeason, buildWindRose } from '../../services/aemetHistoryParser';
import type { WindRoseData } from '../../types/campo';
import { useUIStore } from '../../store/uiStore';
import { WeatherIcon } from '../icons/WeatherIcons';
import type { IconId } from '../icons/WeatherIcons';

// AEMET stations with historical data
const AEMET_HISTORY_STATIONS = ['aemet_1701X', 'aemet_1690A', 'aemet_1700X'];

interface StationPopupProps {
  station: NormalizedStation;
  reading?: NormalizedReading;
}

/** Reusable data cell: label + colored value */
function DataCell({ label, value, color, icon, children }: {
  label: string;
  value?: string;
  color?: string;
  icon?: IconId;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-slate-500 text-[10px] mb-0.5 flex items-center gap-0.5">
        {icon && <WeatherIcon id={icon} size={10} />}
        {label}
      </div>
      {children ?? (
        <div className="font-semibold" style={color ? { color } : undefined}>{value}</div>
      )}
    </div>
  );
}

export const StationPopup = memo(function StationPopup({ station, reading }: StationPopupProps) {
  const selectStation = useWeatherStore((s) => s.selectStation);
  const toggleChartStation = useWeatherStore((s) => s.toggleChartStation);
  const chartStations = useWeatherStore((s) => s.chartSelectedStations);
  const isInChart = chartStations.includes(station.id);
  const isMobile = useUIStore((s) => s.isMobile);
  const dismiss = () => selectStation(null);
  const { sheetRef, onTouchStart, onTouchMove, onTouchEnd } = useSwipeToDismiss(dismiss);

  // Mini wind rose for AEMET stations with historical data (lazy-loaded)
  const hasHistory = AEMET_HISTORY_STATIONS.includes(station.id);
  const [windRoseData, setWindRoseData] = useState<WindRoseData | null>(null);
  useEffect(() => {
    if (!hasHistory) {
      setWindRoseData(null);
      return;
    }
    let cancelled = false;
    loadAemetHistory().then((records) => {
      if (cancelled) return;
      const indicativo = station.id.replace('aemet_', '');
      const stationDays = filterByStation(records, indicativo);
      const summerDays = filterBySeason(stationDays, [6, 7, 8, 9]);
      setWindRoseData(buildWindRose(summerDays));
    });
    return () => { cancelled = true; };
  }, [hasHistory, station.id]);

  const sourceColor = SOURCE_CONFIG[station.source].color;

  // Gust factor
  const gustFactor = reading?.windGust != null && reading.windSpeed != null && reading.windSpeed > 0.5
    ? reading.windGust / reading.windSpeed
    : null;

  // Dew point spread
  const dpSpread = reading?.temperature != null && reading?.dewPoint != null
    ? reading.temperature - reading.dewPoint
    : null;

  // ── Shared popup content ──────────────────────────────
  const popupContent = (
    <div className="min-w-[200px] font-sans">
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-2">
        <span
          className="text-[10px] font-bold px-1.5 py-px rounded text-white"
          style={{ background: sourceColor }}
        >
          {SOURCE_CONFIG[station.source].fullName}
        </span>
        <strong className="text-[13px]">{station.name}</strong>
      </div>

      {reading ? (
        <>
          {/* Wind compass + data grid */}
          <div className="flex gap-2.5 items-start mb-1.5">
            <WindCompass
              direction={reading.windDirection}
              speed={reading.windSpeed}
              size={64}
            />
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs flex-1">
              <DataCell label="Viento" value={formatWindSpeed(reading.windSpeed)} color={windSpeedColor(reading.windSpeed)} />
              <DataCell label="Temperatura" value={formatTemperature(reading.temperature)} color={temperatureColor(reading.temperature)} />

              {reading.windGust != null && reading.windGust > 0 && (
                <DataCell label="Racha">
                  <div className="flex items-baseline gap-1">
                    <span className="font-semibold" style={{ color: windSpeedColor(reading.windGust) }}>
                      {formatWindSpeed(reading.windGust)}
                    </span>
                    {gustFactor != null && gustFactor >= 1.3 && (
                      <span
                        className="text-[9px]"
                        style={{ color: gustFactor >= 2 ? '#f87171' : gustFactor >= 1.6 ? '#fb923c' : '#94a3b8' }}
                        title={`Factor racha: ${gustFactor.toFixed(1)}× — ${gustFactor >= 2 ? 'turbulencia severa' : gustFactor >= 1.6 ? 'turbulencia moderada' : 'ligera'}`}
                      >
                        ×{gustFactor.toFixed(1)}
                      </span>
                    )}
                  </div>
                </DataCell>
              )}

              <DataCell label="Humedad" value={formatHumidity(reading.humidity)} />

              {reading.precipitation != null && reading.precipitation > 0 && (
                <DataCell label="Lluvia" value={formatPrecipitation(reading.precipitation)} color={precipitationColor(reading.precipitation)} />
              )}

              {reading.solarRadiation != null && (
                <DataCell
                  label="Radiación"
                  value={formatSolarRadiation(reading.solarRadiation)}
                  color={solarRadiationColor(reading.solarRadiation)}
                  icon={solarRadiationIcon(reading.solarRadiation) as IconId | undefined}
                />
              )}

              {reading.pressure != null && (
                <DataCell label="Presión" value={formatPressure(reading.pressure)} color={pressureColor(reading.pressure)} />
              )}

              {reading.dewPoint != null && (
                <DataCell label="P. rocío">
                  <div className="flex items-baseline gap-1">
                    <span className="font-semibold" style={{ color: dewPointSpreadColor(dpSpread) }}>
                      {formatDewPoint(reading.dewPoint)}
                    </span>
                    {dpSpread != null && (
                      <span className="text-[9px] text-slate-400" title="Spread T − Td">
                        Δ{dpSpread.toFixed(1)}°
                      </span>
                    )}
                  </div>
                </DataCell>
              )}
            </div>
          </div>

          {/* Altitude */}
          <div className="text-[10px] text-slate-400 mt-1.5">
            Alt: {station.altitude}m
          </div>

          {/* Mini wind rose for AEMET stations */}
          {windRoseData && windRoseData.totalDays > 0 && (
            <MiniWindRose data={windRoseData} />
          )}

          {/* Timestamp */}
          <div className="text-[10px] text-slate-400 mt-0.5">
            {reading.timestamp && !isNaN(reading.timestamp.getTime())
              ? `Actualizado ${formatDistanceToNow(reading.timestamp, { addSuffix: true, locale: es })}`
              : 'Hora desconocida'}
          </div>
        </>
      ) : (
        <div className="text-xs text-slate-400">Sin datos disponibles</div>
      )}

      {/* Add to chart button */}
      <button
        onClick={() => toggleChartStation(station.id)}
        className={`mt-2 w-full py-1 px-2 text-[11px] font-semibold border rounded cursor-pointer transition-colors
          ${isInChart
            ? 'bg-blue-50 text-blue-500 border-blue-200 hover:bg-blue-100'
            : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
          }`}
      >
        {isInChart ? 'Quitar de gráfica' : 'Añadir a gráfica'}
      </button>
    </div>
  );

  // ── Mobile: bottom sheet ──────────────────────────────
  if (isMobile) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-40 animate-slide-up">
        <div ref={sheetRef} className="bg-slate-900 border-t border-slate-700 rounded-t-2xl shadow-2xl max-h-[55dvh] overflow-y-auto p-4"
             style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}>
          {/* Drag handle — swipe down to dismiss */}
          <div className="flex justify-center mb-3" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
            <div className="w-10 h-1 rounded-full bg-slate-600" />
          </div>
          {/* Close button */}
          <button
            onClick={() => selectStation(null)}
            className="absolute top-3 right-3 p-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Cerrar"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          {popupContent}
        </div>
      </div>
    );
  }

  // ── Desktop: MapLibre popup ───────────────────────────
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
      {popupContent}
    </Popup>
  );
});

// ── Mini SVG wind rose for popups ────────────────────────────

const ROSE_SIZE = 100;
const ROSE_CENTER = ROSE_SIZE / 2;
const ROSE_RADIUS = 38;

const DIRS_16 = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

const CARDINAL_LABELS = [
  { label: 'N', angle: -90 },
  { label: 'E', angle: 0 },
  { label: 'S', angle: 90 },
  { label: 'W', angle: 180 },
] as const;

function MiniWindRose({ data }: { data: WindRoseData }) {
  const maxPct = Math.max(...data.points.map((p) => p.percentage), 1);

  const polyPoints = data.points.map((p, i) => {
    const angle = ((i * 360) / 16 - 90) * (Math.PI / 180);
    const r = (p.percentage / maxPct) * ROSE_RADIUS;
    const x = ROSE_CENTER + r * Math.cos(angle);
    const y = ROSE_CENTER + r * Math.sin(angle);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return (
    <div className="mt-2 border-t border-slate-200 pt-1.5">
      <div className="text-[9px] text-slate-400 mb-1 font-semibold">
        Rosa Vientos (Jun-Sep, {data.totalDays} días)
      </div>
      <svg width={ROSE_SIZE} height={ROSE_SIZE} viewBox={`0 0 ${ROSE_SIZE} ${ROSE_SIZE}`} className="block mx-auto">
        {[0.33, 0.66, 1].map((f) => (
          <circle key={f} cx={ROSE_CENTER} cy={ROSE_CENTER} r={ROSE_RADIUS * f} fill="none" stroke="#e2e8f0" strokeWidth={0.5} />
        ))}
        {[0, 45, 90, 135].map((deg) => {
          const rad = (deg - 90) * (Math.PI / 180);
          return (
            <line key={deg}
              x1={ROSE_CENTER - ROSE_RADIUS * Math.cos(rad)} y1={ROSE_CENTER - ROSE_RADIUS * Math.sin(rad)}
              x2={ROSE_CENTER + ROSE_RADIUS * Math.cos(rad)} y2={ROSE_CENTER + ROSE_RADIUS * Math.sin(rad)}
              stroke="#e2e8f0" strokeWidth={0.3}
            />
          );
        })}
        <polygon points={polyPoints} fill="rgba(245, 158, 11, 0.3)" stroke="#f59e0b" strokeWidth={1.5} />
        {CARDINAL_LABELS.map(({ label, angle }) => {
          const rad = angle * (Math.PI / 180);
          return (
            <text key={label}
              x={ROSE_CENTER + (ROSE_RADIUS + 8) * Math.cos(rad)}
              y={ROSE_CENTER + (ROSE_RADIUS + 8) * Math.sin(rad)}
              textAnchor="middle" dominantBaseline="central" fontSize={8} fontWeight={700} fill="#64748b"
            >
              {label}
            </text>
          );
        })}
        {data.points.length > 0 && (() => {
          const dominant = data.points.reduce((a, b) => (b.percentage > a.percentage ? b : a));
          const idx = DIRS_16.indexOf(dominant.direction);
          if (idx < 0) return null;
          const angle = ((idx * 360) / 16 - 90) * (Math.PI / 180);
          const r = (dominant.percentage / maxPct) * ROSE_RADIUS;
          return <circle cx={ROSE_CENTER + r * Math.cos(angle)} cy={ROSE_CENTER + r * Math.sin(angle)} r={2.5} fill="#f59e0b" stroke="white" strokeWidth={0.5} />;
        })()}
      </svg>
    </div>
  );
}
