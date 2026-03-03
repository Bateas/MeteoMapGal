import { useState, useCallback } from 'react';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { fetchHistoricalData, type HourlyDataPoint } from '../../api/openMeteoHistorical';
import { degreesToCardinal } from '../../services/windUtils';
import { MAP_CENTER } from '../../config/constants';

const CARDINALS_ORDERED = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

interface WindRosePoint {
  direction: string;
  frequency: number;
  filteredFrequency: number;
}

interface HeatmapCell {
  hour: number;
  direction: string;
  count: number;
  frequency: number;
}

interface ScatterPoint {
  temperature: number;
  windSpeed: number;
}

type AnalysisState = 'idle' | 'loading' | 'loaded' | 'error';

export function HistoricalAnalysis() {
  const [state, setState] = useState<AnalysisState>('idle');
  const [data, setData] = useState<HourlyDataPoint[]>([]);
  const [error, setError] = useState('');

  // Filters
  const [minTemp, setMinTemp] = useState(28);
  const [minHumidity, setMinHumidity] = useState(60);
  const [yearRange, setYearRange] = useState<'all' | '2024' | '2023' | '2022'>('all');

  const loadData = useCallback(async () => {
    setState('loading');
    setError('');

    try {
      const now = new Date();
      const periods: { start: string; end: string }[] = [];

      // Fetch Jun-Sep for available years
      for (let year = 2022; year <= now.getFullYear(); year++) {
        if (yearRange !== 'all' && year !== parseInt(yearRange)) continue;

        const start = `${year}-06-01`;
        const endDate = new Date(`${year}-09-30`);
        const end = endDate > now ? now.toISOString().split('T')[0] : `${year}-09-30`;

        if (new Date(start) <= now) {
          periods.push({ start, end });
        }
      }

      let allPoints: HourlyDataPoint[] = [];
      for (const period of periods) {
        const points = await fetchHistoricalData(
          MAP_CENTER[1], MAP_CENTER[0], // lat, lon
          period.start, period.end
        );
        allPoints = allPoints.concat(points);
      }

      setData(allPoints);
      setState('loaded');
    } catch (err) {
      setError(String(err));
      setState('error');
    }
  }, [yearRange]);

  // ── Computed data ────────────────────────────────────

  // Wind rose: all data vs filtered (T>minTemp, HR>minHumidity)
  const windRoseData: WindRosePoint[] = (() => {
    if (data.length === 0) return [];

    const allCounts: Record<string, number> = {};
    const filteredCounts: Record<string, number> = {};
    let allTotal = 0;
    let filteredTotal = 0;

    for (const p of data) {
      if (p.windDirection === null) continue;
      const dir = degreesToCardinal(p.windDirection);
      allCounts[dir] = (allCounts[dir] || 0) + 1;
      allTotal++;

      if (p.temperature !== null && p.humidity !== null &&
        p.temperature >= minTemp && p.humidity >= minHumidity) {
        filteredCounts[dir] = (filteredCounts[dir] || 0) + 1;
        filteredTotal++;
      }
    }

    return CARDINALS_ORDERED.map((dir) => ({
      direction: dir,
      frequency: allTotal > 0 ? Math.round(((allCounts[dir] || 0) / allTotal) * 1000) / 10 : 0,
      filteredFrequency: filteredTotal > 0
        ? Math.round(((filteredCounts[dir] || 0) / filteredTotal) * 1000) / 10
        : 0,
    }));
  })();

  // Heatmap: hour (0-23) vs direction (cardinal)
  const heatmapData: HeatmapCell[] = (() => {
    if (data.length === 0) return [];

    const counts: Record<string, number> = {};
    const hourTotals: Record<number, number> = {};

    for (const p of data) {
      if (p.windDirection === null || p.temperature === null || p.humidity === null) continue;
      if (p.temperature < minTemp || p.humidity < minHumidity) continue;

      const hour = p.time.getHours();
      const dir = degreesToCardinal(p.windDirection);
      const key = `${hour}_${dir}`;
      counts[key] = (counts[key] || 0) + 1;
      hourTotals[hour] = (hourTotals[hour] || 0) + 1;
    }

    const cells: HeatmapCell[] = [];
    for (let hour = 6; hour <= 22; hour++) {
      for (const dir of ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']) {
        // Group similar cardinals
        const relatedDirs = dir.length === 1
          ? [dir, `N${dir}`, `${dir}N`, `S${dir}`, `${dir}S`].filter((d) => CARDINALS_ORDERED.includes(d))
          : [dir];

        let count = 0;
        for (const d of relatedDirs) {
          count += counts[`${hour}_${d}`] || 0;
        }

        const total = hourTotals[hour] || 1;
        cells.push({
          hour,
          direction: dir,
          count,
          frequency: Math.round((count / total) * 100),
        });
      }
    }

    return cells;
  })();

  // Scatter: temperature vs wind speed (for filtered conditions)
  const scatterData: ScatterPoint[] = (() => {
    if (data.length === 0) return [];

    const points: ScatterPoint[] = [];
    for (const p of data) {
      if (p.temperature === null || p.windSpeed === null || p.humidity === null) continue;
      if (p.humidity < minHumidity) continue;
      // Only afternoon hours
      const hour = p.time.getHours();
      if (hour < 14 || hour > 20) continue;

      points.push({
        temperature: Math.round(p.temperature * 10) / 10,
        windSpeed: Math.round(p.windSpeed * 100) / 100,
      });
    }

    // Subsample if too many points
    if (points.length > 500) {
      const step = Math.floor(points.length / 500);
      return points.filter((_, i) => i % step === 0);
    }
    return points;
  })();

  // ── Render ───────────────────────────────────────────

  if (state === 'idle') {
    return (
      <div className="space-y-3">
        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
          Análisis Histórico
        </div>
        <p className="text-[10px] text-slate-500 leading-relaxed">
          Descarga datos horarios Jun-Sep (2022-2025) de Open-Meteo Archive
          para descubrir patrones de viento térmico reales.
        </p>

        <div className="flex gap-1">
          {(['all', '2024', '2023', '2022'] as const).map((yr) => (
            <button
              key={yr}
              onClick={() => setYearRange(yr)}
              className={`flex-1 text-[10px] py-1 rounded transition-colors ${
                yearRange === yr
                  ? 'bg-amber-600 text-white'
                  : 'bg-slate-800 text-slate-500 hover:bg-slate-750'
              }`}
            >
              {yr === 'all' ? 'Todos' : yr}
            </button>
          ))}
        </div>

        <button
          onClick={loadData}
          className="w-full bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold py-2 rounded transition-colors"
        >
          Cargar Datos Históricos
        </button>
      </div>
    );
  }

  if (state === 'loading') {
    return (
      <div className="text-center py-8">
        <div className="text-amber-500 text-lg mb-2 animate-pulse">
          &#9676;
        </div>
        <div className="text-[10px] text-slate-400">
          Descargando datos de Open-Meteo...
        </div>
        <div className="text-[9px] text-slate-600 mt-1">
          Puede tardar unos segundos
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="text-center py-6">
        <div className="text-red-400 text-xs mb-2">Error: {error}</div>
        <button
          onClick={loadData}
          className="text-[10px] bg-slate-800 text-slate-300 px-3 py-1 rounded hover:bg-slate-700"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
          Análisis Histórico
        </div>
        <div className="text-[9px] text-slate-600">
          {data.length.toLocaleString()} puntos
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 items-center">
        <label className="text-[9px] text-slate-500">T &ge;</label>
        <input
          type="number"
          value={minTemp}
          onChange={(e) => setMinTemp(Number(e.target.value))}
          className="w-12 bg-slate-800 text-slate-300 text-[10px] px-1.5 py-0.5 rounded border border-slate-700"
        />
        <label className="text-[9px] text-slate-500">HR &ge;</label>
        <input
          type="number"
          value={minHumidity}
          onChange={(e) => setMinHumidity(Number(e.target.value))}
          className="w-12 bg-slate-800 text-slate-300 text-[10px] px-1.5 py-0.5 rounded border border-slate-700"
        />
        <span className="text-[9px] text-slate-600">°C / %</span>
      </div>

      {/* Wind Rose */}
      <div>
        <div className="text-[9px] text-slate-500 mb-1">
          Rosa de vientos: <span className="text-slate-400">General</span> vs{' '}
          <span className="text-amber-400">T&ge;{minTemp} HR&ge;{minHumidity}</span>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-1">
          <ResponsiveContainer width="100%" height={220}>
            <RadarChart data={windRoseData}>
              <PolarGrid stroke="#334155" />
              <PolarAngleAxis
                dataKey="direction"
                tick={{ fill: '#94a3b8', fontSize: 9 }}
              />
              <PolarRadiusAxis
                tick={{ fill: '#64748b', fontSize: 8 }}
                tickCount={4}
              />
              <Radar
                name="General"
                dataKey="frequency"
                stroke="#64748b"
                fill="#64748b"
                fillOpacity={0.15}
                strokeWidth={1}
                isAnimationActive={false}
              />
              <Radar
                name="Filtrado"
                dataKey="filteredFrequency"
                stroke="#f59e0b"
                fill="#f59e0b"
                fillOpacity={0.25}
                strokeWidth={2}
                isAnimationActive={false}
              />
              <Tooltip
                contentStyle={{
                  background: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: 6,
                  fontSize: 10,
                }}
                formatter={(value: number | string, name: string) => [
                  `${(Number(value) || 0).toFixed(1)}%`,
                  name === 'frequency' ? 'General' : `T≥${minTemp} HR≥${minHumidity}`,
                ]}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Hour × Direction Heatmap (rendered as colored grid) */}
      <div>
        <div className="text-[9px] text-slate-500 mb-1">
          Hora vs Dirección (T&ge;{minTemp} HR&ge;{minHumidity})
        </div>
        <div className="bg-slate-800/50 rounded-lg p-2 overflow-x-auto">
          <div className="inline-grid gap-[1px]" style={{
            gridTemplateColumns: `32px repeat(8, 28px)`,
          }}>
            {/* Header */}
            <div className="text-[8px] text-slate-600" />
            {['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].map((d) => (
              <div key={d} className="text-[8px] text-slate-500 text-center font-medium">
                {d}
              </div>
            ))}

            {/* Rows */}
            {Array.from({ length: 17 }, (_, i) => i + 6).map((hour) => (
              <>
                <div key={`h${hour}`} className="text-[8px] text-slate-500 text-right pr-1">
                  {hour}:00
                </div>
                {['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].map((dir) => {
                  const cell = heatmapData.find(
                    (c) => c.hour === hour && c.direction === dir
                  );
                  const freq = cell?.frequency || 0;
                  const opacity = Math.min(freq / 40, 1);
                  return (
                    <div
                      key={`${hour}_${dir}`}
                      className="w-7 h-5 rounded-sm flex items-center justify-center"
                      style={{
                        background: freq > 0
                          ? `rgba(245, 158, 11, ${opacity})`
                          : 'rgba(51, 65, 85, 0.3)',
                      }}
                      title={`${hour}:00 ${dir}: ${freq}%`}
                    >
                      {freq > 5 && (
                        <span className="text-[7px] font-mono text-white/80">
                          {freq}
                        </span>
                      )}
                    </div>
                  );
                })}
              </>
            ))}
          </div>
        </div>
      </div>

      {/* Temperature vs Wind Speed scatter */}
      <div>
        <div className="text-[9px] text-slate-500 mb-1">
          Temperatura vs Velocidad (14-20h, HR&ge;{minHumidity})
        </div>
        <div className="bg-slate-800/50 rounded-lg p-2">
          <ResponsiveContainer width="100%" height={150}>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                dataKey="temperature"
                name="Temp"
                unit="°C"
                stroke="#64748b"
                fontSize={9}
              />
              <YAxis
                dataKey="windSpeed"
                name="Viento"
                unit=" m/s"
                stroke="#64748b"
                fontSize={9}
                width={40}
              />
              <Tooltip
                contentStyle={{
                  background: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: 6,
                  fontSize: 10,
                }}
                formatter={(value: number | string, name: string) => [
                  name === 'Temp' ? `${Number(value) || 0}°C` : `${(Number(value) || 0).toFixed(2)} m/s`,
                  name,
                ]}
              />
              <Scatter
                data={scatterData}
                fill="#f59e0b"
                fillOpacity={0.4}
                r={2}
                isAnimationActive={false}
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Reload button */}
      <button
        onClick={loadData}
        className="w-full text-[10px] bg-slate-800 text-slate-400 py-1.5 rounded hover:bg-slate-700 transition-colors"
      >
        Recargar datos
      </button>
    </div>
  );
}
