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
  type KtRange, type WindVsApp, type WaterState, type DirSeen, type ObserverInfo, type ObserverBeta, type ObserverLabRow, type RecentReportSummary,
  betaForSpot, labModelName,
} from '../../services/fieldReport';
import {
  postFieldReport, currentObserverCode, cooldownLeftMin, fetchRecentReports, saveObserverCode,
  pendingObserverCode, resolvePendingObserverCode,
} from '../../api/fieldReportClient';
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
  { v: 180, label: 'S' }, { v: 225, label: 'SW' }, { v: 270, label: 'W' }, { v: 315, label: 'NW' },
];

const SPOT_NAME = new Map<string, string>(ALL_SPOTS.map((s) => [s.id, s.name]));
const fmtWhen = (ms: number) =>
  new Date(ms).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** What an observer with a personal link gets: their last reports and the features still in testing.
 *  Never a shadow forecast before the fact: they are the ones who check the app. */
function ObserverZone({ observer }: { observer: ObserverInfo }) {
  const alphaMode = useUIStore((s) => s.alphaMode);
  const setAlphaMode = useUIStore((s) => s.setAlphaMode);
  return (
    <details className="gf-hint">
      <summary style={{ cursor: 'pointer', color: 'var(--g-ink)', minHeight: 28 }}>Tu zona de observador</summary>
      <div className="flex flex-col" style={{ gap: 4, paddingTop: 4 }}>
        {observer.reports.length === 0
          ? <span>Aún no hay reportes tuyos con este código.</span>
          : observer.reports.slice(0, 8).map((r) => (
            <span key={`${r.time}-${r.spotId}`}>
              <span style={{ color: 'var(--g-ink)' }}>{fmtWhen(r.time)} · {SPOT_NAME.get(r.spotId) ?? r.spotId}</span>: {observerReportWhat(r)}
            </span>
          ))}
        {observer.lab && observer.lab.length > 0 && <ObserverLab rows={observer.lab} />}
        <label className="flex items-center" style={{ gap: 8, paddingTop: 2 }}>
          <input type="checkbox" checked={alphaMode} onChange={(e) => setAlphaMode(e.target.checked)} />
          Ver las funciones en pruebas
        </label>
      </div>
    </details>
  );
}

/** «Laboratorio»: how the models in test did last week at the buoys, afternoons, after the fact only (never a
 *  forecast before it happens: observers are the judges). */
function ObserverLab({ rows }: { rows: ObserverLabRow[] }) {
  return (
    <div className="flex flex-col" style={{ gap: 2, paddingTop: 4 }}>
      <span className="gf-strong" style={{ color: 'var(--g-ink)' }}>Laboratorio · última semana</span>
      <span>Modelos en prueba en las boyas, tardes ya medidas. Error medio y horas de 11 kt o más avisadas.</span>
      {rows.map((r) => (
        <span key={r.model} style={r.champion ? { color: 'var(--g-ink)' } : undefined}>
          {labModelName(r)}: {r.maeKt.toFixed(1)} kt de error
          {r.hits != null ? ` · avisó ${r.hits} de ${r.strongHours}${r.falseAlarms ? `, ${r.falseAlarms} falsas` : ''}` : ''}
          {' '}({r.n} h)
        </span>
      ))}
    </div>
  );
}

/** «Solo para observadores»: the BETA of this spot (today, Cesantes at dusk). They are the judges of
 *  the app, so the figure stays hidden until they report what they see, unless they ask for it;
 *  whether they did travels with the report (beta_seen). Never the map's figure. */
