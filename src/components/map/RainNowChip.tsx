import { memo, useState } from 'react';
import { useRainNowStore } from '../../store/rainNowStore';
import { useUIStore } from '../../store/uiStore';
import { WeatherIcon } from '../icons/WeatherIcons';
import { formatEta } from '../../services/rainNowService';
import type { ArrivalCheck } from '../../services/rainArrivalChecks';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
const toCompass = (deg: number) => COMPASS[Math.round(deg / 45) % 8];
const clock = (ms: number) => new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
const roundKmh = (kmh: number) => Math.max(5, Math.round(kmh / 5) * 5);

/** One line per checked announcement: what was said and what the gauges measured. */
function checkLine(c: ArrivalCheck): string {
  const said = `En ${c.spotName} se avisó para las ${clock(c.dueAt)}`;
  if (c.status === 'arrived') {
    const mm = c.gaugeMm != null ? `, ${c.gaugeMm.toFixed(1).replace('.', ',')} mm` : '';
    return `${said} y llegó a las ${clock(c.seenAt!)} (pluviómetro de ${c.gaugeName}${mm}).`;
  }
  if (c.status === 'arrived-radar') return `${said}; el radar la vio llegar a las ${clock(c.seenAt!)} (no hay pluviómetro cerca).`;
  return `${said} y no llegó.`;
}

/**
 * Toolbar chip of the rain layer: only while it is on. One line for the person in a hurry
 * («LLUEVE» / «~25 min»), and the legend with the detail on tap.
 */
