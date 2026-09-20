/**
 * BuoyTrend48h — 48-hour thermal and salinity trend for marine buoy popups.
 *
 * Fetches recent readings on-demand from TimescaleDB via `/api/v1/buoys/readings`
 * and computes 48h delta + renders a zero-dependency, lightweight SVG sparkline.
 */
import { memo, useState, useEffect, useMemo } from 'react';
import { fetchBuoyReadings, type BuoyHistoryReading } from '../../api/historyClient';
import { WeatherIcon } from '../icons/WeatherIcons';

interface BuoyTrend48hProps {
  stationId: number;
  currentTemp: number | null;
  currentSalinity: number | null;
}

export const BuoyTrend48h = memo(function BuoyTrend48h({
  stationId,
  currentTemp,
  currentSalinity,
}: BuoyTrend48hProps) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<BuoyHistoryReading[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded || data !== null || loading) return;

    let cancelled = false;
    setLoading(true);
    setFetchError(null);

    const to = new Date().toISOString();
    const from = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    fetchBuoyReadings(stationId, from, to)
      .then((readings) => {
        if (!cancelled) {
          setData(readings);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setFetchError((err as Error).message || 'Error al cargar histórico');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [expanded, stationId, data, loading]);

  // Calculations
  const stats = useMemo(() => {
    if (!data || data.length === 0) return null;

    const validTemps = data.filter((d) => d.water_temp != null);
    const validSalinities = data.filter((d) => d.salinity != null);

    let deltaT: number | null = null;
    let minT: number | null = null;
    let maxT: number | null = null;

    if (validTemps.length >= 2) {
      const firstT = validTemps[0].water_temp!;
      const lastT = validTemps[validTemps.length - 1].water_temp!;
      deltaT = Math.round((lastT - firstT) * 10) / 10;
      minT = Math.min(...validTemps.map((d) => d.water_temp!));
      maxT = Math.max(...validTemps.map((d) => d.water_temp!));
    }

    let deltaS: number | null = null;
    if (validSalinities.length >= 2) {
      const firstS = validSalinities[0].salinity!;
      const lastS = validSalinities[validSalinities.length - 1].salinity!;
      deltaS = Math.round((lastS - firstS) * 100) / 100;
    }

    return {
      validTemps,
      deltaT,
      minT,
      maxT,
      deltaS,
      hasData: validTemps.length > 0 || validSalinities.length > 0,
    };
  }, [data]);

  // SVG Sparkline path generator
  const sparkline = useMemo(() => {
    if (!stats || stats.validTemps.length < 2 || stats.minT == null || stats.maxT == null) return null;

    const width = 210;
    const height = 40;
    const padding = 4;
    const innerW = width - padding * 2;
    const innerH = height - padding * 2;

    const tRange = Math.max(stats.maxT - stats.minT, 0.5); // avoid divide-by-zero
    const pts = stats.validTemps;

    const coords = pts.map((p, idx) => {
      const x = padding + (idx / (pts.length - 1)) * innerW;
      const normY = (p.water_temp! - stats.minT!) / tRange;
      const y = height - padding - normY * innerH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const d = `M ${coords.join(' L ')}`;
    return { d, width, height };
  }, [stats]);

  return (
    <div className="mt-2 pt-2 border-t border-slate-700/60">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 py-1 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <WeatherIcon id="waves" size={13} className="text-cyan-400" />
          <span>Evolución 48h (T agua & Salinidad)</span>
        </span>
        <span className="text-[10px] text-slate-400">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="mt-1.5 p-2 rounded bg-slate-900/60 border border-slate-800 text-[11px]">
          {loading && (
            <div className="text-slate-400 text-[11px] py-2 text-center animate-pulse">
              Consultando TimescaleDB...
            </div>
          )}

          {fetchError && (
            <div className="text-rose-400 text-[10px] py-1">
              {fetchError}
            </div>
          )}

          {!loading && !fetchError && stats && (
            <div>
              {/* Delta indicators */}
              <div className="flex items-center justify-between mb-1.5 text-[10.5px]">
                {stats.deltaT != null ? (
                  <div className="flex items-center gap-1">
                    <span className="text-slate-400">Δ 48h T:</span>
                    <span
                      className={`font-bold ${
                        stats.deltaT <= -1.0
                          ? 'text-cyan-400'
                          : stats.deltaT >= 1.0
                          ? 'text-amber-400'
                          : 'text-slate-300'
                      }`}
                    >
                      {stats.deltaT > 0 ? `+${stats.deltaT}` : stats.deltaT}°C
                    </span>
                    {stats.deltaT <= -1.5 && (
                      <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 bg-cyan-950/80 border border-cyan-500/30 rounded text-cyan-300">
                        <WeatherIcon id="snowflake" size={10} className="text-cyan-300" />
                        <span>Aflorando</span>
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="text-slate-500">T agua estable</div>
                )}

                {stats.deltaS != null && (
                  <div className="flex items-center gap-1">
                    <span className="text-slate-400">Δ Sal:</span>
                    <span
                      className={`font-bold ${
                        stats.deltaS > 0 ? 'text-sky-300' : 'text-slate-300'
                      }`}
                    >
                      {stats.deltaS > 0 ? `+${stats.deltaS}` : stats.deltaS} PSU
                    </span>
                  </div>
                )}
              </div>

              {/* Sparkline */}
              {sparkline && stats.minT != null && stats.maxT != null && (
                <div className="my-1">
                  <div className="relative">
                    <svg
                      viewBox={`0 0 ${sparkline.width} ${sparkline.height}`}
                      className="w-full h-10 overflow-visible"
                    >
                      <path
                        d={sparkline.d}
                        fill="none"
                        stroke="#38bdf8"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <div className="flex justify-between text-[9px] text-slate-500 mt-0.5">
                      <span>Hace 48h ({stats.validTemps[0]?.water_temp?.toFixed(1)}°C)</span>
                      <span>Ahora ({stats.validTemps[stats.validTemps.length - 1]?.water_temp?.toFixed(1)}°C)</span>
                    </div>
                  </div>
                </div>
              )}

              {!stats.hasData && (
                <div className="text-slate-500 text-[10px] text-center py-1">
                  Sin suficientes lecturas en las últimas 48h
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
