import { useState, useEffect } from 'react';
import { WeatherIcon } from '../icons/WeatherIcons';

const HIST_W = 300;
const HIST_H = 70;

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
    <div className="mt-1.5 pt-1.5 border-t border-slate-700/40">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-300 transition-colors w-full text-left"
      >
        <WeatherIcon id="activity" size={12} className="shrink-0" />
        <span className="font-semibold">Historial spot 48h (diurno)</span>
        <span className="text-slate-500 ml-auto">{open ? '\u25B2' : '\u25BC'}</span>
      </button>
      {open && (
        <div className="mt-2">
          {!loaded ? (
            <p className="text-[10px] text-slate-500">Cargando...</p>
          ) : data.length < 6 ? (
            <p className="text-[10px] text-slate-500">Sin datos suficientes (el ingestor necesita acumular lecturas)</p>
          ) : (
            <SpotWindChart data={data} />
          )}
        </div>
      )}
    </div>
  );
}

function SpotWindChart({ data }: { data: { time: string; wind_kt: number }[] }) {
  const maxKt = Math.max(...data.map((d) => d.wind_kt), 8);
  const gridStep = maxKt > 20 ? 10 : 5;
  const padL = 28;
  const padR = 4;
  const padT = 4;
  const padB = 16;
  const chartW = HIST_W - padL - padR;
  const chartH = HIST_H - padT - padB;
  const step = chartW / (data.length - 1);

  const points = data.map((d, i) => ({
    x: padL + i * step,
    y: padT + chartH - (d.wind_kt / maxKt) * chartH,
  }));

  let path = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const cpx = (prev.x + curr.x) / 2;
    path += ` Q${cpx.toFixed(1)},${prev.y.toFixed(1)} ${curr.x.toFixed(1)},${curr.y.toFixed(1)}`;
  }

  const areaPath = path + ` L${points[points.length - 1].x.toFixed(1)},${padT + chartH} L${padL},${padT + chartH} Z`;

  const DAYS_ES = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
  const fmtShort = (t: string) => {
    const d = new Date(t);
    return `${d.getHours().toString().padStart(2, '0')}h`;
  };
  const fmtDay = (t: string) => {
    const d = new Date(t);
    return `${DAYS_ES[d.getDay()]} ${d.getHours().toString().padStart(2, '0')}h`;
  };

  const dayBreaks: number[] = [];
  for (let i = 1; i < data.length; i++) {
    const prev = new Date(data[i - 1].time).getDate();
    const curr = new Date(data[i].time).getDate();
    if (curr !== prev) dayBreaks.push(i);
  }

  const labelCount = 4;
  const labelIndices = Array.from({ length: labelCount }, (_, i) =>
    Math.round((i * (data.length - 1)) / (labelCount - 1))
  );

  return (
    <svg width={HIST_W} height={HIST_H} className="w-full" style={{ maxWidth: HIST_W }}>
      {Array.from({ length: Math.floor(maxKt / gridStep) + 1 }, (_, i) => {
        const kt = i * gridStep;
        if (kt === 0) return null;
        const y = padT + chartH - (kt / maxKt) * chartH;
        return (
          <g key={kt}>
            <line x1={padL} y1={y} x2={HIST_W - padR} y2={y} stroke="#334155" strokeWidth="0.5" strokeDasharray="3,3" />
            <text x={padL - 3} y={y + 3} fill="#64748b" fontSize="9" textAnchor="end">{kt}</text>
          </g>
        );
      })}
      {dayBreaks.map((idx) => {
        const x = padL + idx * step;
        return (
          <line key={`day-${idx}`} x1={x} y1={padT} x2={x} y2={padT + chartH} stroke="#475569" strokeWidth="0.5" strokeDasharray="2,2" />
        );
      })}
      <text x={2} y={padT + 8} fill="#64748b" fontSize="8">kt</text>
      <path d={areaPath} fill="rgba(56,189,248,0.08)" />
      <path d={path} fill="none" stroke="#38bdf8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {labelIndices.map((idx) => {
        const x = padL + idx * step;
        const anchor = idx === 0 ? 'start' : idx === data.length - 1 ? 'end' : 'middle';
        const isFirst = idx === labelIndices[0];
        return (
          <text key={idx} x={x} y={HIST_H - 2} fill="#64748b" fontSize="8" textAnchor={anchor}>
            {isFirst || dayBreaks.some((b) => Math.abs(b - idx) < data.length / 8) ? fmtDay(data[idx].time) : fmtShort(data[idx].time)}
          </text>
        );
      })}
    </svg>
  );
}
