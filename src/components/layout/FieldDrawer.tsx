/**
 * FieldDrawer: Condiciones. One column that answers one question: «is there anything here, today or
 * tomorrow, that would change my plan, apart from the wind at my spot?».
 *
 * The same list as the strip on the map and the dot in the header (useConditionsList): Ahora, Hoy y
 * mañana, Mareas (coast only) and En el campo (folded, without alert colours). Numbers stay folded
 * under each line, so nothing is lost and nothing shouts. It is not mounted while closed: no polling
 * and nothing to tab into. Overlays the map, doesn't touch the sidebar.
 */

import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useConditionsList } from '../../hooks/useConditionsList';
import { useForecastStore } from '../../hooks/useForecastTimeline';
import { useRainNowStore } from '../../store/rainNowStore';
import { useSectorStore } from '../../store/sectorStore';
import { useUIStore } from '../../store/uiStore';
import { isCoastalSector } from '../../config/sectors';
import { getLunarCalendar, getLunarPhase } from '../../services/lunarService';
import { measuredIntensity } from '../../services/alerts/rainNowAlerts';
import {
  buildFrostStrip,
  buildHourStrip,
  type ConditionLine,
  type HourStrip,
} from '../../services/alerts/conditionsList';
import type { AlertLevel } from '../../types/campo';
import { NotificationControl } from '../map/NotificationControl';
import { WeatherIcon, type IconId } from '../icons/WeatherIcons';
import '../../styles/condiciones.css';

const TidePanel = lazy(() => import('../dashboard/TidePanel').then((m) => ({ default: m.TidePanel })));

interface FieldDrawerProps {
  onClose: () => void;
}

export function FieldDrawer({ onClose }: FieldDrawerProps) {
  const isMobile = useUIStore((s) => s.isMobile);
  // A sheet over the map on a phone: a dialog that keeps the focus. On a desktop it is a panel beside the map,
  // which stays usable: the focus goes in on open and back on close, but Tab may leave (P3 review, 19-nov).
  const drawerRef = useFocusTrap<HTMLDivElement>(isMobile);
  useEffect(() => {
    const panel = drawerRef.current;
    if (isMobile || !panel) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.focus({ preventScroll: true });
    return () => {
      const now = document.activeElement;
      const lost = !now || now === document.body || panel.contains(now);
      if (lost && before?.isConnected) before.focus({ preventScroll: true });
    };
  }, [isMobile, drawerRef]);
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const list = useConditionsList();

  // Close on click outside, but not on the map: the user may be panning while it is open.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (!drawerRef.current || drawerRef.current.contains(e.target as Node)) return;
      const target = e.target as HTMLElement;
      if (target.closest('.maplibregl-map') || target.closest('.maplibregl-canvas-container')) return;
      // The controls that toggle this panel close it on their own click; closing here too made it reopen.
      if (target.closest('[data-tour~="panel"]') || target.closest('.gc-alertstrip')) return;
      onClose();
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClick), 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [onClose, drawerRef]);

  // The focus stays inside while it is open: Escape is the way out from the keyboard.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !document.querySelector('[aria-modal="true"]')) onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      ref={drawerRef}
      role={isMobile ? 'dialog' : 'region'}
      aria-label="Condiciones"
      tabIndex={-1}
      className={`g-theme gc-lightscope gc-drawer fixed flex flex-col overflow-hidden ${
        isMobile
          ? 'inset-x-0 z-50 border-t-2 border-[var(--g-rule)] max-w-full'
          : 'right-0 w-80 z-30 border-l border-[var(--g-hair)]'
      }`}
      style={isMobile
        ? { bottom: 'calc(48px + env(safe-area-inset-bottom, 0px))', maxHeight: '60dvh' }
        // Under the header (--map-top is measured by AppShell): at the top of the screen it covered
        // Guía, Opinión, the theme button and the refresh button.
        : { top: 'var(--map-top, 0px)', height: 'calc(100dvh - var(--map-top, 0px))' }}
    >
      {isMobile && <div className="gc-handle"><i /></div>}

      <div className="gc-drawerhead">
        <h2>Condiciones</h2>
        <button type="button" onClick={onClose} className="gc-btn gc-btn--plain gc-btn--icon" aria-label="Cerrar condiciones">
          <WeatherIcon id="x" size={18} />
        </button>
      </div>

      <div className="gc-cond">
        <section className="gc-cond-sec" aria-labelledby="cond-now">
          <h3 id="cond-now" className="gc-cond-title">Ahora</h3>
          {list.unknown.map((u) => <p key={u} className="gc-cond-unknown">{u}</p>)}
          {list.now.length > 0
            ? <Lines lines={list.now} />
            : <p className="gc-cond-empty">{list.emptyNow}</p>}
        </section>

        <section className="gc-cond-sec" aria-labelledby="cond-ahead">
          <h3 id="cond-ahead" className="gc-cond-title">Hoy y mañana</h3>
          {list.ahead.length > 0
            ? <Lines lines={list.ahead} />
            : <p className="gc-cond-empty">{list.emptyAhead}</p>}
          <ByHours />
        </section>

        {isCoastalSector(sectorId) && (
          <section className="gc-cond-sec gc-cond-sec--flush" aria-label="Mareas">
            <Suspense fallback={null}><TidePanel /></Suspense>
          </section>
        )}

        <section className="gc-cond-sec gc-cond-sec--flush" aria-label="En el campo">
          <InTheField frost={list.campo} empty={list.emptyCampo} />
        </section>

        <div className="gc-cond-foot"><NotificationControl /></div>
      </div>
    </div>
  );
}

