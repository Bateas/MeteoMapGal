/**
 * "Can we see the new stations?" — the answer, live.
 *
 * The network doubled in a night and what existed to show for it was a
 * constant in this guide and a line in a log. This reads the real thing.
 *
 * It is deliberately in the guide and not on the map: the map answers "here
 * and now" and a station in Lugo changes no decision in Vigo. It is also
 * deliberately honest about two things the raw numbers would hide — that the
 * endpoint never forgets a dead station, and that none of the recent arrivals
 * is calibrated yet.
 */

import { useEffect, useMemo, useState } from 'react';
import { summariseCoverage, sourceLabel, UNPLACED_LABEL, type CoverageStation } from '../../services/networkCoverage';

const SOURCE_COLOR: Record<string, string> = {
  aemet: '#ef4444',
  meteogalicia: '#3b82f6',
  meteoclimatic: '#22c55e',
  wunderground: '#f59e0b',
  netatmo: '#a855f7',
  skyx: '#64748b',
};

export function NetworkCoverage() {
  const [stations, setStations] = useState<CoverageStation[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    fetch('/api/v1/stations', { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        const rows = data?.stations ?? data;
        if (Array.isArray(rows)) setStations(rows as CoverageStation[]);
        else setFailed(true);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFailed(true);
      });

    return () => controller.abort();
  }, []);

  const coverage = useMemo(
    () => (stations ? summariseCoverage(stations) : null),
    [stations],
  );

  // Nothing to say while it loads, and nothing to apologise for if the API is
  // down: the paragraph above this already gives the measured figure.
  if (failed || !coverage || coverage.total === 0) return null;

  const silent = coverage.total - coverage.active;

  return (
    <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800 space-y-3">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-2xl font-bold text-white tabular-nums">{coverage.active}</span>
        <span className="text-xs text-slate-400">estaciones emitiendo ahora mismo</span>
        {silent > 0 && (
          <span className="text-[11px] text-slate-500">
            · {silent} en silencio (siguen listadas, no reportan hace más de 2 h)
          </span>
        )}
      </div>

      <div className="space-y-2">
        {coverage.provinces.map((p) => {
          const pct = coverage.active > 0 ? (p.active / coverage.active) * 100 : 0;
          return (
            <div key={p.province} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-semibold text-slate-300">{p.province}</span>
                <span className="text-[11px] text-slate-400 tabular-nums">
                  {p.active}
                  {p.total !== p.active && <span className="text-slate-600"> / {p.total}</span>}
                </span>
              </div>

              {/* One bar per province, split by source. Widths are shares of the
                  whole live network, so the bars are comparable between rows. */}
              <div className="flex h-1.5 rounded-full overflow-hidden bg-slate-800">
                {p.bySource
                  .filter((s) => s.active > 0)
                  .map((s) => (
                    <div
                      key={s.source}
                      style={{
                        width: `${(s.active / coverage.active) * 100}%`,
                        backgroundColor: SOURCE_COLOR[s.source] ?? '#64748b',
                      }}
                      title={`${sourceLabel(s.source)}: ${s.active} activas`}
                    />
                  ))}
                {pct < 100 && <div className="flex-1" />}
              </div>

              <p className="text-[10px] text-slate-500 leading-relaxed">
                {p.active > 0
                  ? p.bySource
                      .filter((s) => s.active > 0)
                      .map((s) => `${sourceLabel(s.source)} ${s.active}`)
                      .join(' · ')
                  : p.province === UNPLACED_LABEL
                    // Not a mystery and worth naming: the province is written when
                    // discovery sees a station, so one that stopped reporting before
                    // we started recording it never got one — and being gone, it is
                    // never rediscovered to receive it now. They stay listed because
                    // their old readings are still in the history.
                    ? 'Ninguna emitiendo. Son estaciones que se apagaron antes de que empezásemos a anotar la provincia; siguen listadas porque su histórico sigue ahí.'
                    : 'Ninguna emitiendo ahora mismo.'}
              </p>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-slate-500 leading-relaxed border-t border-slate-800 pt-2">
        Cobertura, no calidad. Una estación cuenta aquí en cuanto emite, pero para entrar
        en el veredicto de un spot tiene que estar cerca y estar calibrada, y las últimas
        en llegar todavía no lo están. El radio de cada spot las mantiene fuera solas
        mientras tanto.
      </p>
    </div>
  );
}
