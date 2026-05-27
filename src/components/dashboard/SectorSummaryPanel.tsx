/**
 * SectorSummaryPanel — sector-level analytics overview (T2-7 Phase 4).
 *
 * Shows 3 mini visualizations sourced from TimescaleDB continuous aggregates:
 *   1. Convection trend (CAPE/LI daily peaks) — "when does this sector
 *      have storm potential?"
 *   2. Lightning hotspot summary (counts by zone, top 5 cells)
 *   3. Air quality trend (ICA daily mean + max)
 *
 * All charts are intentionally COMPACT — full per-station explorer remains
 * in HistoryDashboard. This panel answers "what has the SECTOR done?" in
 * 30 seconds without picking individual stations.
 *
 * Data freshness: server caches 1h. A manual "refresh" button bypasses.
 */
import { memo, useMemo } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { WeatherIcon } from '../icons/WeatherIcons';
import { useSectorAnalytics } from '../../hooks/useSectorAnalytics';

interface Props {
  sector: 'embalse' | 'rias';
  /** Days of history to fetch (default 30 — matches server CAGG retention sweet spot) */
  days?: number;
}

// ── Helpers ────────────────────────────────────────────

/** Short month-day label for chart X axis. */
function dayLabel(day: string): string {
  // Day is YYYY-MM-DD from server
  const [, m, d] = day.split('-');
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const idx = parseInt(m, 10) - 1;
  return idx >= 0 && idx < 12 ? `${parseInt(d, 10)}-${months[idx]}` : day;
}

/**
 * Lightning cells aggregated by zone for the side-panel summary.
 * The raw `cells` array is a 5km grid; we group by approximate zone
 * (lat/lon rounded to nearest 0.1°) so the table doesn't spam 200 rows.
 */
function aggregateLightningByZone(
  cells: { lat: number; lon: number; strikes: number }[],
): { label: string; strikes: number }[] {
  const byZone = new Map<string, number>();
  for (const c of cells) {
    const zoneLat = Math.round(c.lat * 10) / 10;
    const zoneLon = Math.round(c.lon * 10) / 10;
    const key = `${zoneLat},${zoneLon}`;
    byZone.set(key, (byZone.get(key) ?? 0) + c.strikes);
  }
  return Array.from(byZone.entries())
    .map(([key, strikes]) => ({ label: key, strikes }))
    .sort((a, b) => b.strikes - a.strikes)
    .slice(0, 5);
}

// ── Sub-components ────────────────────────────────────

function SectionHeader({ icon, title, hint }: { icon: 'flame' | 'zap' | 'wind' | 'activity'; title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-2">
      <WeatherIcon id={icon} size={14} className="text-slate-400 -mt-px shrink-0" />
      <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      {hint && <span className="text-[10px] text-slate-500">{hint}</span>}
    </div>
  );
}

function LoadingShimmer() {
  return (
    <div className="h-32 bg-slate-800/40 rounded animate-pulse flex items-center justify-center text-[11px] text-slate-500">
      Cargando…
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="h-20 bg-red-900/20 border border-red-700/40 rounded p-3 text-[11px] text-red-300">
      Error: {message}
    </div>
  );
}