// ── Lines ────────────────────────────────────────────────

function Lines({ lines }: { lines: ConditionLine[] }) {
  return (
    <ul className="gc-cond-list">
      {lines.map((l) => <li key={l.id}><Line line={l} /></li>)}
    </ul>
  );
}

function Chevron({ size = 16 }: { size?: number }) {
  return (
    <svg className="gc-condline-more" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function Line({ line }: { line: ConditionLine }) {
  const [open, setOpen] = useState(false);
  const body = (
    <>
      <span className={`gc-condline-ico${line.tone ? ` gc-t-${line.tone}` : ''}`}>
        <WeatherIcon id={line.icon as IconId} size={18} />
      </span>
      <span className="gc-condline-text">
        {/* An official warning already names its agency («de MeteoGalicia»): «(oficial)» after it said it twice. */}
        <b>{line.text}{line.origin !== 'oficial' && <> <small>({line.origin})</small></>}</b>
        {line.sub && <span>{line.sub}</span>}
      </span>
    </>
  );
  if (!line.detail) return <div className="gc-condline">{body}</div>;
  return (
    <>
      <button type="button" className="gc-condline gc-condline--open" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {body}
        <Chevron />
      </button>
      {open && <p className="gc-condline-detail">{line.detail}</p>}
    </>
  );
}

// ── The strip by hours ───────────────────────────────────

/** Measured rain intensity -> the levels of the strip. */
const MEASURED_RAIN_LEVEL: Record<string, AlertLevel> = { info: 'riesgo', moderate: 'alto', high: 'critico', critical: 'critico' };

function ByHours() {
  const [open, setOpen] = useState(false);
  const hourly = useForecastStore((s) => s.hourly);
  const convectionData = useForecastStore((s) => s.convectionData);
  const rainNow = useRainNowStore((s) => s.summary);
  const strip = useMemo(() => {
    const measured = rainNow && !rainNow.sim && rainNow.gauges.length >= 2
      ? MEASURED_RAIN_LEVEL[measuredIntensity({ gauges: rainNow.gauges }).severity] ?? 'riesgo'
      : null;
    return buildHourStrip(hourly, convectionData.length > 0 ? convectionData : hourly, new Date(), measured);
  }, [hourly, convectionData, rainNow]);

  if (strip.rows.length === 0) return null;
  return (
    <>
      <button type="button" className="gc-condfold gc-condfold--inner" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="gc-condfold-text">Por horas, 48 h</span>
        <Chevron />
      </button>
      {open && <HourStripView strip={strip} />}
    </>
  );
}

function HourStripView({ strip, plain = false }: { strip: HourStrip; plain?: boolean }) {
  const blocks = strip.labels.length;
  return (
    <div className="gc-hours">
      {strip.rows.map((r) => (
        <div key={r.id} className="gc-hours-row" role="img" aria-label={`${r.name}. ${r.summary}`}>
          <span className="gc-hours-name">{r.name}</span>
          <div className="gc-hours-cells">
            {r.cells.map((c, i) => <i key={i} data-level={c.level} title={c.label} />)}
          </div>
        </div>
      ))}
      <div className="gc-hours-times" aria-hidden="true">
        {strip.labels.map((l, i) => (i % 4 === 0
          ? <span key={i} style={{ flex: `${Math.min(4, blocks - i)} 1 0` }}>{l}</span>
          : null))}
      </div>
      {!plain && (
        <div className="gc-hours-key">
          <span><i style={{ background: 'var(--g-l-riesgo)' }} />Lluvia posible</span>
          <span><i style={{ background: 'var(--g-l-alto)' }} />Probable</span>
          <span><i style={{ background: 'var(--g-l-critico)' }} />Fuerte o granizo</span>
          <span><i style={{ background: 'var(--g-s-tormenta)' }} />Riesgo de tormenta</span>
        </div>
      )}
    </div>
  );
}

// ── In the field: folded, without alert colours ──────────

function InTheField({ frost, empty }: { frost: ConditionLine[]; empty: string }) {
  // Starts open for whoever asked for the field in the welcome assistant, and remembers how it was left
  const open = useUIStore((s) => s.campoOpen);
  const setOpen = useUIStore((s) => s.setCampoOpen);
  const summary = frost.length > 0 ? `${frost[0].text} (${frost[0].origin})` : empty;
  return (
    <>
      <button type="button" className="gc-condfold" aria-expanded={open} onClick={() => setOpen(!open)}>
        <WeatherIcon id="leaf" size={18} />
        <span className="gc-condfold-text">
          <b>En el campo</b>
          <span>{summary}</span>
        </span>
        <Chevron />
      </button>
      {open && <FieldBody frost={frost} />}
    </>
  );
}

function FieldBody({ frost }: { frost: ConditionLine[] }) {
  const hourly = useForecastStore((s) => s.hourly);
  const center = useSectorStore((s) => s.activeSector.center);
  const strip = useMemo(() => buildFrostStrip(hourly, new Date(), center), [hourly, center]);
  return (
    <div className="gc-condfold-body">
      {frost.length > 0 && <Lines lines={frost} />}
      {strip.rows.length > 0 && <HourStripView strip={strip} plain />}
      <Moon />
      <p className="gc-condlinks">
        <b>Avisos de plagas y enfermedades</b>
        <a href="https://areeiro.depo.gal/es/avisos-fitosanitarios" target="_blank" rel="noopener noreferrer">Estación Fitopatolóxica do Areeiro (Pontevedra)</a>
        <a href="https://ovmediorural.xunta.gal/gl/servizos/publicacions-electronicas-periodicas" target="_blank" rel="noopener noreferrer">Medio Rural (Xunta)</a>
      </p>
    </div>
  );
}

// ── The moon: phase and calendar ─────────────────────────

/** The lit part of the disc, waxing on the right, in ink: emoji render differently on every phone. */
function MoonGlyph({ illumination, waxing, size }: { illumination: number; waxing: boolean; size: number }) {
  const r = 10;
  const k = Math.min(1, Math.max(0, illumination / 100));
  const rx = r * Math.abs(1 - 2 * k);
  const outer = waxing ? 1 : 0;
  const inner = k < 0.5 ? (waxing ? 0 : 1) : (waxing ? 1 : 0);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d={`M12 2 A${r} ${r} 0 0 ${outer} 12 22 A${rx.toFixed(2)} ${r} 0 0 ${inner} 12 2 Z`} fill="currentColor" />
    </svg>
  );
}

const WAXING = new Set(['creciente', 'cuarto-creciente', 'gibosa-creciente']);

function Moon() {
  const [open, setOpen] = useState(false);
  const lunar = useMemo(() => getLunarPhase(), []);
  return (
    <>
      <div className="gc-moon">
        <MoonGlyph illumination={lunar.illumination} waxing={lunar.isWaxing} size={36} />
        <div>
          <b>{lunar.label}</b>
          <span>{Math.round(lunar.illumination)} % iluminada · {lunar.nextPhase.name} {Math.round(lunar.nextPhase.daysUntil) === 1 ? 'en 1 día' : `en ${Math.round(lunar.nextPhase.daysUntil)} días`}</span>
        </div>
      </div>
      <button type="button" className="gc-condfold gc-condfold--inner" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="gc-condfold-text">Calendario lunar, 30 días</span>
        <Chevron />
      </button>
      {open && <MoonCalendar />}
    </>
  );
}

function MoonCalendar() {
  const calendar = useMemo(() => getLunarCalendar(new Date(), 30), []);
  // Monday first, as the header
  const pad = (new Date().getDay() + 6) % 7;
  return (
    <div className="gc-mooncal">
      {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d) => <b key={d}>{d}</b>)}
      {Array.from({ length: pad }, (_, i) => <span key={`pad-${i}`} />)}
      {calendar.map((day, i) => (
        <div key={i} data-today={i === 0} title={`${day.date.getDate()}/${day.date.getMonth() + 1}: ${Math.round(day.illumination)} %`}>
          <MoonGlyph illumination={day.illumination} waxing={WAXING.has(day.name)} size={18} />
          {day.date.getDate()}
        </div>
      ))}
    </div>
  );
}
