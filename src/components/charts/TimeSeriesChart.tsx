import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts';
import { useWeatherStore } from '../../store/weatherStore';
import { useWeatherSelectionStore } from '../../store/weatherSelectionStore';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { msToKnots } from '../../services/windUtils';
import { escapeCSV } from '../../services/csvUtils';
import { useToastStore } from '../../store/toastStore';
import { WeatherIcon } from '../icons/WeatherIcons';
import { fetchReadings, fetchBuoyReadings, type HistoryReading } from '../../api/historyClient';
import type { NormalizedReading } from '../../types/station';

type MetricKey = 'windSpeed' | 'windGust' | 'temperature' | 'humidity' | 'pressure' | 'dewPoint' | 'solarRadiation';

const METRICS: { key: MetricKey; label: string; unit: string; color: string }[] = [
  { key: 'windSpeed', label: 'Viento', unit: 'kt', color: '#3b82f6' },
  { key: 'windGust', label: 'Racha', unit: 'kt', color: '#f97316' },
  { key: 'temperature', label: 'Temp', unit: '°C', color: '#ef4444' },
  { key: 'humidity', label: 'HR', unit: '%', color: '#06b6d4' },
  { key: 'pressure', label: 'Presion', unit: 'hPa', color: '#a78bfa' },
  { key: 'dewPoint', label: 'P. rocio', unit: '°C', color: '#2dd4bf' },
  { key: 'solarRadiation', label: 'Radiacion', unit: 'W/m\u00b2', color: '#fbbf24' },
];

const STATION_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
];

const TIME_RANGES = [
  { label: '3h', hours: 3 },
  { label: '6h', hours: 6 },
  { label: '12h', hours: 12 },
  { label: '24h', hours: 24 },
  { label: '48h', hours: 48 },
];

// ── CSV export helper ─────────────────────────────────────

