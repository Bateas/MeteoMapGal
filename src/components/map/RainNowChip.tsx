import { memo, useEffect, useState } from 'react';
import { useRainNowStore } from '../../store/rainNowStore';
import { useUIStore } from '../../store/uiStore';
import { WeatherIcon } from '../icons/WeatherIcons';
import { formatEta } from '../../services/rainNowService';
import { degreesToCardinal } from '../../services/windUtils';
import type { ArrivalCheck } from '../../services/rainArrivalChecks';
import { spokenStationName } from '../../services/rainNowcastService';

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
 * («Llueve» / «~25 min»), and the legend with the detail on tap.
 */
export const RainNowChip = memo(function RainNowChip() {
  const summary = useRainNowStore((s) => s.summary);
  const checks = useRainNowStore((s) => s.checks);
  const dismissToday = useRainNowStore((s) => s.dismissToday);
  const isMobile = useUIStore((s) => s.isMobile);
  const [open, setOpen] = useState(false);
  // Escape closes it, like every other panel over the map (18-nov: it stayed open under a card).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  if (!summary) return null;

  const here = summary.arrivals.filter((a) => a.etaMin === 0);
  const coming = summary.arrivals.filter((a) => a.etaMin > 0).slice(0, 3);
  const approaching = summary.approaching.slice(0, 2);
  const soonest = coming[0]?.etaMin ?? approaching[0]?.etaMin;
  const label = here.length ? 'Llueve' : soonest != null ? formatEta(soonest) : 'Lluvia';
  const checked = checks.filter((c) => c.status !== 'pending').slice(-3).reverse();

  return (
    <div className="relative shrink-0">
      {open && (
        <div className={`g-theme gc-popover z-50 ${isMobile ? 'fixed left-2 right-2' : 'absolute left-0 w-80'}`}
          // On a phone the toolbar row scrolls sideways and would clip a panel hanging off it
          style={isMobile ? { bottom: 'calc(52px + 64px + env(safe-area-inset-bottom, 0px))' } : { bottom: 'calc(100% + 6px)' }}
          role="dialog" aria-label="Lluvia ahora" data-escape-first="">
          <div className="gc-popover-body">
            <div className="gc-popover-head">
              <span className="inline-flex items-center gap-1.5"><WeatherIcon id="cloud-rain" size={15} /> Lluvia ahora{summary.sim ? ' (simulada)' : ''}</span>
              <button type="button" onClick={() => setOpen(false)} className="gc-btn gc-btn--plain gc-btn--icon" aria-label="Cerrar leyenda"><WeatherIcon id="x" size={14} /></button>
            </div>

            {here.length > 0 && (
              <p>Está lloviendo en <b>{here.map((a) => a.spotName).join(', ')}</b>.</p>
            )}
            {coming.map((a) => (
              <p key={a.spotId}>Llega a <b>{a.spotName}</b> en {formatEta(a.etaMin)} <span className="gc-note">(a {a.distanceKm} km)</span>.</p>
            ))}
            {approaching.map((a, i) => (
              <p key={i}>
                {/* Already raining here, the next patch is more rain, not the start of it (18-nov). */}
                {here.length > 0 ? 'Más lluvia' : 'Lluvia'} a {a.distanceKm} km al {degreesToCardinal(a.fromDeg)}: viene hacia aquí a unos {roundKmh(a.kmh)} km/h y entraría en {formatEta(a.etaMin)}.
              </p>
            ))}
            {coming.length === 0 && approaching.length === 0 && (summary.motion
              ? <p>Se mueve hacia el {degreesToCardinal(summary.motion.toDeg)} a unos {roundKmh(summary.motion.kmh)} km/h.</p>
              : <p className="gc-note">Sin un rumbo claro: no se anuncia a qué hora llega.</p>)}
            {checked.length > 0 && (
              <div className="gc-popover-section">
                <span className="gc-note-strong">Comprobado con los pluviómetros</span>
                {checked.map((c) => (
                  <p key={c.spotId + c.issuedAt} className={c.status === 'missed' ? 'gc-note-strong' : 'gc-note'}>{checkLine(c)}</p>
                ))}
              </div>
            )}

            <div className="gc-popover-section">
              <div className="gc-swatchline">
                <span><i style={{ background: 'rgba(96,165,250,0.55)' }} /> débil</span>
                <span><i style={{ background: 'rgba(37,99,235,0.7)' }} /> moderada</span>
                <span><i style={{ background: 'rgba(124,58,237,0.8)' }} /> fuerte</span>
              </div>
              <div className="gc-swatchline">
                <span><i style={{ background: '#2563eb', borderRadius: '50%', border: '1px solid var(--g-ink)' }} /> Pluviómetro que la ha medido (mm/h)</span>
              </div>
              <p className="gc-note">La flecha llega hasta donde estaría esa lluvia en media hora.</p>
              {summary.gauges.length > 0 && (
                <p className="gc-note">
                  {summary.gauges.slice(0, 3).map((g) => `${spokenStationName(g.id, g.name)} ${g.mmPerHour.toFixed(1).replace('.', ',')} mm/h`).join(', ')}
                  {summary.gauges.length > 3 ? ` y ${summary.gauges.length - 3} más` : ''}
                </p>
              )}
            </div>

            <p className="gc-small">
              Zona: radar de <a href="https://www.rainviewer.com/" target="_blank" rel="noopener noreferrer">RainViewer</a>{summary.radarAgeMin != null ? `, hace ${summary.radarAgeMin} min` : ' (sin radar ahora: solo pluviómetros)'}.
            </p>
            {/* How it is drawn: for whoever asks, folded (18-nov: three sentences of method in a legend). */}
            <details className="gc-small">
              <summary>Cómo se dibuja</summary>
              Se borra el eco que los pluviómetros de debajo no confirman y el que no se mueve (ecos fijos del radar). Solo se avisa de la lluvia que lleva un rumbo constante. El radar no ve bien la llovizna baja; los pluviómetros sí.
            </details>
            <button type="button" onClick={() => { setOpen(false); dismissToday(); }} className="gc-linkbtn">
              Ocultar hasta mañana
            </button>
          </div>
        </div>
      )}
      <button
        type="button"
        className="gc-tool"
        data-state={open ? undefined : 'rain'}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Lluvia ahora: dónde llueve y hacia dónde va"
      >
        <WeatherIcon id="cloud-rain" size={isMobile ? 18 : 15} />
        {label}
      </button>
    </div>
  );
});
