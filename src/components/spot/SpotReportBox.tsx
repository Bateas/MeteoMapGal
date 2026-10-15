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
import {
  KT_RANGES, ktRangeLabel, observerReportWhat, recentReportWhat, recentReportWhen, reportConflict,
  type KtRange, type WindVsApp, type WaterState, type DirSeen, type ObserverInfo, type RecentReportSummary,
} from '../../services/fieldReport';
import { postFieldReport, currentObserverCode, cooldownLeftMin, fetchRecentReports, saveObserverCode } from '../../api/fieldReportClient';
import { useObserver } from '../../hooks/useObserver';
import { useUIStore } from '../../store/uiStore';
import { ALL_SPOTS } from '../../config/spots';
import { APP_VERSION } from '../../config/version';

interface Props {
  spotId: string;
  shownWindKt: number | null;
  shownVerdict: SpotVerdict;
}

// «Más viento», not «Más»: on 15-oct «Menos» was tapped meaning «the app says less».
const WIND: { v: WindVsApp; label: string }[] = [
  { v: 1, label: 'Más viento' },
  { v: 0, label: 'Igual' },
  { v: -1, label: 'Menos viento' },
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

const SPOT_NAME = new Map<string, string>(ALL_SPOTS.map((s) => [s.id, s.name]));
const fmtWhen = (ms: number) =>
  new Date(ms).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** What an observer with a personal link gets: their last reports and the features still in testing.
 *  Never a shadow forecast before the fact: they are the ones who check the app. */
function ObserverZone({ observer }: { observer: ObserverInfo }) {
  const alphaMode = useUIStore((s) => s.alphaMode);
  const setAlphaMode = useUIStore((s) => s.setAlphaMode);
  return (
    <details className="text-[11px] text-slate-400" style={{ paddingTop: '4px', borderTop: '1px solid rgba(148,163,184,.25)' }}>
      <summary className="cursor-pointer text-slate-300">Tu zona de observador</summary>
      <div className="flex flex-col gap-1" style={{ paddingTop: '4px' }}>
        {observer.reports.length === 0
          ? <span>Aún no hay reportes tuyos con este código.</span>
          : observer.reports.slice(0, 8).map((r) => (
            <span key={`${r.time}-${r.spotId}`}>
              <span className="text-slate-300">{fmtWhen(r.time)} · {SPOT_NAME.get(r.spotId) ?? r.spotId}</span>: {observerReportWhat(r)}
            </span>
          ))}
        <label className="flex items-center gap-2" style={{ paddingTop: '2px' }}>
          <input type="checkbox" checked={alphaMode} onChange={(e) => setAlphaMode(e.target.checked)} />
          Ver las funciones en pruebas
        </label>
      </div>
    </details>
  );
}

/** For whoever has a code but opened the app without the link (an iPhone home-screen app keeps
 *  its own storage, apart from Safari). Accepts the code or the whole link. */
function CodeEntry({ onSaved }: { onSaved: () => Promise<ObserverInfo | null> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="self-end text-[10px] text-slate-500 hover:text-slate-300">
        Código de observador
      </button>
    );
  }
  const save = async () => {
    if (!saveObserverCode(text)) { setMsg('Ese código no tiene el formato bueno.'); return; }
    const o = await onSaved();
    setMsg(o ? null : 'Ese código no existe o está desactivado.');
    if (o) setOpen(false);
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Pega tu código o tu enlace"
          aria-label="Código de observador"
          className="min-h-8 flex-1 rounded border border-slate-600 bg-slate-900 text-[12px] text-slate-200"
          style={{ padding: '0 6px', minWidth: 0 }}
        />
        <button type="button" onClick={save} className={chip(false)} style={{ flex: '0 0 auto', padding: '0 10px' }}>Guardar</button>
      </div>
      {msg && <span className="text-[11px] text-amber-300">{msg}</span>}
    </div>
  );
}

