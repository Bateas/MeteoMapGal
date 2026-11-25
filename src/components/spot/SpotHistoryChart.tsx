import { useState, useEffect } from 'react';
import { FoldRow } from '../map/Ficha';
import { WindPlot, type PlotStop } from './WindPlot';

/** The nights are left out, and a line across them would draw a wind nobody looked at */
const GAP_MS = 2 * 3_600_000;

export function SpotHistoryChart({ spotId }: { spotId: string }) {
  const [data, setData] = useState<{ time: string; wind_kt: number }[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    fetch(`/api/v1/spots/scores?spot_id=${encodeURIComponent(spotId)}&days=2`)
      .then((r) => r.json())
      .then((d) => {
        const scores = (d.scores ?? []).reverse();
        const daytime = scores.filter((s: { time: string }) => {
          const h = new Date(s.time).getHours();
          return h >= 6 && h < 22;
        });
        setData(daytime.length >= 6 ? daytime : scores);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [open, loaded, spotId]);

  return (
    <FoldRow icon="activity" title="Historial del spot, 48 h" note="(de día)" onToggle={setOpen}>
      {!loaded ? (
        <p className="gf-hint">Cargando…</p>
      ) : data.length < 6 ? (
        <p className="gf-hint">Todavía no hay datos suficientes de este spot.</p>
      ) : (
        <SpotWindChart data={data} />
      )}
    </FoldRow>
  );
}

function SpotWindChart({ data }: { data: { time: string; wind_kt: number }[] }) {
  const points = data.map((d) => ({ t: new Date(d.time).getTime(), kt: d.wind_kt }));
  const from = points[0].t;
  const to = points[points.length - 1].t;
  const stops: PlotStop[] = points.map((p) => ({ t: p.t, kt: p.kt, value: `${Math.round(p.kt)} kt`, note: when(p.t) }));
  return (
    <WindPlot
      from={from}
      to={Math.max(to, from + 1)}
      series={[{ points, kind: 'main', gapMs: GAP_MS }]}
      stops={stops}
      label="Viento del spot en las últimas 48 horas, de día"
      foot={(
        <>
          <span>{when(from)}</span>
          <span>{when(to)}</span>
        </>
      )}
    />
  );
}

const DAYS_ES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

function when(t: number): string {
  const d = new Date(t);
  return `${DAYS_ES[d.getDay()]} ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
}