function EmptyBox({ message }: { message: string }) {
  return (
    <div className="h-20 bg-slate-800/30 rounded p-3 text-[11px] text-slate-400 italic flex items-center">
      {message}
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────

export const SectorSummaryPanel = memo(function SectorSummaryPanel({
  sector,
  days = 30,
}: Props) {
  const { lightning, convection, airQuality, loading, errors, refetch } = useSectorAnalytics(sector, days);

  // ── Convection chart data ──
  const convectionData = useMemo(() => {
    if (!convection?.trend) return [];
    return convection.trend.map((p) => ({
      day: dayLabel(p.day),
      cape: p.peakCape ?? 0,
      // Lifted index is negative when unstable; flip sign for visual intuition
      // (taller bar = more unstable / more storm potential)
      instability: p.minLiftedIndex !== null ? Math.max(0, -p.minLiftedIndex) : 0,
      strikes: p.strikes ?? 0,
    }));
  }, [convection]);

  const peakStrikes = useMemo(
    () => convectionData.reduce((max, p) => Math.max(max, p.strikes), 0),
    [convectionData],
  );

  // ── Lightning hotspot data ──
  const hotspots = useMemo(
    () => (lightning?.cells ? aggregateLightningByZone(lightning.cells) : []),
    [lightning],
  );
  const totalStrikes = useMemo(
    () => (lightning?.cells ? lightning.cells.reduce((sum, c) => sum + c.strikes, 0) : 0),
    [lightning],
  );

  // ── Air quality chart data ──
  const aqData = useMemo(() => {
    if (!airQuality?.trend) return [];
    return airQuality.trend.map((p) => ({
      day: dayLabel(p.day),
      mean: p.meanIca ?? 0,
      max: p.maxIca ?? 0,
    }));
  }, [airQuality]);

  return (
    <div className="space-y-4">
      {/* Header with refresh */}
      <div className="flex items-baseline justify-between border-b border-slate-700 pb-2">
        <div>
          <h2 className="text-base font-semibold text-white">Resumen del sector</h2>
          <p className="text-[10px] text-slate-500">Últimos {days} días · {sector === 'embalse' ? 'Embalse de Castrelo' : 'Rías Baixas'}</p>
        </div>
        <button
          onClick={refetch}
          className="text-[11px] text-sky-400 hover:text-sky-300 transition-colors"
          title="Re-fetch — server cache 1h"
        >
          Refrescar
        </button>
      </div>

      {/* ── Section 1: Convection trend ── */}
      <section>
        <SectionHeader
          icon="flame"
          title="Tormentas y inestabilidad"
          hint={convection ? `pico CAPE máximo · pico LI invertido` : undefined}
        />
        {loading.convection && <LoadingShimmer />}
        {errors.convection && <ErrorBox message={errors.convection} />}
        {convection && convectionData.length === 0 && !loading.convection && (
          <EmptyBox message="Sin datos de convección para este sector en el período." />
        )}
        {convection && convectionData.length > 0 && (
          <div className="bg-slate-900/50 rounded p-2">
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={convectionData} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="#334155" />
                <XAxis
                  dataKey="day"
                  tick={{ fill: '#94a3b8', fontSize: 10 }}
                  interval="preserveStartEnd"
                />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: 4, fontSize: 11 }}
                  labelStyle={{ color: '#cbd5e1' }}
                  // Recharts 3.x Formatter type has a 5-arg signature with strict
                  // ReactNode return; our 2-arg shape works fine at runtime but TS
                  // can't narrow it. Cast as any to silence — same pattern used by
                  // HistoryDashboard.tsx:734 (pre-existing deuda TS).
                  formatter={((value: number, name: string): [string, string] => {
                    if (name === 'cape') return [`${value.toFixed(0)} J/kg`, 'CAPE pico'];
                    if (name === 'instability') return [`${value.toFixed(1)}`, '|LI| pico'];
                    if (name === 'strikes') return [`${value}`, 'Rayos'];
                    return [`${value}`, name];
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  }) as any}
                />
                <Bar dataKey="cape" fill="#f97316" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-3 text-[10px] text-slate-400 mt-1">
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-sm bg-orange-500" />
                CAPE (J/kg)
              </span>
              {peakStrikes > 0 && (
                <span>{peakStrikes} rayos pico/día</span>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ── Section 2: Lightning hotspots ── */}
      <section>
        <SectionHeader
          icon="zap"
          title="Zonas con más rayos"
          hint={totalStrikes > 0 ? `${totalStrikes.toLocaleString('es')} rayos · top 5 zonas (0.1°)` : undefined}
        />
        {loading.lightning && <LoadingShimmer />}
        {errors.lightning && <ErrorBox message={errors.lightning} />}
        {lightning && hotspots.length === 0 && !loading.lightning && (
          <EmptyBox message={`Sin rayos detectados en los últimos ${days} días.`} />
        )}
        {hotspots.length > 0 && (
          <div className="bg-slate-900/50 rounded p-2 space-y-1">
            {hotspots.map((h, i) => {
              const [lat, lon] = h.label.split(',').map(Number);
              const widthPct = Math.max(8, Math.round((h.strikes / hotspots[0].strikes) * 100));
              return (
                <div key={h.label} className="flex items-center gap-2 text-[11px]">
                  <span className="text-slate-500 tabular-nums w-4 text-right">{i + 1}</span>
                  <span className="text-slate-300 tabular-nums w-24 shrink-0">
                    {lat.toFixed(1)}°N {Math.abs(lon).toFixed(1)}°W
                  </span>
                  <div className="flex-1 h-2 bg-slate-800 rounded overflow-hidden">
                    <div
                      className="h-full bg-amber-400/70"
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  <span className="text-amber-300 tabular-nums w-10 text-right">
                    {h.strikes.toLocaleString('es')}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Section 3: Air quality ── */}
      <section>
        <SectionHeader
          icon="wind"
          title="Calidad del aire (ICA)"
          hint={aqData.length > 0 ? `media regional diaria · 0-50 buena, 50-100 moderada` : undefined}
        />
        {loading.airQuality && <LoadingShimmer />}
        {errors.airQuality && <ErrorBox message={errors.airQuality} />}
        {airQuality && aqData.length === 0 && !loading.airQuality && (
          <EmptyBox message="Sin datos ICA para el período." />
        )}
        {aqData.length > 0 && (
          <div className="bg-slate-900/50 rounded p-2">
            <ResponsiveContainer width="100%" height={100}>
              <LineChart data={aqData} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="#334155" />
                <XAxis
                  dataKey="day"
                  tick={{ fill: '#94a3b8', fontSize: 10 }}
                  interval="preserveStartEnd"
                />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: 4, fontSize: 11 }}
                  labelStyle={{ color: '#cbd5e1' }}
                  // Recharts 3.x Formatter type has a 5-arg signature with strict
                  // ReactNode return; our 2-arg shape works fine at runtime but TS
                  // can't narrow it. Cast as any to silence — same pattern used by
                  // HistoryDashboard.tsx:734 (pre-existing deuda TS).
                  formatter={((value: number, name: string): [string, string] => {
                    if (name === 'mean') return [value.toFixed(0), 'Media'];
                    if (name === 'max') return [value.toFixed(0), 'Pico'];
                    return [`${value}`, name];
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  }) as any}
                />
                <Line type="monotone" dataKey="mean" stroke="#22c55e" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="max" stroke="#f87171" strokeWidth={1} dot={false} strokeDasharray="2 2" />
              </LineChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-3 text-[10px] text-slate-400 mt-1">
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-0.5 bg-emerald-500" /> Media
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-0.5 bg-red-400" /> Pico diario
              </span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
});