function ObserverBetaNote({ beta, revealed, onReveal }: { beta: ObserverBeta; revealed: boolean; onReveal?: () => void }) {
  const head = <span className="gf-strong">Solo para observadores · BETA</span>;
  const box = 'gf-note gf-note--block gc-t-riesgo';
  const boxStyle = { display: 'flex', flexDirection: 'column', gap: 2, margin: 0 } as const;
  if (!beta.active) {
    return (
      <div className={box} style={boxStyle}>
        {head}
        <span>
          {beta.reason === 'fuera de hora'
            ? 'Al anochecer (16-23 h), tras una tarde de sol, aquí verás cuánto viento suele quedar en el agua.'
            : `Al anochecer hoy no se activa: ${beta.reason ?? 'faltan datos'}.`}
        </span>
      </div>
    );
  }
  return (
    <div className={box} style={boxStyle}>
      {head}
      <span>Al caer el sol, el agua aquí suele seguir al viento de Porto de Vigo.</span>
      {revealed && beta.estimateKt != null ? (
        <span className="gf-strong">
          Ahora unos {Math.round(beta.estimateKt)} kt{beta.appKt != null ? ` (la app marca ${Math.round(beta.appKt)})` : ''}. Puede fallar: tu reporte la juzga.
        </span>
      ) : (
        <div className="flex items-center justify-between" style={{ gap: 8 }}>
          <span className="gf-hint">Reporta primero lo que ves y te la enseñamos.</span>
          {onReveal && <button type="button" onClick={onReveal} className="gf-more">Verla ya</button>}
        </div>
      )}
    </div>
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
      <button type="button" onClick={() => setOpen(true)} className="gf-more" style={{ fontWeight: 400, fontSize: 12.5 }}>
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
    <div className="flex flex-col" style={{ gap: 4, width: '100%', fontWeight: 400 }}>
      <div className="flex" style={{ gap: 4 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Pega tu código o tu enlace"
          aria-label="Código de observador"
          className="gf-input"
        />
        <button type="button" onClick={save} className="gf-opt" style={{ flex: '0 0 auto', padding: '0 12px' }}>Guardar</button>
      </div>
      {msg && <span style={{ fontSize: 13 }}>{msg}</span>}
    </div>
  );
}

export function SpotReportBox({ spotId, shownWindKt, shownVerdict }: Props) {
  const [wind, setWind] = useState<WindVsApp | null>(null);
  const [water, setWater] = useState<WaterState | null>(null);
  const [dir, setDir] = useState<DirSeen | null>(null);
  const [kt, setKt] = useState<KtRange | null>(null);
  const { observer, refresh } = useObserver();
  const [pending, setPending] = useState(() => pendingObserverCode() != null);
  const answerPending = (useIt: boolean) => { resolvePendingObserverCode(useIt); setPending(false); if (useIt) void refresh(); };
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [recent, setRecent] = useState<RecentReportSummary | null>(null);
  const [betaRevealed, setBetaRevealed] = useState(false);
  const beta = betaForSpot(observer, spotId);

  useEffect(() => {
    let alive = true;
    fetchRecentReports(spotId).then((s) => { if (alive) setRecent(s); });
    return () => { alive = false; };
  }, [spotId]);

  // What others said, labelled as theirs: it never moves the verdict or the figure above.
  const said = recent && (
    <div className="flex flex-col" style={{ gap: 1 }}>
      <span className="gf-hint">En el agua, {recentReportWhen(recent)}</span>
      <span className="gf-strong" style={{ fontSize: 14 }}>{recentReportWhat(recent)}</span>
    </div>
  );

  if (state === 'sent') {
    return (
      <div className="gf-ask">
        <p>
          Gracias{observer ? `, ${observer.name}` : ''}. Con esto comprobamos y afinamos la app en este sitio.
        </p>
        {beta && <ObserverBetaNote beta={beta} revealed />}
        {observer && <ObserverZone observer={observer} />}
      </div>
    );
  }

  const wait = cooldownLeftMin(spotId);
  if (wait > 0) {
    const note = <span className="gf-hint">Ya enviaste un reporte de este sitio. Puedes mandar otro en {wait} min.</span>;
    return <div className="gf-ask">{said}{note}{beta && <ObserverBetaNote beta={beta} revealed />}{observer && <ObserverZone observer={observer} />}</div>;
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
      betaSeen: beta?.active === true && betaRevealed,
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
    <div className="gf-ask">
      {said}
      {beta && <ObserverBetaNote beta={beta} revealed={betaRevealed} onReveal={() => setBetaRevealed(true)} />}
      {pending && (
        <div className="gf-note gf-note--block gc-t-alto" style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: 0 }}>
          <span>
            Has abierto el enlace de otro observador{observer ? ` y aquí reportas como ${observer.name}` : ''}. ¿Pasas a usar ese?
          </span>
          <div className="gf-opts" style={{ ['--n' as string]: 2 } as React.CSSProperties}>
            <button type="button" className="gf-opt" onClick={() => answerPending(true)}>Sí, usar el nuevo</button>
            <button type="button" className="gf-opt" onClick={() => answerPending(false)}>No, seguir igual</button>
          </div>
        </div>
      )}
      <p>
        {observer ? '' : 'Solo si ves el agua. '}El viento real frente a {shownWindKt != null ? `los ${Math.round(shownWindKt)} kt` : 'lo que dice la app'}:
      </p>
      <div className="gf-opts">
        {WIND.map((o) => (
          <button key={o.v} type="button" className="gf-opt" aria-pressed={wind === o.v} onClick={() => setWind(o.v)}>
            {o.label}
          </button>
        ))}
      </div>
      {observer ? <small className="gf-hint">Observador: {observer.name}</small> : wind === null && <CodeEntry onSaved={refresh} />}
      {wind !== null && (
        <>
          <div className="flex flex-col" style={{ gap: 4 }}>
            <p>El agua <span>(si quieres)</span>:</p>
            <div className="gf-opts" style={{ ['--n' as string]: 2 } as React.CSSProperties}>
              {WATER.map((o) => (
                <button key={o.v} type="button" className="gf-opt" aria-pressed={water === o.v} onClick={() => setWater(water === o.v ? null : o.v)}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col" style={{ gap: 4 }}>
            <p>De dónde viene <span>(los barcos fondeados apuntan hacia el viento)</span>:</p>
            <div className="gf-opts" style={{ ['--n' as string]: 4 } as React.CSSProperties}>
              {DIRS.map((o) => (
                <button key={o.v} type="button" className="gf-opt" aria-pressed={dir === o.v} onClick={() => setDir(dir === o.v ? null : o.v)}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          {observer && (
            <div className="flex flex-col" style={{ gap: 4 }}>
              <p>Nudos que ves <span>(si lo tienes claro)</span>:</p>
              <div className="gf-opts">
                {KT_RANGES.map(([lo, hi], i) => (
                  <button key={i} type="button" className="gf-opt" aria-pressed={kt === i} onClick={() => setKt(kt === i ? null : (i as KtRange))}>
                    {ktRangeLabel(lo, hi)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {conflict && (
            <div className="gf-note gf-note--block gc-t-alto" style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: 0 }}>
              <span>{conflictText[conflict]}</span>
              <button type="button" className="gf-opt" onClick={() => setWind(wantsMore ? 1 : -1)}>
                {wantsMore ? 'Sí, más viento' : 'Sí, menos viento'}
              </button>
            </div>
          )}
          <div className="flex items-center" style={{ gap: 6 }}>
            <button
              type="button"
              disabled={state === 'sending'}
              onClick={send}
              className="gc-btn gc-btn--primary gc-btn--grow"
            >
              {state === 'sending' ? 'Enviando…' : 'Enviar'}
            </button>
            <button type="button" onClick={reset} className="gc-btn gc-btn--plain">
              Cancelar
            </button>
          </div>
          {state === 'error' && <span style={{ fontSize: 13 }}>No se pudo enviar. Prueba en un rato.</span>}
        </>
      )}
      {observer && <ObserverZone observer={observer} />}
    </div>
  );
}
