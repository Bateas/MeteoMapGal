import { useMemo, useState, useEffect } from 'react';
import { Popup } from 'react-map-gl/maplibre';
import type { NormalizedStation, NormalizedReading } from '../../types/station';
import { useWeatherStore } from '../../store/weatherStore';
import {
  formatWindSpeed,
  formatTemperature,
  formatHumidity,
  formatPrecipitation,
  windSpeedColor,
  precipitationColor,
} from '../../services/windUtils';
import { WindCompass } from '../common/WindCompass';
import { SOURCE_CONFIG } from '../../config/sourceConfig';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { loadAemetHistory, filterByStation, filterBySeason, buildWindRose } from '../../services/aemetHistoryParser';
import type { WindRoseData } from '../../types/campo';

// AEMET stations with historical data
const AEMET_HISTORY_STATIONS = ['aemet_1701X', 'aemet_1690A', 'aemet_1700X'];

interface StationPopupProps {
  station: NormalizedStation;
  reading?: NormalizedReading;
}

export function StationPopup({ station, reading }: StationPopupProps) {
  const selectStation = useWeatherStore((s) => s.selectStation);
  const toggleChartStation = useWeatherStore((s) => s.toggleChartStation);
  const chartStations = useWeatherStore((s) => s.chartSelectedStations);
  const isInChart = chartStations.includes(station.id);

  // Mini wind rose for AEMET stations with historical data (lazy-loaded)
  const hasHistory = AEMET_HISTORY_STATIONS.includes(station.id);
  const [windRoseData, setWindRoseData] = useState<WindRoseData | null>(null);
  useEffect(() => {
    if (!hasHistory) return;
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
              background: SOURCE_CONFIG[station.source].color,
              color: 'white',
            }}
          >
            {SOURCE_CONFIG[station.source].fullName}
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
                {reading.precipitation !== null && reading.precipitation > 0 && (
                  <div>
                    <div style={{ color: '#64748b', fontSize: 10, marginBottom: 2 }}>Lluvia</div>
                    <div style={{ fontWeight: 600, color: precipitationColor(reading.precipitation) }}>
                      {formatPrecipitation(reading.precipitation)}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Altitude */}
            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 6 }}>
              Alt: {station.altitude}m
            </div>

            {/* Mini wind rose for AEMET stations */}
            {windRoseData && windRoseData.totalDays > 0 && (
              <MiniWindRose data={windRoseData} />
            )}

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

// ── Mini SVG wind rose for popups ────────────────────────────

import type { WindRoseData } from '../../types/campo';

const ROSE_SIZE = 100;
const ROSE_CENTER = ROSE_SIZE / 2;
const ROSE_RADIUS = 38;

// 16-point cardinal labels with angles
const DIRS_16 = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

function MiniWindRose({ data }: { data: WindRoseData }) {
  const maxPct = Math.max(...data.points.map((p) => p.percentage), 1);

  // Build polygon points
  const polyPoints = data.points.map((p, i) => {
    const angle = ((i * 360) / 16 - 90) * (Math.PI / 180);
    const r = (p.percentage / maxPct) * ROSE_RADIUS;
    const x = ROSE_CENTER + r * Math.cos(angle);
    const y = ROSE_CENTER + r * Math.sin(angle);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  // Label positions (only 4 cardinals for compact display)
  const cardinalLabels = [
    { label: 'N', angle: -90 },
    { label: 'E', angle: 0 },
    { label: 'S', angle: 90 },
    { label: 'W', angle: 180 },
  ];

  return (
    <div style={{ marginTop: 8, borderTop: '1px solid #e2e8f0', paddingTop: 6 }}>
      <div style={{ fontSize: 9, color: '#94a3b8', marginBottom: 4, fontWeight: 600 }}>
        Rosa Vientos (Jun-Sep, {data.totalDays} días)
      </div>
      <svg width={ROSE_SIZE} height={ROSE_SIZE} viewBox={`0 0 ${ROSE_SIZE} ${ROSE_SIZE}`} style={{ display: 'block', margin: '0 auto' }}>
        {/* Grid circles */}
        {[0.33, 0.66, 1].map((f) => (
          <circle
            key={f}
            cx={ROSE_CENTER}
            cy={ROSE_CENTER}
            r={ROSE_RADIUS * f}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth={0.5}
          />
        ))}
        {/* Cross lines */}
        {[0, 45, 90, 135].map((deg) => {
          const rad = (deg - 90) * (Math.PI / 180);
          return (
            <line
              key={deg}
              x1={ROSE_CENTER - ROSE_RADIUS * Math.cos(rad)}
              y1={ROSE_CENTER - ROSE_RADIUS * Math.sin(rad)}
              x2={ROSE_CENTER + ROSE_RADIUS * Math.cos(rad)}
              y2={ROSE_CENTER + ROSE_RADIUS * Math.sin(rad)}
              stroke="#e2e8f0"
              strokeWidth={0.3}
            />
          );
        })}
        {/* Data polygon */}
        <polygon
          points={polyPoints}
          fill="rgba(245, 158, 11, 0.3)"
          stroke="#f59e0b"
          strokeWidth={1.5}
        />
        {/* Cardinal labels */}
        {cardinalLabels.map(({ label, angle }) => {
          const rad = angle * (Math.PI / 180);
          const lx = ROSE_CENTER + (ROSE_RADIUS + 8) * Math.cos(rad);
          const ly = ROSE_CENTER + (ROSE_RADIUS + 8) * Math.sin(rad);
          return (
            <text
              key={label}
              x={lx}
              y={ly}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={8}
              fontWeight={700}
              fill="#64748b"
            >
              {label}
            </text>
          );
        })}
        {/* Dominant direction indicator */}
        {data.points.length > 0 && (() => {
          const dominant = data.points.reduce((a, b) => (b.percentage > a.percentage ? b : a));
          const idx = DIRS_16.indexOf(dominant.direction);
          if (idx < 0) return null;
          const angle = ((idx * 360) / 16 - 90) * (Math.PI / 180);
          const r = (dominant.percentage / maxPct) * ROSE_RADIUS;
          const cx = ROSE_CENTER + r * Math.cos(angle);
          const cy = ROSE_CENTER + r * Math.sin(angle);
          return <circle cx={cx} cy={cy} r={2.5} fill="#f59e0b" stroke="white" strokeWidth={0.5} />;
        })()}
      </svg>
    </div>
  );
}
