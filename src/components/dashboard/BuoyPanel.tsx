/**
 * BuoyPanel — Marine buoy data for Rías Baixas sector.
 *
 * Shows real-time wave height, period, direction, water temperature,
 * wind, and currents from Puertos del Estado buoys.
 * Only visible in Rías Baixas sector.
 */

import { memo, useEffect, useCallback, useRef } from 'react';
import { WeatherIcon } from '../icons/WeatherIcons';
import { fetchAllRiasBuoys, type BuoyReading } from '../../api/buoyClient';
import { useBuoyStore } from '../../store/buoyStore';
import { msToKnots } from '../../services/windUtils';

const REFRESH_INTERVAL = 30 * 60_000; // 30 min (buoys update hourly)

/** Compass label from degrees */
function dirLabel(deg: number | null): string {
  if (deg == null) return '—';
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(((deg % 360 + 360) % 360) / 22.5) % 16];
}

/** Format relative time */
function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${mins}min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

/** Wave height color */
function waveColor(h: number): string {
  if (h < 0.5) return 'text-green-400';
  if (h < 1.5) return 'text-blue-400';
  if (h < 2.5) return 'text-amber-400';
  if (h < 4) return 'text-orange-400';
  return 'text-red-400';
}

/** Water temperature color */
function waterTempColor(t: number): string {
  if (t < 12) return 'text-blue-400';
  if (t < 16) return 'text-cyan-400';
  if (t < 20) return 'text-green-400';
  return 'text-amber-400';
}

