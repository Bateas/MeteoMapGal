/**
 * ForecastVerification — "¿Acertó la previsión?"
 *
 * Compares Open-Meteo past forecasts against actual observations from
 * TimescaleDB. Shows dual-line charts (forecast vs observed) and
 * accuracy stats (MAE, bias, accuracy rate).
 *
 * MVP: single station, yesterday (1d ago). Expandable to multi-day.
 */

import { memo, useState, useEffect, useCallback, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
  ReferenceLine,
} from 'recharts';
import { useWeatherStore } from '../../store/weatherStore';
import {
  verifyForecast,
  formatBias, formatMae, formatAccuracy,
  accuracyColor, biasColor,
  type VerificationResult,
  type VerificationPoint,
} from '../../services/forecastVerificationService';
import { msToKnots } from '../../services/windUtils';

// ── Types ──────────────────────────────────────────

type VerifMetric = 'wind' | 'temp' | 'humidity';

const METRICS: { key: VerifMetric; label: string; unit: string; fcstColor: string; obsColor: string }[] = [
  { key: 'wind', label: 'Viento', unit: 'kt', fcstColor: '#60a5fa', obsColor: '#3b82f6' },
  { key: 'temp', label: 'Temperatura', unit: '°C', fcstColor: '#fbbf24', obsColor: '#ef4444' },
  { key: 'humidity', label: 'Humedad', unit: '%', fcstColor: '#a78bfa', obsColor: '#22c55e' },
];

const PAST_DAYS_OPTIONS = [
  { value: 1, label: 'Ayer' },
  { value: 2, label: 'Hace 2 días' },
  { value: 3, label: 'Hace 3 días' },
];

// ── Constants ─────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  aemet: 'AEMET', meteogalicia: 'MG', meteoclimatic: 'MC',
  wunderground: 'WU', netatmo: 'NT', skyx: 'SkyX',
};

// ── Component ──────────────────────────────────────

