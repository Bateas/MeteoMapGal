/**
 * "¿Coincide con lo que ves?" — a collapsed line at the foot of a wind spot's popup. Opened, it asks
 * two FACTS (more / same / less wind than the figure shown; how much whitecap) and sends them as a
 * label for checking the app. Nothing reported is ever drawn on the map.
 */
import { useState } from 'react';
import type { SpotVerdict } from '../../services/spotScoringEngine';
import type { WindVsApp, Whitecaps } from '../../services/fieldReport';
import { postFieldReport, currentObserverCode, cooldownLeftMin } from '../../api/fieldReportClient';
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
const FOAM: { v: Whitecaps; label: string }[] = [
  { v: 0, label: 'Nada' },
  { v: 1, label: 'Algo' },
  { v: 2, label: 'Mucha' },
];

const chip = (active: boolean) =>
  `flex-1 rounded border px-2 py-1.5 text-[12px] transition-colors ${
    active ? 'border-sky-400 bg-sky-500/20 text-sky-200' : 'border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700'
  }`;

export function SpotReportBox({ spotId, shownWindKt, shownVerdict }: Props) {
  const [open, setOpen] = useState(false);
  const [wind, setWind] = useState<WindVsApp | null>(null);
  const [foam, setFoam] = useState<Whitecaps | null>(null);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full text-left text-[11px] text-slate-400 hover:text-sky-300 mt-1.5 pt-1 border-t border-slate-700/30"
      >
        ¿Estás en el agua? Dinos si coincide con lo que ves
      </button>
    );
  }

  if (state === 'sent') {
    return (
      <p className="text-[11px] text-emerald-300 mt-1.5 pt-1 border-t border-slate-700/30">
        Gracias. Lo usamos para comprobar la app; no se muestra en el mapa.
      </p>
    );
  }

  const wait = cooldownLeftMin(spotId);
  if (wait > 0) {
    return (
      <p className="text-[11px] text-slate-400 mt-1.5 pt-1 border-t border-slate-700/30">
        Ya enviaste un reporte de este sitio. Puedes mandar otro en {wait} min.
      </p>
    );
  }

  const send = async () => {
    if (wind === null) return;
    setState('sending');
    const ok = await postFieldReport({
      spotId,
      windVsApp: wind,
      whitecaps: foam,
      appWindKt: shownWindKt,
      appVerdict: shownVerdict,
      appVersion: APP_VERSION,
      observerCode: currentObserverCode(),
    });
    setState(ok ? 'sent' : 'error');
  };

  return (
    <div className="mt-1.5 pt-1.5 border-t border-slate-700/30 space-y-1.5">
      <p className="text-[11px] text-slate-400">Solo si estás viendo el agua ahora mismo.</p>
      <div>
        <p className="text-[11px] text-slate-300 mb-1">
          Viento, comparado con {shownWindKt != null ? `los ${Math.round(shownWindKt)} kt` : 'lo que dice la app'}:
        </p>
        <div className="flex gap-1">
          {WIND.map((o) => (
            <button key={o.v} type="button" className={chip(wind === o.v)} aria-pressed={wind === o.v} onClick={() => setWind(o.v)}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-[11px] text-slate-300 mb-1">Espuma en el agua:</p>
        <div className="flex gap-1">
          {FOAM.map((o) => (
            <button key={o.v} type="button" className={chip(foam === o.v)} aria-pressed={foam === o.v} onClick={() => setFoam(foam === o.v ? null : o.v)}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={wind === null || state === 'sending'}
          onClick={send}
          className="rounded border border-sky-500 bg-sky-600/30 px-4 py-1.5 text-[12px] text-sky-100 disabled:opacity-40"
        >
          {state === 'sending' ? 'Enviando…' : 'Enviar'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-[11px] text-slate-500 hover:text-slate-300">
          Cancelar
        </button>
        {state === 'error' && <span className="text-[11px] text-rose-300">No se pudo enviar. Prueba en un rato.</span>}
      </div>
    </div>
  );
}