export const RainNowChip = memo(function RainNowChip() {
  const summary = useRainNowStore((s) => s.summary);
  const checks = useRainNowStore((s) => s.checks);
  const dismissToday = useRainNowStore((s) => s.dismissToday);
  const isMobile = useUIStore((s) => s.isMobile);
  const [open, setOpen] = useState(false);
  if (!summary) return null;

  const here = summary.arrivals.filter((a) => a.etaMin === 0);
  const coming = summary.arrivals.filter((a) => a.etaMin > 0).slice(0, 3);
  const approaching = summary.approaching.slice(0, 2);
  const soonest = coming[0]?.etaMin ?? approaching[0]?.etaMin;
  const label = here.length ? 'LLUEVE' : soonest != null ? formatEta(soonest) : 'LLUVIA';
  const checked = checks.filter((c) => c.status !== 'pending').slice(-3).reverse();

  return (
    <div className="relative shrink-0">
      {open && (
        <div className={`z-50 rounded-xl bg-slate-900 border border-slate-700/60 shadow-lg shadow-black/30 text-slate-200 flex flex-col gap-2 ${isMobile ? 'fixed left-2 right-2 px-3 py-2.5' : 'absolute bottom-full mb-2 left-0 w-72 px-3 py-2.5'}`}
          // On a phone the toolbar row scrolls sideways and would clip a panel hanging off it
          style={isMobile ? { bottom: 'calc(52px + 64px + env(safe-area-inset-bottom, 0px))' } : undefined}
          role="dialog" aria-label="Lluvia ahora">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-sky-300 inline-flex items-center gap-1.5"><WeatherIcon id="cloud-rain" size={13} /> Lluvia ahora{summary.sim ? ' (simulada)' : ''}</span>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white text-xs min-w-6 min-h-6" aria-label="Cerrar leyenda"><WeatherIcon id="x" size={12} /></button>
          </div>

          {here.length > 0 && (
            <p className="text-[12px] leading-snug">Está lloviendo en <b>{here.map((a) => a.spotName).join(', ')}</b>.</p>
          )}
          {coming.map((a) => (
            <p key={a.spotId} className="text-[12px] leading-snug">Llega a <b>{a.spotName}</b> en {formatEta(a.etaMin)} <span className="text-slate-400">(a {a.distanceKm} km)</span>.</p>
          ))}
          {approaching.map((a, i) => (
            <p key={i} className="text-[12px] leading-snug">
              Lluvia a {a.distanceKm} km al {toCompass(a.fromDeg)}: viene hacia aquí a unos {roundKmh(a.kmh)} km/h y entraría en {formatEta(a.etaMin)}.
            </p>
          ))}
          {coming.length === 0 && approaching.length === 0 && (summary.motion
            ? <p className="text-[11px] text-slate-300">Se mueve hacia el {toCompass(summary.motion.toDeg)} a unos {roundKmh(summary.motion.kmh)} km/h.</p>
            : <p className="text-[11px] text-slate-400">Sin un rumbo claro: no se anuncia a qué hora llega.</p>)}
          {checked.length > 0 && (
            <div className="flex flex-col gap-0.5 pt-1 border-t border-slate-700/50">
              <span className="text-[10px] uppercase tracking-wide text-slate-500">Comprobado con los pluviómetros</span>
              {checked.map((c) => (
                <p key={c.spotId + c.issuedAt} className={`text-[11px] leading-snug ${c.status === 'missed' ? 'text-amber-300' : 'text-slate-300'}`}>{checkLine(c)}</p>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-1 pt-1 border-t border-slate-700/50">
            <div className="flex items-center gap-3 text-[11px] text-slate-300">
              <span className="inline-flex items-center gap-1"><i className="inline-block w-3 h-3 rounded-sm" style={{ background: 'rgba(96,165,250,0.55)' }} /> débil</span>
              <span className="inline-flex items-center gap-1"><i className="inline-block w-3 h-3 rounded-sm" style={{ background: 'rgba(37,99,235,0.7)' }} /> moderada</span>
              <span className="inline-flex items-center gap-1"><i className="inline-block w-3 h-3 rounded-sm" style={{ background: 'rgba(124,58,237,0.8)' }} /> fuerte</span>
            </div>
            <div className="text-[11px] text-slate-300 inline-flex items-center gap-1.5">
              <i className="inline-block w-2.5 h-2.5 rounded-full border border-white" style={{ background: '#2563eb' }} />
              Pluviómetro que la ha medido (mm en 30 min)
            </div>
            {summary.gauges.length > 0 && (
              <p className="text-[11px] text-slate-400">
                {summary.gauges.slice(0, 3).map((g) => `${g.name} ${g.mm.toFixed(1).replace('.', ',')} mm`).join(' · ')}
                {summary.gauges.length > 3 ? ` y ${summary.gauges.length - 3} más` : ''}
              </p>
            )}
          </div>

          <p className="text-[10px] text-slate-500 leading-snug">
            Zona: radar de <a href="https://www.rainviewer.com/" target="_blank" rel="noopener noreferrer" className="underline">RainViewer</a>{summary.radarAgeMin != null ? `, hace ${summary.radarAgeMin} min` : ' (sin radar ahora: solo pluviómetros)'}.
            Se borra el eco que los pluviómetros de debajo no confirman y el que no se mueve (ecos fijos del radar). Solo se avisa de la lluvia que lleva un rumbo constante. El radar no ve bien la llovizna baja; los pluviómetros sí.
          </p>
          <button onClick={() => { setOpen(false); dismissToday(); }}
            className="self-start text-[11px] text-slate-400 hover:text-white underline underline-offset-2">
            Ocultar hasta mañana
          </button>
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Lluvia ahora: dónde llueve y hacia dónde va"
        className={`flex items-center justify-center rounded-lg font-bold tracking-wide border border-sky-400/50 bg-sky-700/80 text-white transition-colors hover:bg-sky-600/90
          ${isMobile ? 'gap-1 min-w-[44px] min-h-[44px] px-2.5 py-2 text-sm' : 'gap-1.5 px-3 py-1.5 text-[11px]'}`}
      >
        <WeatherIcon id="cloud-rain" size={isMobile ? 16 : 13} />
        {label}
      </button>
    </div>
  );
});