export const ForecastVerification = memo(function ForecastVerification() {
  const stations = useWeatherStore((s) => s.stations);
  const [selectedStation, setSelectedStation] = useState<string>('');
  const [pastDays, setPastDays] = useState(1);
  const [metric, setMetric] = useState<VerifMetric>('wind');
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sortedStations = useMemo(() =>
    [...stations]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(s => ({
        ...s,
        displayName: `${s.name} (${SOURCE_LABELS[s.source] ?? s.source})`,
      })),
    [stations]
  );

  // Auto-select first station with a valid ID prefix (AEMET/MG preferred)
  useEffect(() => {
    if (selectedStation || stations.length === 0) return;
    const aemet = stations.find(s => s.id.startsWith('aemet_'));
    const mg = stations.find(s => s.id.startsWith('mg_'));
    setSelectedStation((aemet ?? mg ?? stations[0]).id);
  }, [stations, selectedStation]);

  // Fetch verification data
  const runVerification = useCallback(async () => {
    const station = stations.find(s => s.id === selectedStation);
    if (!station) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await verifyForecast(
        station.id, station.name,
        station.lat, station.lon,
        pastDays
      );
      if (res.points.length === 0) {
        setError('Sin datos suficientes para verificación. ¿La estación tiene historial?');
      } else {
        setResult(res);
      }
    } catch (err) {
      console.warn('[ForecastVerification] Error:', err);
      setError('Error al obtener datos de verificación');
    } finally {
      setLoading(false);
    }
  }, [selectedStation, pastDays, stations]);

  // Auto-run on station/days change
  useEffect(() => {
    if (selectedStation) {
      runVerification();
    }
  }, [selectedStation, pastDays, runVerification]);

  // Transform points to chart data
  const chartData = useMemo(() => {
    if (!result) return [];
    return result.points.map(p => ({
      time: p.time.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }),
      fcst: getMetricFcst(p, metric),
      obs: getMetricObs(p, metric),
      delta: getMetricDelta(p, metric),
    }));
  }, [result, metric]);

  const currentMetric = METRICS.find(m => m.key === metric)!;
  const stats = result?.stats;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h3 className="text-sm font-bold text-white">¿Acertó la previsión?</h3>
        {result && (
          <span className="text-[10px] text-slate-500 ml-auto">
            {result.points.length}h comparadas · {result.modelRun}
          </span>
        )}
      </div>

      {/* Controls */}
      <div className="flex gap-2 flex-wrap">
        {/* Station selector */}
        <select
          value={selectedStation}
          onChange={(e) => setSelectedStation(e.target.value)}
          className="flex-1 min-w-[140px] bg-slate-800 text-white text-xs rounded px-2 py-1.5 border border-slate-600 focus:border-blue-500 outline-none"
          aria-label="Estación"
        >
          {sortedStations.map(s => (
            <option key={s.id} value={s.id}>{s.displayName}</option>
          ))}
        </select>

        {/* Past days selector */}
        <select
          value={pastDays}
          onChange={(e) => setPastDays(Number(e.target.value))}
          className="bg-slate-800 text-white text-xs rounded px-2 py-1.5 border border-slate-600 focus:border-blue-500 outline-none"
          aria-label="Período"
        >
          {PAST_DAYS_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Metric tabs */}
      <div className="flex gap-1">
        {METRICS.map(m => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            className={`flex-1 text-[10px] font-semibold py-1 rounded transition-colors ${
              metric === m.key
                ? 'bg-slate-700 text-white'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {m.label} ({m.unit})
          </button>
        ))}
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="text-center py-6 text-slate-500 text-xs">
          <div className="animate-spin inline-block w-4 h-4 border-2 border-slate-500 border-t-blue-400 rounded-full mb-2" />
          <div>Comparando previsión con observaciones...</div>
        </div>
      )}
      {error && (
        <div className="text-center py-4 text-amber-400 text-xs bg-amber-900/20 rounded px-3">
          {error}
        </div>
      )}

      {/* Chart */}
      {result && !loading && chartData.length > 0 && (
        <>
          <div className="bg-slate-800/50 rounded-lg p-2">
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="time"
                  tick={{ fill: '#94a3b8', fontSize: 9 }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: '#94a3b8', fontSize: 9 }}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: 8, fontSize: 11 }}
                  labelStyle={{ color: '#94a3b8' }}
                  formatter={(value: number, name: string) => [
                    `${value?.toFixed(1)} ${currentMetric.unit}`,
                    name === 'fcst' ? 'Previsión' : 'Observado',
                  ]}
                />
                <Legend
                  formatter={(value) => value === 'fcst' ? 'Previsión' : 'Observado'}
                  wrapperStyle={{ fontSize: 10 }}
                />
                <Line
                  type="monotone"
                  dataKey="fcst"
                  stroke={currentMetric.fcstColor}
                  strokeWidth={2}
                  strokeDasharray="6 3"
                  dot={false}
                  name="fcst"
                />
                <Line
                  type="monotone"
                  dataKey="obs"
                  stroke={currentMetric.obsColor}
                  strokeWidth={2}
                  dot={false}
                  name="obs"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Delta chart */}
          <div className="bg-slate-800/50 rounded-lg p-2">
            <div className="text-[10px] text-slate-500 mb-1 px-1">
              Error (previsión − observado)
            </div>
            <ResponsiveContainer width="100%" height={100}>
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="time"
                  tick={{ fill: '#94a3b8', fontSize: 9 }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: '#94a3b8', fontSize: 9 }}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: 8, fontSize: 11 }}
                  formatter={(value: number) => [`${value?.toFixed(1)} ${currentMetric.unit}`, 'Δ Error']}
                />
                <ReferenceLine y={0} stroke="#64748b" strokeWidth={1} />
                <Line
                  type="monotone"
                  dataKey="delta"
                  stroke="#f59e0b"
                  strokeWidth={1.5}
                  dot={{ r: 2, fill: '#f59e0b' }}
                  name="delta"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Stats cards */}
          {stats && stats.n >= 3 && (
            <div className="grid grid-cols-2 gap-2">
              <StatCard
                label="Error medio"
                value={metric === 'wind' ? formatMae(stats.windMaeKt, 'kt')
                  : metric === 'temp' ? formatMae(stats.tempMae, '°C')
                  : formatMae(stats.humidityMae, '%')}
                sublabel="MAE"
                color="#94a3b8"
              />
              <StatCard
                label="Sesgo"
                value={metric === 'wind' ? formatBias(stats.windBiasKt, 'kt')
                  : metric === 'temp' ? formatBias(stats.tempBias, '°C')
                  : formatBias(stats.humidityMae, '%')}
                sublabel={metric === 'wind'
                  ? (stats.windBiasKt !== null && stats.windBiasKt > 0 ? 'sobre-predice' : 'sub-predice')
                  : (stats.tempBias !== null && stats.tempBias > 0 ? 'más cálido' : 'más frío')}
                color={metric === 'wind' ? biasColor(stats.windBiasKt, 3)
                  : metric === 'temp' ? biasColor(stats.tempBias, 2)
                  : '#94a3b8'}
              />
              <StatCard
                label="Precisión"
                value={metric === 'wind' ? formatAccuracy(stats.windAccuracyPct)
                  : metric === 'temp' ? formatAccuracy(stats.tempAccuracyPct)
                  : '—'}
                sublabel={metric === 'wind' ? 'dentro de ±3kt' : metric === 'temp' ? 'dentro de ±2°C' : ''}
                color={metric === 'wind' ? accuracyColor(stats.windAccuracyPct)
                  : accuracyColor(stats.tempAccuracyPct)}
              />
              <StatCard
                label="Horas"
                value={`${stats.n}`}
                sublabel="comparadas"
                color="#94a3b8"
              />
            </div>
          )}

          {/* Interpretation */}
          {stats && stats.n >= 3 && (
            <div className="bg-slate-800/30 rounded px-3 py-2 text-[10px] text-slate-400 space-y-1">
              <Interpretation stats={stats} metric={metric} stationName={result.stationName} />
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {!loading && !error && !result && stations.length > 0 && (
        <div className="text-center py-6 text-slate-600 text-xs">
          Selecciona una estación para verificar la previsión
        </div>
      )}
    </div>
  );
});

// ── Helpers ──────────────────────────────────────────

function getMetricFcst(p: VerificationPoint, metric: VerifMetric): number | null {
  switch (metric) {
    case 'wind': return p.fcstWindMs !== null ? msToKnots(p.fcstWindMs) : null;
    case 'temp': return p.fcstTemp;
    case 'humidity': return p.fcstHumidity;
  }
}

function getMetricObs(p: VerificationPoint, metric: VerifMetric): number | null {
  switch (metric) {
    case 'wind': return p.obsWindMs !== null ? msToKnots(p.obsWindMs) : null;
    case 'temp': return p.obsTemp;
    case 'humidity': return p.obsHumidity;
  }
}

function getMetricDelta(p: VerificationPoint, metric: VerifMetric): number | null {
  switch (metric) {
    case 'wind': return p.windDeltaKt;
    case 'temp': return p.tempDelta;
    case 'humidity': return p.humidityDelta;
  }
}

// ── Sub-components ───────────────────────────────────

function StatCard({ label, value, sublabel, color }: {
  label: string; value: string; sublabel: string; color: string;
}) {
  return (
    <div className="bg-slate-800/60 rounded-lg px-3 py-2 text-center">
      <div className="text-[9px] text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-base font-bold font-mono" style={{ color }}>{value}</div>
      <div className="text-[9px] text-slate-500">{sublabel}</div>
    </div>
  );
}

function Interpretation({ stats, metric, stationName }: {
  stats: NonNullable<VerificationResult['stats']>;
  metric: VerifMetric;
  stationName: string;
}) {
  if (metric === 'wind') {
    const acc = stats.windAccuracyPct;
    const bias = stats.windBiasKt;
    if (acc === null || bias === null) return null;

    const quality = acc >= 80 ? 'excelente' : acc >= 60 ? 'aceptable' : acc >= 40 ? 'mejorable' : 'poco fiable';
    const biasDir = Math.abs(bias) <= 1 ? 'sin sesgo significativo'
      : bias > 0 ? `sobre-predice ${bias.toFixed(1)} kt de media`
      : `sub-predice ${Math.abs(bias).toFixed(1)} kt de media`;

    return (
      <p>
        Open-Meteo tiene precisión <strong className="text-slate-300">{quality}</strong> en {stationName}: {biasDir}.
        {acc >= 70 && ' Puedes confiar en la previsión de viento para esta zona.'}
        {acc < 40 && ' Usa la previsión como orientación, no como dato exacto.'}
      </p>
    );
  }

  if (metric === 'temp') {
    const acc = stats.tempAccuracyPct;
    const bias = stats.tempBias;
    if (acc === null || bias === null) return null;

    const quality = acc >= 80 ? 'muy buena' : acc >= 60 ? 'buena' : 'mejorable';
    const biasDir = Math.abs(bias) <= 0.5 ? 'sin sesgo'
      : bias > 0 ? `predice ${bias.toFixed(1)}°C más cálido`
      : `predice ${Math.abs(bias).toFixed(1)}°C más frío`;

    return (
      <p>
        Temperatura: precisión <strong className="text-slate-300">{quality}</strong> ({biasDir}).
        {bias > 1.5 && ' El modelo podría no captar microclimas locales (valles, costa).'}
      </p>
    );
  }

  return null;
}