function downloadCsv(filename: string, csvContent: string) {
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function TimeSeriesChart() {
  const chartStations = useWeatherSelectionStore((s) => s.chartSelectedStations);
  const stations = useWeatherStore((s) => s.stations);
  const readingHistory = useWeatherStore((s) => s.readingHistory);
  const toggleChartStation = useWeatherSelectionStore((s) => s.toggleChartStation);

  const [activeMetric, setActiveMetric] = useState<MetricKey>('windSpeed');
  const [timeRange, setTimeRange] = useState(24);
  const [dbData, setDbData] = useState<Map<string, HistoryReading[]>>(new Map());
  const [, setDbLoading] = useState(false);
  const dbFetchRef = useRef<string>(''); // track last fetch key to avoid duplicate requests

  const metric = METRICS.find((m) => m.key === activeMetric)!;

  // ── Fetch from DB for ranges > 3h (or always for buoys) ───
  const hasBuoys = chartStations.some(id => id.startsWith('buoy_'));
  useEffect(() => {
    // Buoys always need DB fetch (no in-memory data). Stations need DB for >3h.
    const needsDb = hasBuoys || timeRange > 3;
    if (chartStations.length === 0 || !needsDb) {
      setDbData(new Map());
      return;
    }

    const fetchKey = `${chartStations.join(',')}_${timeRange}`;
    if (dbFetchRef.current === fetchKey) return;
    dbFetchRef.current = fetchKey;

    let cancelled = false;
    setDbLoading(true);

    const from = new Date(Date.now() - timeRange * 60 * 60 * 1000).toISOString();
    const to = new Date().toISOString();
    const interval = timeRange > 24 ? 'hourly' as const : 'raw' as const;

    Promise.allSettled(
      chartStations.map(async (stationId) => {
        if (stationId.startsWith('buoy_')) {
          // Buoy: fetch from buoy API and convert to HistoryReading shape
          const buoyId = parseInt(stationId.replace('buoy_', ''), 10);
          const buoyReadings = await fetchBuoyReadings(buoyId, from, to);
          return {
            stationId,
            readings: buoyReadings.map(r => ({
              time: r.time,
              station_id: stationId,
              source: r.source,
              temperature: r.air_temp,
              humidity: r.humidity,
              wind_speed: r.wind_speed,
              wind_gust: r.wind_gust,
              wind_dir: r.wind_dir,
              pressure: r.air_pressure,
              dew_point: r.dew_point,
              precip: null,
              solar_rad: null,
            })) as HistoryReading[],
          };
        }
        // Station: regular fetch
        const readings = await fetchReadings(stationId, from, to, interval);
        return { stationId, readings: readings as HistoryReading[] };
      })
    ).then((results) => {
      if (cancelled) return;
      const newData = new Map<string, HistoryReading[]>();
      for (const r of results) {
        if (r.status === 'fulfilled') {
          newData.set(r.value.stationId, r.value.readings);
        }
      }
      setDbData(newData);
      setDbLoading(false);
    });

    return () => { cancelled = true; };
  }, [chartStations, timeRange]);

  // ── Map DB field to metric key ─────────────────────
  const DB_METRIC_MAP: Record<MetricKey, keyof HistoryReading> = {
    windSpeed: 'wind_speed',
    windGust: 'wind_gust',
    temperature: 'temperature',
    humidity: 'humidity',
    pressure: 'pressure',
    dewPoint: 'dew_point',
    solarRadiation: 'solar_rad',
  };

  // Build chart data: memory for <=3h, DB for >3h
  const chartData = useMemo(() => {
    if (chartStations.length === 0) return [];

    const cutoff = Date.now() - timeRange * 60 * 60 * 1000;
    const timeMap = new Map<number, Record<string, number | null>>();
    const needsKnots = (activeMetric === 'windSpeed' || activeMetric === 'windGust');

    if (timeRange <= 3 && !hasBuoys) {
      // Short range (no buoys): use in-memory readingHistory (5min granularity)
      for (const stationId of chartStations) {
        const history = readingHistory.get(stationId) || [];
        for (const reading of history) {
          if (!reading.timestamp || isNaN(reading.timestamp.getTime())) continue;
          const ts = reading.timestamp.getTime();
          if (ts < cutoff) continue;
          const rounded = Math.round(ts / 300000) * 300000;
          const existing = timeMap.get(rounded) || { time: rounded };
          const rawValue = reading[activeMetric];
          existing[stationId] = needsKnots && rawValue !== null && Number.isFinite(rawValue)
            ? msToKnots(rawValue) : rawValue;
          timeMap.set(rounded, existing);
        }
      }
    } else {
      // Long range: use DB data
      const dbField = DB_METRIC_MAP[activeMetric];
      // For hourly aggregates, field names differ
      const hourlyField = timeRange > 24 ? {
        windSpeed: 'avg_wind', windGust: 'max_gust', temperature: 'avg_temp',
        humidity: 'avg_humidity', pressure: 'avg_pressure', dewPoint: null,
        solarRadiation: null,
      }[activeMetric] : null;

      for (const stationId of chartStations) {
        const readings = dbData.get(stationId) || [];
        for (const r of readings) {
          const ts = new Date(r.time || (r as any).bucket).getTime();
          if (isNaN(ts) || ts < cutoff) continue;
          // For hourly, round to hour; for raw, round to 5min
          const rounded = timeRange > 24
            ? Math.round(ts / 3600000) * 3600000
            : Math.round(ts / 300000) * 300000;
          const existing = timeMap.get(rounded) || { time: rounded };
          const rawValue = (hourlyField ? (r as any)[hourlyField] : (r as any)[dbField]) as number | null;
          existing[stationId] = needsKnots && rawValue !== null && Number.isFinite(rawValue)
            ? msToKnots(rawValue) : rawValue;
          timeMap.set(rounded, existing);
        }
      }

      // Also merge recent in-memory data for the last few minutes (fresher than DB)
      for (const stationId of chartStations) {
        const history = readingHistory.get(stationId) || [];
        for (const reading of history) {
          if (!reading.timestamp || isNaN(reading.timestamp.getTime())) continue;
          const ts = reading.timestamp.getTime();
          // Only merge very recent data (last 30 min) to fill the gap between DB and now
          if (ts < Date.now() - 30 * 60_000) continue;
          const rounded = Math.round(ts / 300000) * 300000;
          const existing = timeMap.get(rounded) || { time: rounded };
          const rawValue = reading[activeMetric];
          existing[stationId] = needsKnots && rawValue !== null && Number.isFinite(rawValue)
            ? msToKnots(rawValue) : rawValue;
          timeMap.set(rounded, existing);
        }
      }
    }

    return Array.from(timeMap.values()).sort(
      (a, b) => (a.time as number) - (b.time as number)
    );
  }, [chartStations, readingHistory, dbData, activeMetric, timeRange]);

  // Station name lookup
  const stationName = (id: string) =>
    stations.find((s) => s.id === id)?.name || id;

  // CSV export — all metrics for selected stations
  const handleExportCsv = useCallback(() => {
    if (chartStations.length === 0) return;

    const cutoff = Date.now() - timeRange * 60 * 60 * 1000;

    // Build per-station headers: Station_Viento, Station_Racha, Station_Temp, Station_Humedad
    const csvMetrics = [
      { key: 'windSpeed' as MetricKey, label: 'Viento(kt)', convert: (v: number) => msToKnots(v) },
      { key: 'windGust' as MetricKey, label: 'Racha(kt)', convert: (v: number) => msToKnots(v) },
      { key: 'temperature' as MetricKey, label: 'Temp(C)', convert: null },
      { key: 'humidity' as MetricKey, label: 'Humedad(%)', convert: null },
    ];
    const headers = ['Fecha', 'Hora'];
    for (const stId of chartStations) {
      const name = stationName(stId);
      for (const m of csvMetrics) headers.push(`${name}_${m.label}`);
    }

    // Collect all timestamps
    const timeSet = new Set<number>();
    for (const stationId of chartStations) {
      const history = readingHistory.get(stationId) || [];
      for (const r of history) {
        if (!r.timestamp || isNaN(r.timestamp.getTime())) continue;
        const ts = r.timestamp.getTime();
        if (ts >= cutoff) timeSet.add(Math.round(ts / 300000) * 300000);
      }
    }
    const sortedTimes = Array.from(timeSet).sort((a, b) => a - b);

    // Build lookup: stationId → timestamp → reading
    const lookup = new Map<string, Map<number, NormalizedReading>>();
    for (const stationId of chartStations) {
      const stMap = new Map<number, NormalizedReading>();
      const history = readingHistory.get(stationId) || [];
      for (const r of history) {
        if (!r.timestamp || isNaN(r.timestamp.getTime())) continue;
        const ts = r.timestamp.getTime();
        if (ts < cutoff) continue;
        stMap.set(Math.round(ts / 300000) * 300000, r);
      }
      lookup.set(stationId, stMap);
    }

    const rows: string[][] = [];
    for (const ts of sortedTimes) {
      const d = new Date(ts);
      const row = [
        format(d, 'dd/MM/yyyy', { locale: es }),
        format(d, 'HH:mm', { locale: es }),
      ];
      for (const stId of chartStations) {
        const reading = lookup.get(stId)?.get(ts);
        for (const m of csvMetrics) {
          const raw = reading?.[m.key] ?? null;
          if (raw !== null && raw !== undefined && Number.isFinite(raw)) {
            row.push((m.convert ? m.convert(raw) : raw).toFixed(1));
          } else {
            row.push('');
          }
        }
      }
      rows.push(row);
    }

    // Escape all fields for CSV injection prevention (OWASP CSV Injection)
    const safeHeaders = headers.map((h) => escapeCSV(h, ';'));
    const safeRows = rows.map((r) => r.map((cell) => escapeCSV(cell, ';')));
    const csv = [
      `# MeteoMapGal — Datos completos — Ultimas ${timeRange}h`,
      safeHeaders.join(';'),
      ...safeRows.map((r) => r.join(';')),
    ].join('\n');

    const date = format(new Date(), 'yyyyMMdd_HHmm');
    downloadCsv(`meteomap_completo_${date}.csv`, csv);
    useToastStore.getState().addToast(`CSV exportado (${rows.length} registros, ${csvMetrics.length} métricas)`, 'success');
  }, [chartStations, readingHistory, timeRange, stationName]);

  if (chartStations.length === 0) {
    return (
      <div className="text-center text-slate-400 text-xs py-6 px-4">
        <div className="mb-2"><WeatherIcon id="activity" size={24} className="mx-auto text-slate-500" /></div>
        <div>Haz click en una estación del mapa</div>
        <div>y pulsa "Añadir a gráfica"</div>
        <div className="mt-1 text-slate-600">para ver la evolución temporal</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Metric selector */}
      <div className="flex gap-1" role="group" aria-label="Seleccionar métrica">
        {METRICS.map((m) => (
          <button
            key={m.key}
            onClick={() => setActiveMetric(m.key)}
            aria-pressed={activeMetric === m.key}
            className={`flex-1 text-[11px] font-semibold py-1.5 rounded transition-colors ${
              activeMetric === m.key
                ? 'bg-slate-700 text-white'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-750'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Time range selector + CSV export */}
      <div className="flex gap-1" role="group" aria-label="Seleccionar rango temporal">
        {TIME_RANGES.map((r) => (
          <button
            key={r.hours}
            onClick={() => setTimeRange(r.hours)}
            aria-pressed={timeRange === r.hours}
            className={`flex-1 text-[11px] py-1 rounded transition-colors ${
              timeRange === r.hours
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-500 hover:bg-slate-750'
            }`}
          >
            {r.label}
          </button>
        ))}
        <button
          onClick={handleExportCsv}
          disabled={chartData.length === 0}
          className="inline-flex items-center gap-1 px-2 text-[11px] py-1 rounded bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-emerald-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="Exportar datos a CSV"
        >
          <WeatherIcon id="download" size={12} /> CSV
        </button>
      </div>

      {/* Chart */}
      <div className="bg-slate-800/50 rounded-lg p-2">
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                dataKey="time"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(ts) => format(new Date(ts), 'HH:mm', { locale: es })}
                stroke="#64748b"
                fontSize={10}
              />
              <YAxis
                stroke="#64748b"
                fontSize={10}
                unit={metric.unit}
                width={45}
              />
              <Tooltip
                contentStyle={{
                  background: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: 6,
                  fontSize: 11,
                }}
                labelFormatter={(ts) =>
                  format(new Date(ts as number), 'dd/MM HH:mm', { locale: es })
                }
                formatter={(value: number | string, name: string) => [
                  value != null ? `${Number(value).toFixed(1)} ${metric.unit}` : '--',
                  stationName(name),
                ]}
              />
              <Legend
                formatter={(value) => (
                  <span style={{ fontSize: 10 }}>{stationName(value)}</span>
                )}
              />
              {chartStations.map((stationId, i) => {
                const color = STATION_COLORS[i % STATION_COLORS.length];
                const showDots = chartData.length < 12;
                return (
                  <Line
                    key={stationId}
                    dataKey={stationId}
                    name={stationId}
                    stroke={color}
                    strokeWidth={2}
                    dot={showDots ? { r: 3, fill: color, strokeWidth: 0 } : false}
                    activeDot={{ r: 5, fill: color }}
                    connectNulls={false}
                    type="monotone"
                    isAnimationActive={false}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="text-center text-slate-400 text-xs py-8">
            Esperando datos históricos...
            <div className="text-slate-600 mt-1">
              Los datos se acumulan con cada refresco (cada 10 min)
            </div>
          </div>
        )}
      </div>

      {/* Wind Rose — computed from selected stations' reading history */}
      {(activeMetric === 'windSpeed' || activeMetric === 'windGust') && chartStations.length > 0 && (
        <WindRoseFromHistory
          stationIds={chartStations}
          readingHistory={readingHistory}
          stationName={stationName}
          timeRange={timeRange}
        />
      )}

      {/* Selected stations chips */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Estaciones seleccionadas">
        {chartStations.map((id, i) => (
          <button
            key={id}
            onClick={() => toggleChartStation(id)}
            aria-label={`Quitar ${stationName(id)} de la gráfica`}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: STATION_COLORS[i % STATION_COLORS.length] }}
            />
            {stationName(id)}
            <span className="text-slate-500 ml-0.5">✕</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Wind Rose from in-memory reading history ────────────
const DIRECTIONS_16 = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

function WindRoseFromHistory({ stationIds, readingHistory, stationName, timeRange }: {
  stationIds: string[];
  readingHistory: Map<string, NormalizedReading[]>;
  stationName: (id: string) => string;
  timeRange: number;
}) {
  // Compute per-station rose data
  const perStationData = useMemo(() => {
    const cutoff = Date.now() - timeRange * 60 * 60 * 1000;
    const result: { id: string; name: string; color: string; data: number[] }[] = [];

    for (let si = 0; si < stationIds.length; si++) {
      const stId = stationIds[si];
      const dirCounts = new Array(16).fill(0);
      let total = 0;

      const history = readingHistory.get(stId) || [];
      for (const r of history) {
        if (!r.timestamp || r.timestamp.getTime() < cutoff) continue;
        if (r.windDirection == null || r.windSpeed == null || r.windSpeed < 0.3) continue;
        const idx = Math.round(r.windDirection / 22.5) % 16;
        dirCounts[idx]++;
        total++;
      }

      if (total > 0) {
        result.push({
          id: stId,
          name: stationName(stId),
          color: STATION_COLORS[si % STATION_COLORS.length],
          data: dirCounts.map(c => Math.round((c / total) * 100)),
        });
      }
    }
    return result;
  }, [stationIds, readingHistory, timeRange, stationName]);

  if (perStationData.length === 0) return null;

  // Build chart data: each direction has a percentage per station
  const chartData = DIRECTIONS_16.map((dir, i) => {
    const point: Record<string, string | number> = { direction: dir };
    for (const st of perStationData) {
      point[st.id] = st.data[i];
    }
    return point;
  });

  const maxPct = Math.max(...perStationData.flatMap(s => s.data), 1);

  return (
    <div className="bg-slate-800/50 rounded-lg p-2">
      <div className="text-[11px] text-slate-400 text-center mb-1 font-semibold">
        Rosa de vientos
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <RadarChart data={chartData}>
          <PolarGrid stroke="#334155" />
          <PolarAngleAxis dataKey="direction" tick={{ fill: '#94a3b8', fontSize: 9 }} />
          <PolarRadiusAxis tick={{ fill: '#64748b', fontSize: 8 }} tickCount={4} domain={[0, Math.ceil(maxPct / 10) * 10]} />
          {perStationData.map((st) => (
            <Radar
              key={st.id}
              name={st.name}
              dataKey={st.id}
              stroke={st.color}
              fill={st.color}
              fillOpacity={0.15}
              strokeWidth={2}
              isAnimationActive={false}
            />
          ))}
          <Tooltip
            contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 6, fontSize: 10 }}
            formatter={(value: number, name: string) => {
              const st = perStationData.find(s => s.id === name);
              return [`${value}%`, st?.name ?? name];
            }}
          />
        </RadarChart>
      </ResponsiveContainer>
      {/* Legend */}
      <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
        {perStationData.map((st) => (
          <span key={st.id} className="flex items-center gap-1 text-[11px] text-slate-400">
            <span className="w-2 h-2 rounded-full" style={{ background: st.color }} />
            {st.name}
          </span>
        ))}
      </div>
    </div>
  );
}
