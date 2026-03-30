/**
 * BuoyPanel — Marine buoy data for Rías Baixas sector.
 *
 * Shows real-time wave height, period, direction, water temperature,
 * wind, and currents from Puertos del Estado buoys.
 * Only visible in Rías Baixas sector.
 */

import { memo, useState } from 'react';
import { WeatherIcon } from '../icons/WeatherIcons';
import type { BuoyReading } from '../../api/buoyClient';
import { useBuoyStore } from '../../store/buoyStore';
import { msToKnots, windSpeedClass } from '../../services/windUtils';
import { waveHeightClass, waterTempClass, currentSpeedClass, seaStateLabel } from '../../services/buoyUtils';

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

// Color scales imported from buoyUtils.ts — shared with BuoyMarker & BuoyPopup

export const BuoyPanel = memo(function BuoyPanel() {
  // Display-only — data fetching handled by useBuoyData hook in AppShell
  const buoys = useBuoyStore((s) => s.buoys);
  const loading = useBuoyStore((s) => s.loading);
  const error = useBuoyStore((s) => s.error);
  const lastFetch = useBuoyStore((s) => s.lastFetch);
  // Hook MUST be before any early returns (React hooks rules)
  const [expanded, setExpanded] = useState(true);

  if (loading || lastFetch === 0) {
    return (
      <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
        <div className="flex items-center gap-2 text-cyan-400 text-[11px]">
          <WeatherIcon id="waves" size={14} className="animate-pulse" />
          Cargando datos de boyas...
        </div>
      </div>
    );
  }

  if (error || buoys.length === 0) {
    return (
      <div className="rounded-lg border border-slate-700/50 bg-slate-900/50 p-3">
        <div className="flex items-center gap-2 text-slate-500 text-[11px]">
          <WeatherIcon id="waves" size={14} />
          {error ? `Boyas: ${error}` : 'Sin datos de boyas marinas'}
        </div>
      </div>
    );
  }

  return (
    <section aria-label="Datos de boyas marinas" className="space-y-2">
      {/* Collapsible Header */}
      <button
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className="w-full rounded-lg border border-cyan-500/20 bg-cyan-500/5 overflow-hidden cursor-pointer hover:bg-cyan-500/10 transition-colors"
      >
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2">
            <WeatherIcon id="waves" size={15} className="text-cyan-400" />
            <span className="text-[11px] font-bold text-cyan-300">
              Boyas marinas
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500">
              {buoys.length} estaciones
            </span>
            <svg className={`w-3 h-3 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </button>

      {/* Buoy cards — collapsible */}
      {expanded && buoys.map((b) => (
        <BuoyCard key={b.stationId} reading={b} />
      ))}
    </section>
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
          <span className="text-[11px] font-bold text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded">
            ⚓
          </span>
          <span className="text-[11px] font-bold text-slate-200">{b.stationName}</span>
          {b.source === 'obscosteiro' && (
            <span className="text-[11px] font-bold text-teal-400 bg-teal-500/10 px-1 py-0.5 rounded">
              OBS
            </span>
          )}
        </div>
        <span className="text-[11px] text-slate-500">{timeAgo(b.timestamp)}</span>
      </div>

      {/* Data grid */}
      <div className="grid grid-cols-3 gap-px bg-slate-700/20 text-[11px]">
        {/* Wave data */}
        {hasWaves && (
          <>
            <DataCell
              label={seaStateLabel(b.waveHeight)}
              value={`${b.waveHeight!.toFixed(1)} m`}
              className={waveHeightClass(b.waveHeight!)}
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
              className={windSpeedClass(b.windSpeed)}
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
                className={windSpeedClass(b.windGust)}
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
            className={waterTempClass(b.waterTemp!)}
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
            className={currentSpeedClass(b.currentSpeed)}
            dirDeg={b.currentDir}
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

        {/* Humidity & dew point — Observatorio Costeiro exclusive */}
        {b.humidity != null && (
          <DataCell
            label="Humedad"
            value={`${b.humidity.toFixed(0)}%`}
            className={b.humidity > 85 ? 'text-blue-300' : 'text-slate-200'}
          />
        )}
        {b.dewPoint != null && (
          <DataCell
            label="P. rocío"
            value={`${b.dewPoint.toFixed(1)}°C`}
          />
        )}

        {/* Max wave */}
        {b.waveHeightMax != null && (
          <DataCell
            label="Ola máx"
            value={`${b.waveHeightMax.toFixed(1)} m`}
            className={waveHeightClass(b.waveHeightMax!)}
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
  dirDeg,
}: {
  label: string;
  value: string;
  sub?: string;
  className?: string;
  /** Optional direction in degrees — shows a small direction arrow */
  dirDeg?: number | null;
}) {
  return (
    <div className="bg-slate-900/80 px-2 py-1.5 text-center">
      <div className="text-[11px] text-slate-500 tracking-wide">{label}</div>
      <div className={`text-[11px] font-bold mt-0.5 ${className} flex items-center justify-center gap-1`}>
        {dirDeg != null && (
          <svg width="10" height="10" viewBox="-5 -5 10 10" className="inline-block shrink-0">
            <g transform={`rotate(${dirDeg})`}>
              <line x1="0" y1="3" x2="0" y2="-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <polygon points="-2,-1 2,-1 0,-4" fill="currentColor" />
            </g>
          </svg>
        )}
        {value}
        {sub && <span className="text-[11px] text-slate-500 ml-0.5">{sub}</span>}
      </div>
    </div>
  );
}