export const BuoyPanel = memo(function BuoyPanel() {
  const buoys = useBuoyStore((s) => s.buoys);
  const loading = useBuoyStore((s) => s.loading);
  const error = useBuoyStore((s) => s.error);
  const storeBuoys = useBuoyStore((s) => s.setBuoys);
  const storeLoading = useBuoyStore((s) => s.setLoading);
  const storeError = useBuoyStore((s) => s.setError);
  const lastFetch = useBuoyStore((s) => s.lastFetch);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  const fetchData = useCallback(async () => {
    storeLoading(true);
    try {
      const data = await fetchAllRiasBuoys();
      storeBuoys(data);
    } catch (err) {
      storeError((err as Error).message);
      console.warn('[BuoyPanel] Fetch failed:', (err as Error).message);
    }
  }, [storeBuoys, storeLoading, storeError]);

  useEffect(() => {
    // Skip fetch if store has fresh data (e.g. component re-mount)
    const age = Date.now() - lastFetch;
    if (age > REFRESH_INTERVAL || buoys.length === 0) {
      fetchData();
    }
    intervalRef.current = setInterval(fetchData, REFRESH_INTERVAL);
    return () => clearInterval(intervalRef.current);
  // Only depend on fetchData — lastFetch/buoys checked imperatively
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchData]);

  if (loading || lastFetch === 0) {
    return (
      <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
        <div className="flex items-center gap-2 text-cyan-400 text-[10px]">
          <WeatherIcon id="waves" size={14} className="animate-pulse" />
          Cargando datos de boyas...
        </div>
      </div>
    );
  }

  if (error || buoys.length === 0) {
    return (
      <div className="rounded-lg border border-slate-700/50 bg-slate-900/50 p-3">
        <div className="flex items-center gap-2 text-slate-500 text-[10px]">
          <WeatherIcon id="waves" size={14} />
          {error ? `Boyas: ${error}` : 'Sin datos de boyas marinas'}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2">
            <WeatherIcon id="waves" size={15} className="text-cyan-400" />
            <span className="text-[11px] font-bold text-cyan-300">
              Boyas marinas
            </span>
          </div>
          <span className="text-[9px] text-slate-500">
            {buoys.length} estaciones · Puertos del Estado
          </span>
        </div>
      </div>

      {/* Buoy cards */}
      {buoys.map((b) => (
        <BuoyCard key={b.stationId} reading={b} />
      ))}
    </div>
  );
});

// ── BuoyCard ──────────────────────────────────────────────

const BuoyCard = memo(function BuoyCard({ reading: b }: { reading: BuoyReading }) {
  const hasWaves = b.waveHeight != null;
  const hasWind = b.windSpeed != null;

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-900/60 overflow-hidden">
      {/* Station header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800/50">
        <div className="flex items-center gap-1.5">
          <span className="text-[8px] font-bold text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded">
            ⚓
          </span>
          <span className="text-[11px] font-bold text-slate-200">{b.stationName}</span>
        </div>
        <span className="text-[8px] text-slate-500">{timeAgo(b.timestamp)}</span>
      </div>

      {/* Data grid */}
      <div className="grid grid-cols-3 gap-px bg-slate-700/20 text-[10px]">
        {/* Wave data */}
        {hasWaves && (
          <>
            <DataCell
              label="Oleaje"
              value={`${b.waveHeight!.toFixed(1)} m`}
              className={waveColor(b.waveHeight!)}
            />
            <DataCell
              label="Período"
              value={b.wavePeriod != null ? `${b.wavePeriod.toFixed(1)} s` : '—'}
            />
            <DataCell
              label="Dir ola"
              value={dirLabel(b.waveDir)}
              sub={b.waveDir != null ? `${Math.round(b.waveDir)}°` : undefined}
            />
          </>
        )}

        {/* Wind data */}
        {hasWind && (
          <>
            <DataCell
              label="Viento"
              value={`${msToKnots(b.windSpeed!).toFixed(1)} kt`}
              className="text-blue-400"
            />
            <DataCell
              label="Dir viento"
              value={dirLabel(b.windDir)}
              sub={b.windDir != null ? `${Math.round(b.windDir)}°` : undefined}
            />
            {b.windGust != null ? (
              <DataCell
                label="Racha"
                value={`${msToKnots(b.windGust).toFixed(1)} kt`}
                className="text-orange-400"
              />
            ) : (
              <DataCell label="Racha" value="—" />
            )}
          </>
        )}

        {/* Temperature & extras */}
        {b.waterTemp != null && (
          <DataCell
            label="T agua"
            value={`${b.waterTemp.toFixed(1)}°C`}
            className={waterTempColor(b.waterTemp)}
          />
        )}
        {b.airTemp != null && (
          <DataCell
            label="T aire"
            value={`${b.airTemp.toFixed(1)}°C`}
          />
        )}
        {b.airPressure != null && (
          <DataCell
            label="Presión"
            value={`${b.airPressure.toFixed(1)} hPa`}
          />
        )}
        {b.currentSpeed != null && (
          <DataCell
            label="Corriente"
            value={`${(b.currentSpeed * 100).toFixed(0)} cm/s`}
            sub={dirLabel(b.currentDir)}
          />
        )}
        {b.salinity != null && (
          <DataCell
            label="Salinidad"
            value={`${b.salinity.toFixed(1)} PSU`}
          />
        )}
        {b.seaLevel != null && (
          <DataCell
            label="Nivel mar"
            value={`${b.seaLevel.toFixed(0)} cm`}
          />
        )}

        {/* Max wave */}
        {b.waveHeightMax != null && (
          <DataCell
            label="Ola máx"
            value={`${b.waveHeightMax.toFixed(1)} m`}
            className={waveColor(b.waveHeightMax)}
          />
        )}
        {b.wavePeriodMean != null && (
          <DataCell
            label="P. medio"
            value={`${b.wavePeriodMean.toFixed(1)} s`}
          />
        )}
      </div>
    </div>
  );
});

// ── DataCell ──────────────────────────────────────────────

function DataCell({
  label,
  value,
  sub,
  className = 'text-slate-200',
}: {
  label: string;
  value: string;
  sub?: string;
  className?: string;
}) {
  return (
    <div className="bg-slate-900/80 px-2 py-1.5 text-center">
      <div className="text-[8px] text-slate-500 uppercase">{label}</div>
      <div className={`text-[10px] font-bold mt-0.5 ${className}`}>
        {value}
        {sub && <span className="text-[8px] text-slate-500 ml-0.5">{sub}</span>}
      </div>
    </div>
  );
}
