import { useState, useEffect, useMemo } from 'react';
import { WeatherIcon } from '../icons/WeatherIcons';
import { Note } from '../map/Ficha';
import { fetchTidePredictions } from '../../api/tideClient';
import type { TidePoint } from '../../api/tideClient';
import { useMeteoTide } from '../../hooks/useMeteoTide';
import { formatMeteoTide } from '../../services/meteoTideService';

/**
 * `nextOnly` (simple mode): just the tide that comes, in words, «Bajamar 22:54 · 1,0 m». The four of the
 * day are a table to plan with; whoever only looks wants to know which way the water is going.
 */
export function SpotTideSummary({ tideStationId, tidePreference, nextOnly = false }: { tideStationId: string; tidePreference?: string; nextOnly?: boolean }) {
  const [tides, setTides] = useState<TidePoint[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // How far the water actually is from the table above. Null unless a nearby
  // gauge is reporting live and the difference is big enough to matter.
  const meteoTide = useMeteoTide(tideStationId);

  useEffect(() => {
    let cancelled = false;
    fetchTidePredictions(tideStationId)
      .then((pts) => { if (!cancelled) { setTides(pts); setFailed(false); } })
      .catch(() => { if (!cancelled) { setTides(null); setFailed(true); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tideStationId]);

  const { nextTide, tidePhase } = useMemo(() => {
    if (!tides || tides.length === 0) return { nextTide: null, tidePhase: null as string | null };
    const now = new Date();
    const nowMs = now.getTime();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    let next: TidePoint | null = null;
    let prevTide: TidePoint | null = null;

    for (const t of tides) {
      if (t.epochMs && t.epochMs > 0) {
        if (t.epochMs > nowMs) { next = t; break; }
        prevTide = t;
      } else {
        const parts = t.time.split(':').map(Number);
        if (parts.length < 2) continue;
        const tideMins = parts[0] * 60 + parts[1];
        if (tideMins > nowMins) { next = t; break; }
        prevTide = t;
      }
    }
    if (!next) next = tides[0];

    let phase: string | null = null;
    if (next && prevTide) {
      let progress = 0.5;
      if (next.epochMs && prevTide.epochMs && next.epochMs > prevTide.epochMs) {
        progress = (nowMs - prevTide.epochMs) / (next.epochMs - prevTide.epochMs);
      } else {
        const nextMins = next.time.split(':').map(Number);
        const prevMins = prevTide.time.split(':').map(Number);
        const nextT = nextMins[0] * 60 + nextMins[1];
        const prevT = prevMins[0] * 60 + prevMins[1];
        if (nextT > prevT) {
          progress = (nowMins - prevT) / (nextT - prevT);
        }
      }
      progress = Math.min(1, Math.max(0, progress));

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
  // No publisher answered: say it rather than drop the line, so the missing
  // tides read as a known gap and not as a spot without tides.
  if (failed) {
    return (
      <div className="gf-row gf-row--static">
        <WeatherIcon id="anchor" size={16} />
        <span>Tabla de mareas no disponible ahora</span>
      </div>
    );
  }
  if (!tides || tides.length === 0) return null;

  return (
    <div className="gf-sec">
      <h4 className="gf-label">{nextOnly ? 'Próxima marea' : 'Mareas hoy'}</h4>
      {nextOnly && nextTide && (
        <div className="gf-strong" style={{ fontSize: 14.5 }}>
          {nextTide.type === 'high' ? 'Pleamar' : 'Bajamar'} {nextTide.time} · {nextTide.height.toFixed(1).replace('.', ',')} m
        </div>
      )}
      {!nextOnly && (
      <div className="flex flex-wrap gf-mono" style={{ gap: '2px 12px', fontSize: 13.5 }}>
        {tides.map((t, i) => {
          const isNext = t === nextTide;
          const icon = t.type === 'high' ? '\u25B2' : '\u25BC';
          return (
            <span
              key={i}
              className={isNext ? 'gf-strong' : undefined}
              style={isNext ? undefined : { color: 'var(--g-muted)' }}
              title={t.type === 'high' ? 'Pleamar' : 'Bajamar'}
            >
              {icon} {t.time} ({t.height.toFixed(1).replace('.', ',')} m)
            </span>
          );
        })}
      </div>
      )}
      {meteoTide && meteoTide.level !== 'none' && (
        <div style={{ marginTop: 6 }}>
          <Note icon="waves" tone={meteoTide.level === 'high' ? 'alto' : undefined} title="Nivel medido por el mareógrafo frente a la predicción oficial">
            {formatMeteoTide(meteoTide)}
          </Note>
        </div>
      )}
      {tideMismatch && (
        <div style={{ marginTop: 6 }}>
          <Note icon="alert-triangle" tone="alto">{tideMismatch}</Note>
        </div>
      )}
    </div>
  );
}
