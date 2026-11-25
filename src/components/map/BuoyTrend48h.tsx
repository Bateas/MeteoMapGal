/**
 * BuoyTrend48h — 48-hour thermal and salinity trend for marine buoy popups.
 *
 * Fetches recent readings on-demand from TimescaleDB via `/api/v1/buoys/readings`
 * and computes 48h delta + renders a zero-dependency, lightweight SVG sparkline.
 */
import { memo, useState, useEffect, useMemo } from 'react';
import { fetchBuoyReadings, type BuoyHistoryReading } from '../../api/historyClient';
import { FoldRow, Note } from './Ficha';
import { Cell } from '../spot/Cell';

interface BuoyTrend48hProps {
  stationId: number;
}

export const BuoyTrend48h = memo(function BuoyTrend48h({
  stationId,
}: BuoyTrend48hProps) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<BuoyHistoryReading[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Reset state when clicking another buoy
  useEffect(() => {
    setData(null);
    setFetchError(null);
    setLoading(false);
  }, [stationId]);

  useEffect(() => {
    if (!expanded || data !== null) return;

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
          setFetchError((err as Error).message || 'No se pudieron cargar los datos');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [expanded, stationId, data]);

  // Calculations
  const stats = useMemo(() => {
    if (!data || data.length === 0) return null;

    // Filter out sensor glitches (< 5°C impossible in ocean buoys of Galicia)
    const validTemps = data.filter((d) => d.water_temp != null && d.water_temp >= 5.0);
    const validSalinities = data.filter((d) => d.salinity != null && d.salinity >= 10.0);

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
    <FoldRow icon="waves" title="Evolución 48 h" note="agua y salinidad" onToggle={setExpanded}>
      {loading && <p className="gf-hint">Cargando datos…</p>}
      {fetchError && <p className="gf-hint">{fetchError}</p>}

      {!loading && !fetchError && stats && (
        <>
          <dl className="gf-data" style={{ borderTop: 0, paddingTop: 0 }}>
            {stats.deltaT != null ? (
              <Cell label="Agua en 48 h" value={`${stats.deltaT > 0 ? '+' : ''}${String(stats.deltaT).replace('.', ',')} °C`} />
            ) : (
              <Cell label="Agua en 48 h" value="estable" />
            )}
            {stats.deltaS != null && (
              <Cell label="Salinidad en 48 h" value={`${stats.deltaS > 0 ? '+' : ''}${String(stats.deltaS).replace('.', ',')} PSU`} />
            )}
          </dl>
          {stats.deltaT != null && stats.deltaT <= -1.5 && (
            <Note icon="snowflake" tone="riesgo">El agua se está enfriando: puede estar aflorando agua de fondo.</Note>
          )}

          {sparkline && stats.minT != null && stats.maxT != null && (
            <div style={{ marginTop: 4 }}>
              <svg viewBox={`0 0 ${sparkline.width} ${sparkline.height}`} className="gf-chart" role="img" aria-label="Temperatura del agua en las últimas 48 horas">
                <path d={sparkline.d} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div className="flex justify-between gf-hint" style={{ marginTop: 2 }}>
                <span>Hace 48 h: {stats.validTemps[0]?.water_temp?.toFixed(1).replace('.', ',')} °C</span>
                <span>Ahora: {stats.validTemps[stats.validTemps.length - 1]?.water_temp?.toFixed(1).replace('.', ',')} °C</span>
              </div>
            </div>
          )}

          {!stats.hasData && <p className="gf-hint">Sin registros suficientes en las últimas 48 h</p>}
        </>
      )}
    </FoldRow>
  );
});
