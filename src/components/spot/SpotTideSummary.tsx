import { useState, useEffect, useMemo } from 'react';
import { WeatherIcon } from '../icons/WeatherIcons';
import { fetchTidePredictions } from '../../api/tideClient';
import type { TidePoint } from '../../api/tideClient';

export function SpotTideSummary({ tideStationId, tidePreference }: { tideStationId: string; tidePreference?: string }) {
  const [tides, setTides] = useState<TidePoint[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchTidePredictions(tideStationId)
      .then((pts) => { if (!cancelled) setTides(pts); })
      .catch(() => { if (!cancelled) setTides(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tideStationId]);

  const { nextTide, tidePhase } = useMemo(() => {
    if (!tides || tides.length === 0) return { nextTide: null, tidePhase: null as string | null };
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    let next: TidePoint | null = null;
    let prevTide: TidePoint | null = null;
    for (const t of tides) {
      const parts = t.time.split(':').map(Number);
      if (parts.length < 2) continue;
      const tideMins = parts[0] * 60 + parts[1];
      if (tideMins > nowMins) { next = t; break; }
      prevTide = t;
    }
    if (!next) next = tides[0];
    let phase: string | null = null;
    if (next && prevTide) {
      const nextMins = next.time.split(':').map(Number);
      const prevMins = prevTide.time.split(':').map(Number);
      const nextT = nextMins[0] * 60 + nextMins[1];
      const prevT = prevMins[0] * 60 + prevMins[1];
      const progress = (nowMins - prevT) / (nextT - prevT);
      if (next.type === 'high') {
        phase = progress < 0.3 ? 'low' : progress < 0.7 ? 'mid' : 'high';
      } else {
        phase = progress < 0.3 ? 'high' : progress < 0.7 ? 'mid' : 'low';
      }
    }
    return { nextTide: next, tidePhase: phase };
  }, [tides]);

  const tideMismatch = useMemo(() => {
    if (!tidePreference || tidePreference === 'all' || !tidePhase) return null;
    const pref = tidePreference;
    if (pref === 'mid-high' && tidePhase === 'low') return 'Marea baja \u2014 mejor esperar a media-alta';
    if (pref === 'low' && tidePhase === 'high') return 'Marea alta \u2014 mejor esperar a que baje';
    if (pref === 'mid' && tidePhase !== 'mid') return `Marea ${tidePhase === 'high' ? 'alta' : 'baja'} \u2014 mejor en media`;
    if (pref === 'high' && tidePhase !== 'high') return 'Mejor con marea alta';
    return null;
  }, [tidePreference, tidePhase]);

  if (loading) return null;
  if (!tides || tides.length === 0) return null;

  return (
    <div className="text-[11px] mb-1.5 pt-1 border-t border-slate-700/40">
      <div className="flex items-center gap-1 text-slate-400 mb-0.5">
        <WeatherIcon id="anchor" size={10} className="text-cyan-500/70" />
        <span className="font-semibold">Mareas hoy</span>
      </div>
      <div className="flex gap-2 flex-wrap">
        {tides.map((t, i) => {
          const isNext = t === nextTide;
          const icon = t.type === 'high' ? '\u25B2' : '\u25BC';
          const color = t.type === 'high' ? '#22d3ee' : '#60a5fa';
          return (
            <span
              key={i}
              className={`font-mono ${isNext ? 'font-bold' : 'opacity-60'}`}
              style={{ color: isNext ? color : undefined }}
              title={t.type === 'high' ? 'Pleamar' : 'Bajamar'}
            >
              {icon} {t.time} ({t.height.toFixed(1)}m)
            </span>
          );
        })}
      </div>
      {tideMismatch && (
        <div className="mt-1 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[10px] flex items-center gap-1">
          <WeatherIcon id="alert-triangle" size={10} className="shrink-0" />
          {tideMismatch}
        </div>
      )}
    </div>
  );
}