export function SpotReportBox({ spotId, shownWindKt, shownVerdict }: Props) {
  const [wind, setWind] = useState<WindVsApp | null>(null);
  const [water, setWater] = useState<WaterState | null>(null);
  const [dir, setDir] = useState<DirSeen | null>(null);
  const [kt, setKt] = useState<KtRange | null>(null);
  const { observer, refresh } = useObserver();
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
      <div className={CARD} style={CARD_STYLE}>
        <p className="text-[11px] text-emerald-300">
          Gracias{observer ? `, ${observer.name}` : ''}. Con esto comprobamos y afinamos la app en este sitio.
        </p>
        {observer && <ObserverZone observer={observer} />}
      </div>
    );
  }

  const wait = cooldownLeftMin(spotId);
  if (wait > 0) {
    const note = <span className="text-[11px] text-slate-400">Ya enviaste un reporte de este sitio. Puedes mandar otro en {wait} min.</span>;
    return said || observer
      ? <div className={CARD} style={CARD_STYLE}>{said}{note}{observer && <ObserverZone observer={observer} />}</div>
      : <p style={{ marginBottom: '6px' }}>{note}</p>;
  }

  const send = async () => {
    if (wind === null) return;
    setState('sending');
    const ok = await postFieldReport({
      spotId,
      windVsApp: wind,
      waterState: water,
      dirSeen: dir,
      ktRange: observer ? kt : null,
      appWindKt: shownWindKt,
      appVerdict: shownVerdict,
      appVersion: APP_VERSION,
      observerCode: currentObserverCode(),
    });
    setState(ok ? 'sent' : 'error');
    if (ok && observer) void refresh();
  };

  const reset = () => { setWind(null); setWater(null); setDir(null); setKt(null); setState('idle'); };
  const conflict = reportConflict(wind, water, shownWindKt, observer ? kt : null);
  const wantsMore = conflict === 'less-with-foam' || conflict === 'less-with-knots';
  const conflictText: Record<NonNullable<typeof conflict>, string> = {
    'less-with-foam': `Con espuma suele haber más de 8-10 kt y la app dice ${Math.round(shownWindKt ?? 0)}. ¿Querías decir «Más viento»?`,
    'more-with-mirror': 'Con el agua como un espejo casi no hay viento. ¿Querías decir «Menos viento»?',
    'less-with-knots': `Has marcado más nudos que los ${Math.round(shownWindKt ?? 0)} de la app. ¿Querías decir «Más viento»?`,
    'more-with-knots': `Has marcado menos nudos que los ${Math.round(shownWindKt ?? 0)} de la app. ¿Querías decir «Menos viento»?`,
  };

  return (
    <div className={CARD} style={CARD_STYLE}>
      {said}
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-semibold text-sky-200">¿Estás aquí ahora?</span>
        <span className="text-[10px] text-slate-500">{observer ? `observador: ${observer.name}` : 'solo si ves el agua'}</span>
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
          {observer && (
            <div className="flex flex-col gap-1">
              <p className="text-[11px] text-slate-300">Nudos que ves <span className="text-slate-500">(si lo tienes claro)</span>:</p>
              <div className="grid grid-cols-3 gap-1">
                {KT_RANGES.map(([lo, hi], i) => (
                  <button key={i} type="button" className={chip(kt === i)} aria-pressed={kt === i} onClick={() => setKt(kt === i ? null : (i as KtRange))}>
                    {ktRangeLabel(lo, hi)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {conflict && (
            <div className="flex flex-col gap-1 rounded border border-amber-500/40 bg-amber-500/10" style={{ padding: '4px 6px' }}>
              <span className="text-[11px] text-amber-200">{conflictText[conflict]}</span>
              <button type="button" className={chip(false)} onClick={() => setWind(wantsMore ? 1 : -1)}>
                {wantsMore ? 'Sí, más viento' : 'Sí, menos viento'}
              </button>
            </div>
          )}
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
      {observer ? <ObserverZone observer={observer} /> : wind === null && <CodeEntry onSaved={refresh} />}
    </div>
  );
}
