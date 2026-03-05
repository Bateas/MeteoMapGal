import { useMemo, useState, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { useWeatherStore } from '../../store/weatherStore';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { msToKnots } from '../../services/windUtils';
import { escapeCSV } from '../../services/csvUtils';
import { useToastStore } from '../../store/toastStore';
import { WeatherIcon } from '../icons/WeatherIcons';

type MetricKey = 'windSpeed' | 'temperature' | 'humidity';

const METRICS: { key: MetricKey; label: string; unit: string; color: string }[] = [
  { key: 'windSpeed', label: 'Viento', unit: 'kt', color: '#3b82f6' },
  { key: 'temperature', label: 'Temperatura', unit: '°C', color: '#ef4444' },
  { key: 'humidity', label: 'Humedad', unit: '%', color: '#06b6d4' },
];

const STATION_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
];

const TIME_RANGES = [
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
  const chartStations = useWeatherStore((s) => s.chartSelectedStations);
  const stations = useWeatherStore((s) => s.stations);
  const readingHistory = useWeatherStore((s) => s.readingHistory);
  const toggleChartStation = useWeatherStore((s) => s.toggleChartStation);

  const [activeMetric, setActiveMetric] = useState<MetricKey>('windSpeed');
  const [timeRange, setTimeRange] = useState(24);

  const metric = METRICS.find((m) => m.key === activeMetric)!;

  // Build chart data: merge all station histories into time-aligned points
  const chartData = useMemo(() => {
    if (chartStations.length === 0) return [];

    const cutoff = Date.now() - timeRange * 60 * 60 * 1000;
    const timeMap = new Map<number, Record<string, number | null>>();

    for (const stationId of chartStations) {
      const history = readingHistory.get(stationId) || [];
      for (const reading of history) {
        if (!reading.timestamp || isNaN(reading.timestamp.getTime())) continue;
        const ts = reading.timestamp.getTime();
        if (ts < cutoff) continue;

        // Round to nearest 5 minutes for alignment
        const rounded = Math.round(ts / 300000) * 300000;
        const existing = timeMap.get(rounded) || { time: rounded };
        const rawValue = reading[activeMetric];
        // Convert wind speed from m/s to knots for display (guard NaN/Infinity)
        existing[stationId] = activeMetric === 'windSpeed' && rawValue !== null && Number.isFinite(rawValue)
          ? msToKnots(rawValue)
          : rawValue;
        timeMap.set(rounded, existing);
      }
    }

    return Array.from(timeMap.values()).sort(
      (a, b) => (a.time as number) - (b.time as number)
    );
  }, [chartStations, readingHistory, activeMetric, timeRange]);

  // Station name lookup
  const stationName = (id: string) =>
    stations.find((s) => s.id === id)?.name || id;

  // CSV export
  const handleExportCsv = useCallback(() => {
    if (chartStations.length === 0) return;

    const cutoff = Date.now() - timeRange * 60 * 60 * 1000;
    const headers = ['Fecha', 'Hora', ...chartStations.map(stationName)];
    const rows: string[][] = [];

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

    // Build value lookup
    const lookup = new Map<string, Map<number, number | null>>();
    for (const stationId of chartStations) {
      const stMap = new Map<number, number | null>();
      const history = readingHistory.get(stationId) || [];
      for (const r of history) {
        if (!r.timestamp || isNaN(r.timestamp.getTime())) continue;
        const ts = r.timestamp.getTime();
        if (ts < cutoff) continue;
        const rounded = Math.round(ts / 300000) * 300000;
        const raw = r[activeMetric];
        stMap.set(rounded, activeMetric === 'windSpeed' && raw !== null && Number.isFinite(raw) ? msToKnots(raw) : raw);
      }
      lookup.set(stationId, stMap);
    }

    for (const ts of sortedTimes) {
      const d = new Date(ts);
      const row = [
        format(d, 'dd/MM/yyyy', { locale: es }),
        format(d, 'HH:mm', { locale: es }),
        ...chartStations.map((id) => {
          const val = lookup.get(id)?.get(ts);
          return val !== null && val !== undefined ? val.toFixed(1) : '';
        }),
      ];
      rows.push(row);
    }

    const unit = metric.unit;
    // Escape all fields for CSV injection prevention (OWASP CSV Injection)
    const safeHeaders = headers.map((h) => escapeCSV(h, ';'));
    const safeRows = rows.map((r) => r.map((cell) => escapeCSV(cell, ';')));
    const csv = [
      `# MeteoMap — ${metric.label} (${unit}) — Últimas ${timeRange}h`,
      safeHeaders.join(';'),
      ...safeRows.map((r) => r.join(';')),
    ].join('\n');

    const date = format(new Date(), 'yyyyMMdd_HHmm');
    downloadCsv(`meteomap_${activeMetric}_${date}.csv`, csv);
    useToastStore.getState().addToast(`CSV exportado (${rows.length} registros)`, 'success');
  }, [chartStations, readingHistory, activeMetric, timeRange, metric, stationName]);

  if (chartStations.length === 0) {
    return (
      <div className="text-center text-slate-500 text-xs py-6 px-4">
        <div className="text-lg mb-2">📊</div>
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
            className={`flex-1 text-[10px] font-semibold py-1.5 rounded transition-colors ${
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
            className={`flex-1 text-[10px] py-1 rounded transition-colors ${
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
          className="inline-flex items-center gap-1 px-2 text-[10px] py-1 rounded bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-emerald-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
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
                    connectNulls
                    type="monotone"
                    isAnimationActive={false}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="text-center text-slate-500 text-xs py-8">
            Esperando datos históricos...
            <div className="text-slate-600 mt-1">
              Los datos se acumulan con cada refresco (cada 10 min)
            </div>
          </div>
        )}
      </div>

      {/* Selected stations chips */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Estaciones seleccionadas">
        {chartStations.map((id, i) => (
          <button
            key={id}
            onClick={() => toggleChartStation(id)}
            aria-label={`Quitar ${stationName(id)} de la gráfica`}
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
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
