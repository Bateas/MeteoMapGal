/**
 * HistoryDashboard — Historical data explorer.
 *
 * Queries TimescaleDB via the History API and displays
 * time series charts with station selector, date range,
 * metric toggle, wind rose, and station comparison.
 * Available in both sectors.
 */

import { memo, useState, useEffect, useCallback, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { WeatherIcon } from '../icons/WeatherIcons';
import {
  fetchHistoryStations,
  fetchReadings,
  fetchCompare,
  fetchStationStats,
  fetchHealth,
  type HistoryStation,
  type HistoryReading,
  type HourlyReading,
  type StationStats,
  type HealthInfo,
} from '../../api/historyClient';
import { WindRoseHistorical } from '../charts/WindRoseHistorical';
import { msToKnots } from '../../services/windUtils';
import { useWeatherStore } from '../../store/weatherStore';
import { useWeatherSelectionStore } from '../../store/weatherSelectionStore';

// ── Constants ──────────────────────────────────────────

type Metric = 'temperature' | 'wind_speed' | 'humidity' | 'pressure';
type TimeRange = '24h' | '7d' | '30d' | 'custom';
type Interval = 'raw' | 'hourly';
type ViewMode = 'chart' | 'windrose';

const METRICS: { key: Metric; label: string; unit: string; color: string }[] = [
  { key: 'temperature', label: 'Temp', unit: '°C', color: '#ef4444' },
  { key: 'wind_speed', label: 'Viento', unit: 'kt', color: '#3b82f6' },
  { key: 'humidity', label: 'HR', unit: '%', color: '#22c55e' },
  { key: 'pressure', label: 'Presión', unit: 'hPa', color: '#a855f7' },
];

const TIME_RANGES: { key: TimeRange; label: string; hours: number }[] = [
  { key: '24h', label: '24h', hours: 24 },
  { key: '7d', label: '7d', hours: 168 },
  { key: '30d', label: '30d', hours: 720 },
];

const COMPARE_COLOR = '#f59e0b'; // amber-500 for second station

/** Format timestamp for chart X axis */
function formatTime(time: string, range: TimeRange): string {
  const d = new Date(time);
  if (range === '24h') return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  if (range === '7d') return d.toLocaleDateString('es', { weekday: 'short', hour: '2-digit' });
  if (range === 'custom') return d.toLocaleDateString('es', { day: 'numeric', month: 'short', hour: '2-digit' });
  return d.toLocaleDateString('es', { day: 'numeric', month: 'short' });
}

/** Extract metric value from a reading, converting wind to knots */
function getMetricValue(
  reading: HistoryReading | HourlyReading,
  metric: Metric
): number | null {
  let val: number | null = null;

  if ('bucket' in reading) {
    const r = reading as HourlyReading;
    switch (metric) {
      case 'temperature': val = r.avg_temp; break;
      case 'wind_speed': val = r.avg_wind; break;
      case 'humidity': val = r.avg_humidity; break;
      case 'pressure': val = r.avg_pressure; break;
    }
  } else {
    const r = reading as HistoryReading;
    switch (metric) {
      case 'temperature': val = r.temperature; break;
      case 'wind_speed': val = r.wind_speed; break;
      case 'humidity': val = r.humidity; break;
      case 'pressure': val = r.pressure; break;
    }
  }

  if (val == null) return null;
  if (metric === 'wind_speed') return Math.round(msToKnots(val) * 10) / 10;
  return Math.round(val * 10) / 10;
}

// ── Constants ─────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  aemet: 'AEMET', meteogalicia: 'MG', meteoclimatic: 'MC',
  wunderground: 'WU', netatmo: 'NT', skyx: 'SkyX',
};

// ── Component ──────────────────────────────────────────

