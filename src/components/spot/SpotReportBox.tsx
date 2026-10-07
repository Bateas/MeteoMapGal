/**
 * "¿Estás aquí ahora?" — a small card right under a wind spot's wind figure. It asks FACTS: more /
 * same / less wind than the figure shown, then (optional) what the water looks like and where the
 * wind comes from, and sends them as a label for checking the app. Nothing reported is drawn on the map;
 * on top of the card, what was said here in the last two hours, grouped and anonymous (never the verdict).
 * It sits next to the number it asks about and the main answer is one tap away: at the foot of a
 * thirty-section popup, folded into a grey line, almost nobody found it.
 */
import { useEffect, useState } from 'react';
import type { SpotVerdict } from '../../services/spotScoringEngine';
import { recentReportWhat, recentReportWhen, type WindVsApp, type WaterState, type DirSeen, type RecentReportSummary } from '../../services/fieldReport';
import { postFieldReport, currentObserverCode, cooldownLeftMin, fetchRecentReports } from '../../api/fieldReportClient';
import { APP_VERSION } from '../../config/version';

interface Props {
  spotId: string;
  shownWindKt: number | null;
  shownVerdict: SpotVerdict;
}

const WIND: { v: WindVsApp; label: string }[] = [
  { v: 1, label: 'Más' },
  { v: 0, label: 'Igual' },
  { v: -1, label: 'Menos' },
];
// Plain words, agreed with a sailor: the sea-state term "rizada" was read as something else.
const WATER: { v: WaterState; label: string }[] = [
  { v: 0, label: 'Espejo' },
  { v: 1, label: 'Movida, sin espuma' },
  { v: 2, label: 'Algo de espuma' },
  { v: 3, label: 'Mucha espuma' },
];
const DIRS: { v: DirSeen; label: string }[] = [
  { v: 0, label: 'N' }, { v: 45, label: 'NE' }, { v: 90, label: 'E' }, { v: 135, label: 'SE' },
  { v: 180, label: 'S' }, { v: 225, label: 'SO' }, { v: 270, label: 'O' }, { v: 315, label: 'NO' },
];

// Spacing is set inline: the global reset in index.css still zeroes Tailwind's padding and margin.
const chip = (active: boolean, tall = false) =>
  `flex-1 ${tall ? 'min-h-9 text-[13px] font-semibold' : 'min-h-8 text-[12px]'} rounded border transition-colors ${
    active ? 'border-sky-400 bg-sky-500/25 text-sky-100' : 'border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700'
  }`;

const CARD = 'rounded-md border border-sky-500/30 bg-sky-500/5 flex flex-col gap-1.5';
const CARD_STYLE = { padding: '6px 8px', marginBottom: '6px' };

export function SpotReportBox({ spotId, shownWindKt, shownVerdict }: Props) {
  const [wind, setWind] = useState<WindVsApp | null>(null);
  const [water, setWater] = useState<WaterState | null>(null);
  const [dir, setDir] = useState<DirSeen | null>(null);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [recent, setRecent] = useState<RecentReportSummary | null>(null);

  useEffect(() => {
    let alive = true;
    fetchRecentReports(spotId).then((s) => { if (alive) setRecent(s); });
    return () => { alive = false; };
  }, [spotId]);

  // What others said, labelled as theirs: it never moves the verdict or the figure above.
  const said = recent && (
    <div className="flex flex-col gap-0.5" style={{ paddingBottom: '6px', borderBottom: '1px solid rgba(148,163,184,.25)' }}>
      <span className="text-[11px] text-slate-400">En el agua, {recentReportWhen(recent)}</span>
      <span className="text-[12px] font-semibold text-slate-100">{recentReportWhat(recent)}</span>
    </div>
  );

  if (state === 'sent') {
    return (
      <p className={`${CARD} text-[11px] text-emerald-300`} style={CARD_STYLE}>
        Gracias. Con esto comprobamos y afinamos la app en este sitio.
      </p>
    );
  }

  const wait = cooldownLeftMin(spotId);
  if (wait > 0) {
    const note = <span className="text-[11px] text-slate-400">Ya enviaste un reporte de este sitio. Puedes mandar otro en {wait} min.</span>;
    return said ? <div className={CARD} style={CARD_STYLE}>{said}{note}</div> : <p style={{ marginBottom: '6px' }}>{note}</p>;
  }

  const send = async () => {
    if (wind === null) return;
    setState('sending');
    const ok = await postFieldReport({
      spotId,
      windVsApp: wind,
      waterState: water,
      dirSeen: dir,
      appWindKt: shownWindKt,
      appVerdict: shownVerdict,
      appVersion: APP_VERSION,
      observerCode: currentObserverCode(),
    });
    setState(ok ? 'sent' : 'error');
  };

  const reset = () => { setWind(null); setWater(null); setDir(null); setState('idle'); };

  return (
    <div className={CARD} style={CARD_STYLE}>
      {said}
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-semibold text-sky-200">¿Estás aquí ahora?</span>
        <span className="text-[10px] text-slate-500">solo si ves el agua</span>
      </div>
      <p className="text-[11px] text-slate-300">
        El viento real, comparado con {shownWindKt != null ? `los ${Math.round(shownWindKt)} kt` : 'lo que dice la app'}:
      </p>
      <div className="flex gap-1">
        {WIND.map((o) => (
          <button key={o.v} type="button" className={chip(wind === o.v, true)} aria-pressed={wind === o.v} onClick={() => setWind(o.v)}>
            {o.label}
          </button>
        ))}
      </div>
      {wind !== null && (
        <>
          <div className="flex flex-col gap-1">
            <p className="text-[11px] text-slate-300">El agua <span className="text-slate-500">(si quieres)</span>:</p>
            <div className="grid grid-cols-2 gap-1">
              {WATER.map((o) => (
                <button key={o.v} type="button" className={chip(water === o.v)} aria-pressed={water === o.v} onClick={() => setWater(water === o.v ? null : o.v)}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-[11px] text-slate-300">De dónde viene <span className="text-slate-500">(los barcos fondeados apuntan hacia el viento)</span>:</p>
            <div className="grid grid-cols-8 gap-1">
              {DIRS.map((o) => (
                <button key={o.v} type="button" className={chip(dir === o.v)} aria-pressed={dir === o.v} onClick={() => setDir(dir === o.v ? null : o.v)}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={state === 'sending'}
              onClick={send}
              className="min-h-9 flex-1 rounded border border-sky-500 bg-sky-600/40 text-[13px] font-semibold text-sky-50 disabled:opacity-40"
            >
              {state === 'sending' ? 'Enviando…' : 'Enviar'}
            </button>
            <button type="button" onClick={reset} className="text-[11px] text-slate-500 hover:text-slate-300">
              Cancelar
            </button>
          </div>
          {state === 'error' && <span className="text-[11px] text-rose-300">No se pudo enviar. Prueba en un rato.</span>}
        </>
      )}
    </div>
  );
}