export const HistoryDashboard = memo(function HistoryDashboard() {
  // Core state
  const [stations, setStations] = useState<HistoryStation[]>([]);
  const [selectedStation, setSelectedStation] = useState('');
  const [metric, setMetric] = useState<Metric>('temperature');
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [viewMode, setViewMode] = useState<ViewMode>('chart');
  const [readings, setReadings] = useState<(HistoryReading | HourlyReading)[]>([]);
  const [stats, setStats] = useState<StationStats | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Custom date range
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 3);
    return d.toISOString().slice(0, 10);
  });
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10));

  // Comparison state
  const [compareMode, setCompareMode] = useState(false);
  const [compareStation, setCompareStation] = useState('');
  const [compareReadings, setCompareReadings] = useState<(HistoryReading | HourlyReading)[]>([]);

  // Wind rose raw readings (fetched separately when needed)
  const [windRoseReadings, setWindRoseReadings] = useState<HistoryReading[]>([]);
  const [windRoseLoading, setWindRoseLoading] = useState(false);

  // Map station IDs → human names from live weatherStore
  const liveStations = useWeatherStore((s) => s.stations);
  const selectStation = useWeatherSelectionStore((s) => s.selectStation);
  const stationInfo = useMemo(() => {
    const map = new Map<string, { name: string; source: string }>();
    for (const s of liveStations) {
      map.set(s.id, { name: s.name, source: s.source });
    }
    return map;
  }, [liveStations]);

  // Backwards-compat: plain name map for selectors
  const stationNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const [id, info] of stationInfo) map.set(id, info.name);
    return map;
  }, [stationInfo]);

  /** Friendly station name with source label */
  const stationName = useCallback(
    (id: string) => {
      const info = stationInfo.get(id);
      if (!info) return id;
      const srcLabel = SOURCE_LABELS[info.source] ?? info.source;
      return `${info.name} (${srcLabel})`;
    },
    [stationInfo]
  );

  // Determine interval: raw for 24h, hourly for longer ranges
  const interval: Interval = useMemo(() => {
    if (timeRange === '24h') return 'raw';
    if (timeRange === 'custom') {
      const diffMs = new Date(customTo).getTime() - new Date(customFrom).getTime();
      return diffMs <= 2 * 86400_000 ? 'raw' : 'hourly'; // raw if ≤2 days
    }
    return 'hourly';
  }, [timeRange, customFrom, customTo]);

  // ── Fetch station list on mount ──────────────────
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [stationList, healthData] = await Promise.all([
          fetchHistoryStations(),
          fetchHealth(),
        ]);
        if (cancelled) return;

        setStations(stationList);
        setHealth(healthData);

        if (!selectedStation && stationList.length > 0) {
          const aemet = stationList.find((s) => s.source === 'aemet');
          setSelectedStation(aemet?.station_id ?? stationList[0].station_id);
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
          console.warn('[HistoryDashboard] Station fetch failed:', (err as Error).message);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch readings when station/range changes ────
  const fetchData = useCallback(async () => {
    if (!selectedStation) return;

    setLoading(true);
    setError(null);

    try {
      let from: string, to: string;
      if (timeRange === 'custom') {
        from = new Date(customFrom + 'T00:00:00').toISOString();
        to = new Date(customTo + 'T23:59:59').toISOString();
      } else {
        const range = TIME_RANGES.find((r) => r.key === timeRange)!;
        from = new Date(Date.now() - range.hours * 3600_000).toISOString();
        to = new Date().toISOString();
      }

      // Parallel fetches
      const promises: Promise<any>[] = [
        fetchReadings(selectedStation, from, to, interval),
        fetchStationStats(selectedStation, from, to),
      ];

      // If comparison mode, also fetch compare station
      if (compareMode && compareStation && compareStation !== selectedStation) {
        promises.push(fetchCompare([selectedStation, compareStation], from, to, interval));
      }

      const results = await Promise.all(promises);

      setReadings(results[0]);
      setStats(results[1]);

      // Extract compare readings (filter to only compareStation)
      if (compareMode && compareStation && results[2]) {
        const allCompare = results[2] as (HistoryReading | HourlyReading)[];
        const compareOnly = allCompare.filter((r) => {
          const sid = 'bucket' in r ? (r as HourlyReading).station_id : (r as HistoryReading).station_id;
          return sid === compareStation;
        });
        setCompareReadings(compareOnly);
      } else {
        setCompareReadings([]);
      }
    } catch (err) {
      setError((err as Error).message);
      console.warn('[HistoryDashboard] Data fetch failed:', (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selectedStation, compareStation, compareMode, timeRange, interval, customFrom, customTo]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Fetch raw wind data for wind rose ────────────
  useEffect(() => {
    if (viewMode !== 'windrose' || !selectedStation) {
      setWindRoseReadings([]);
      return;
    }

    let cancelled = false;

    async function loadWindRose() {
      setWindRoseLoading(true);
      try {
        const range = TIME_RANGES.find((r) => r.key === timeRange)!;
        const from = new Date(Date.now() - range.hours * 3600_000).toISOString();
        const to = new Date().toISOString();
        // Always fetch raw for wind rose (need wind_dir)
        const data = await fetchReadings(selectedStation, from, to, 'raw');
        if (!cancelled) {
          setWindRoseReadings(data as HistoryReading[]);
        }
      } catch (err) {
        console.warn('[HistoryDashboard] Wind rose fetch failed:', (err as Error).message);
        if (!cancelled) setWindRoseReadings([]);
      } finally {
        if (!cancelled) setWindRoseLoading(false);
      }
    }

    loadWindRose();
    return () => { cancelled = true; };
  }, [viewMode, selectedStation, timeRange]);

  // ── Chart data (primary station) ──────────────────
  const chartData = useMemo(() => {
    if (compareMode && compareReadings.length > 0) {
      // Build merged time series with both stations
      const primaryMap = new Map<string, number | null>();
      const compareMap = new Map<string, number | null>();
      const allTimes: string[] = [];

      for (const r of readings) {
        const time = 'bucket' in r ? (r as HourlyReading).bucket : (r as HistoryReading).time;
        const formatted = formatTime(time, timeRange);
        primaryMap.set(formatted, getMetricValue(r, metric));
        allTimes.push(formatted);
      }

      for (const r of compareReadings) {
        const time = 'bucket' in r ? (r as HourlyReading).bucket : (r as HistoryReading).time;
        const formatted = formatTime(time, timeRange);
        compareMap.set(formatted, getMetricValue(r, metric));
        if (!primaryMap.has(formatted)) allTimes.push(formatted);
      }

      return allTimes
        .map((time) => ({
          time,
          value: primaryMap.get(time) ?? null,
          compare: compareMap.get(time) ?? null,
        }))
        .filter((d) => d.value != null || d.compare != null);
    }

    // Single station mode
    return readings
      .map((r) => {
        const time = 'bucket' in r ? (r as HourlyReading).bucket : (r as HistoryReading).time;
        const value = getMetricValue(r, metric);
        return {
          time: formatTime(time, timeRange),
          rawTime: time,
          value,
        };
      })
      .filter((d) => d.value != null);
  }, [readings, compareReadings, compareMode, metric, timeRange]);

  // ── Current metric config ────────────────────────
  const currentMetric = METRICS.find((m) => m.key === metric)!;

  // ── Group stations by source for dropdown ────────
  const stationsBySource = useMemo(() => {
    const groups: Record<string, HistoryStation[]> = {};
    for (const s of stations) {
      (groups[s.source] ??= []).push(s);
    }
    return groups;
  }, [stations]);

  // ── Render ───────────────────────────────────────

  return (
    <div className="space-y-3">
      {/* Header + health status */}
      <div className="rounded-lg border border-amber-600/30 bg-amber-900/20 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2">
            <WeatherIcon id="database" size={15} className="text-amber-400" />
            <span className="text-[11px] font-bold text-amber-300">Historial meteorológico</span>
          </div>
          {health && (
            <span className="text-[9px] text-slate-500">
              {(health.total_readings / 1000).toFixed(1)}k lecturas
            </span>
          )}
        </div>

        {/* Station selector */}
        <div className="px-3 pb-2">
          <select
            value={selectedStation}
            onChange={(e) => {
              setSelectedStation(e.target.value);
              selectStation(e.target.value);
            }}
            className="w-full bg-slate-800 text-slate-200 text-[10px] rounded px-2 py-1.5 border border-slate-700 focus:border-amber-500/50 focus:outline-none"
          >
            {Object.entries(stationsBySource).map(([source, stns]) => (
              <optgroup key={source} label={source.toUpperCase()}>
                {stns.map((s) => {
                  const name = stationNames.get(s.station_id);
                  const srcLabel = SOURCE_LABELS[s.source] ?? s.source;
                  return (
                    <option key={s.station_id} value={s.station_id}>
                      {name ? `${name} (${srcLabel})` : s.station_id} — {s.reading_count.toLocaleString()} lecturas
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Compare toggle + second station */}
        <div className="px-3 pb-2">
          <button
            onClick={() => {
              setCompareMode(!compareMode);
              if (compareMode) {
                setCompareStation('');
                setCompareReadings([]);
              }
            }}
            className={`w-full text-[9px] font-semibold py-1 rounded transition-colors ${
              compareMode
                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                : 'bg-slate-800/40 text-slate-500 border border-slate-700/50 hover:text-slate-300'
            }`}
          >
            {compareMode ? '✕ Quitar comparación' : '⊕ Comparar estaciones'}
          </button>

          {compareMode && (
            <select
              value={compareStation}
              onChange={(e) => setCompareStation(e.target.value)}
              className="w-full mt-1 bg-slate-800 text-amber-300 text-[10px] rounded px-2 py-1.5 border border-amber-500/30 focus:border-amber-500/50 focus:outline-none"
            >
              <option value="">Seleccionar 2ª estación...</option>
              {Object.entries(stationsBySource).map(([source, stns]) => (
                <optgroup key={source} label={source.toUpperCase()}>
                  {stns
                    .filter((s) => s.station_id !== selectedStation)
                    .map((s) => {
                      const name = stationNames.get(s.station_id);
                      const srcLabel = SOURCE_LABELS[s.source] ?? s.source;
                      return (
                        <option key={s.station_id} value={s.station_id}>
                          {name ? `${name} (${srcLabel})` : s.station_id}
                        </option>
                      );
                    })}
                </optgroup>
              ))}
            </select>
          )}
        </div>

        {/* Time range buttons */}
        <div className="flex gap-1 px-3 pb-2">
          {TIME_RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setTimeRange(r.key)}
              className={`flex-1 text-[10px] font-bold py-1 rounded transition-colors ${
                timeRange === r.key
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'bg-slate-800/60 text-slate-500 border border-slate-700/50 hover:text-slate-300'
              }`}
            >
              {r.label}
            </button>
          ))}
          <button
            onClick={() => setTimeRange('custom')}
            className={`flex-1 text-[10px] font-bold py-1 rounded transition-colors ${
              timeRange === 'custom'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                : 'bg-slate-800/60 text-slate-500 border border-slate-700/50 hover:text-slate-300'
            }`}
          >
            Rango
          </button>
          <span className="text-[8px] text-slate-600 self-center ml-1">
            {interval === 'hourly' ? 'horario' : '5min'}
          </span>
        </div>

        {/* Custom date range picker */}
        {timeRange === 'custom' && (
          <div className="flex gap-1.5 px-3 pb-2 items-center">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="flex-1 bg-slate-800 text-slate-200 text-[10px] rounded px-1.5 py-1 border border-slate-700 focus:border-amber-500/50 focus:outline-none"
            />
            <span className="text-[9px] text-slate-500">→</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="flex-1 bg-slate-800 text-slate-200 text-[10px] rounded px-1.5 py-1 border border-slate-700 focus:border-amber-500/50 focus:outline-none"
            />
          </div>
        )}

        {/* Metric toggle + Wind Rose button */}
        <div className="flex gap-1 px-3 pb-2">
          {METRICS.map((m) => (
            <button
              key={m.key}
              onClick={() => {
                setMetric(m.key);
                setViewMode('chart');
              }}
              className={`flex-1 text-[9px] font-semibold py-1 rounded transition-colors ${
                metric === m.key && viewMode === 'chart'
                  ? 'text-white border'
                  : 'bg-slate-800/40 text-slate-500 border border-transparent hover:text-slate-300'
              }`}
              style={
                metric === m.key && viewMode === 'chart'
                  ? { borderColor: m.color + '60', backgroundColor: m.color + '15', color: m.color }
                  : undefined
              }
            >
              {m.label}
            </button>
          ))}

          {/* Wind Rose toggle */}
          <button
            onClick={() => setViewMode(viewMode === 'windrose' ? 'chart' : 'windrose')}
            className={`flex-1 text-[9px] font-semibold py-1 rounded transition-colors ${
              viewMode === 'windrose'
                ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
                : 'bg-slate-800/40 text-slate-500 border border-transparent hover:text-slate-300'
            }`}
          >
            Rosa
          </button>
        </div>
      </div>

      {/* Chart / Wind Rose */}
      <div className="rounded-lg border border-slate-700/50 bg-slate-900/50 p-2">
        {viewMode === 'windrose' ? (
          // ── Wind Rose view ──
          windRoseLoading ? (
            <div className="flex items-center justify-center h-[260px] text-slate-500 text-[10px]">
              <WeatherIcon id="wind" size={14} className="animate-pulse mr-2" />
              Cargando rosa de vientos...
            </div>
          ) : (
            <WindRoseHistorical
              readings={windRoseReadings}
              size={260}
            />
          )
        ) : (
          // ── Line chart view ──
          <>
            {loading && (
              <div className="flex items-center justify-center h-[180px] text-slate-500 text-[10px]">
                <WeatherIcon id="clock" size={14} className="animate-pulse mr-2" />
                Cargando datos...
              </div>
            )}

            {error && !loading && (
              <div className="flex items-center justify-center h-[180px] text-red-400 text-[10px]">
                <WeatherIcon id="alert-triangle" size={14} className="mr-2" />
                {error}
              </div>
            )}

            {!loading && !error && chartData.length === 0 && (
              <div className="flex items-center justify-center h-[180px] text-slate-500 text-[10px]">
                Sin datos para este rango
              </div>
            )}

            {!loading && !error && chartData.length > 0 && (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 8, fill: '#64748b' }}
                    interval="preserveStartEnd"
                    tickCount={6}
                  />
                  <YAxis
                    tick={{ fontSize: 8, fill: '#64748b' }}
                    domain={['auto', 'auto']}
                    width={40}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1e293b',
                      border: '1px solid #334155',
                      borderRadius: '6px',
                      fontSize: '10px',
                    }}
                    labelStyle={{ color: '#94a3b8', fontSize: '9px' }}
                    formatter={(value: number | string | undefined, name: string) => {
                      if (name === 'compare') {
                        return [`${value} ${currentMetric.unit}`, stationName(compareStation)];
                      }
                      return [`${value} ${currentMetric.unit}`, stationName(selectedStation)];
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke={currentMetric.color}
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={{ r: 3, fill: currentMetric.color }}
                    name={currentMetric.label}
                  />
                  {compareMode && compareStation && (
                    <Line
                      type="monotone"
                      dataKey="compare"
                      stroke={COMPARE_COLOR}
                      strokeWidth={1.5}
                      dot={false}
                      activeDot={{ r: 3, fill: COMPARE_COLOR }}
                      name="compare"
                      strokeDasharray="4 2"
                    />
                  )}
                  {compareMode && compareStation && (
                    <Legend
                      wrapperStyle={{ fontSize: '9px' }}
                      formatter={(value) => {
                        if (value === 'compare') return stationName(compareStation);
                        return stationName(selectedStation);
                      }}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            )}
          </>
        )}
      </div>

      {/* Compare legend (when wind rose + compare are both on) */}
      {viewMode === 'windrose' && compareMode && compareStation && (
        <div className="text-center text-[9px] text-slate-500">
          Rosa de vientos solo muestra la estación principal
        </div>
      )}

      {/* Stats summary */}
      {stats && !loading && viewMode === 'chart' && (
        <div className="rounded-lg border border-slate-700/50 bg-slate-900/50">
          <div className="grid grid-cols-4 gap-px bg-slate-700/30">
            <StatCell
              label="Lecturas"
              value={stats.count.toLocaleString()}
            />
            <StatCell
              label="T media"
              value={stats.avg_temp != null ? `${stats.avg_temp}°C` : '—'}
            />
            <StatCell
              label="T rango"
              value={
                stats.min_temp != null && stats.max_temp != null
                  ? `${stats.min_temp}–${stats.max_temp}°C`
                  : '—'
              }
            />
            <StatCell
              label="Ráfaga máx"
              value={
                stats.max_gust != null
                  ? `${Math.round(msToKnots(stats.max_gust))} kt`
                  : '—'
              }
            />
          </div>
          <div className="grid grid-cols-4 gap-px bg-slate-700/30">
            <StatCell
              label="HR media"
              value={stats.avg_humidity != null ? `${stats.avg_humidity}%` : '—'}
            />
            <StatCell
              label="Viento medio"
              value={
                stats.avg_wind != null
                  ? `${Math.round(msToKnots(stats.avg_wind * 10)) / 10} kt`
                  : '—'
              }
            />
            <StatCell
              label="Presión"
              value={stats.avg_pressure != null ? `${stats.avg_pressure} hPa` : '—'}
            />
            <StatCell
              label="Precip"
              value={stats.total_precip != null ? `${stats.total_precip} mm` : '—'}
            />
          </div>
        </div>
      )}

      {/* Refresh button */}
      <button
        onClick={fetchData}
        disabled={loading || !selectedStation}
        className="w-full text-[10px] font-semibold py-1.5 rounded bg-slate-800 text-slate-400 border border-slate-700/50 hover:text-slate-200 hover:border-amber-500/30 transition-colors disabled:opacity-40"
      >
        {loading ? 'Actualizando...' : 'Actualizar datos'}
      </button>
    </div>
  );
});

// ── Sub-components ─────────────────────────────────────

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-900/80 px-2 py-1.5 text-center">
      <div className="text-[8px] text-slate-500 uppercase tracking-wider">{label}</div>
      <div className="text-[10px] font-bold text-slate-200 mt-0.5">{value}</div>
    </div>
  );
}
