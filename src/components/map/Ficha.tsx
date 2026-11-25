/**
 * The shell and the small parts every card on the map shares (spot, station, buoy, webcam, own spot,
 * fire, airspace, aircraft). Each card only says what it shows; opening, closing and the keyboard
 * live here, so a phone gets the same sheet from all of them and the desktop the same panel.
 *
 * On a desktop it is docked to the corner of the map, not pinned to the marker. A card as tall as these,
 * pinned to a point, left the frame as soon as the map moved, and the only cure was moving the map back.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type TouchEvent as ReactTouchEvent } from 'react';
import { useMap } from 'react-map-gl/maplibre';
import { useUIStore } from '../../store/uiStore';
import { useSectorStore } from '../../store/sectorStore';
import { isNarrowDesktop } from '../../config/narrowDesktop';
import { holdBackSlot } from '../../services/backStack';
import { useBackCloses } from '../../hooks/useBackCloses';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { takeKeyboardOpener } from './markerA11y';
import { WeatherIcon, type IconId } from '../icons/WeatherIcons';
import '../../styles/archivoFonts.css';
import '../../styles/ficha.css';

/** They all open in the same place, so only one at a time: opening one closes the other. */
let openFicha: { close: () => void } | null = null;

/** What the card leaves free: the map to its right, or (a sheet, or a card on a narrow map) over it. */
export type FreeSide = 'right' | 'above';

/** Room a marker needs beside a docked card; with less, the free part is what is over the card. */
const MIN_ROOM_BESIDE = 180;
/** The tools along the bottom of the map on a desktop. */
const BOTTOM_TOOLS = 76;

/**
 * The sheet of a phone has two heights. PEEKING it shows the head of the card (name, state, figure,
 * the sentence and any danger) and the map above stays alive: it can be moved, and tapping another
 * marker swaps the card. OPEN it leaves a strip of map on top and scrolls inside. A card short enough
 * to fit whole has one height only.
 */
export type SheetDetent = 'peek' | 'open';
/** The head of a card ends where its first group starts; these bound it when a card has no groups. */
const PEEK_MIN = 96;
const PEEK_MAX = 240;
/** A card that marks where its first look ends (`data-peek-end`: the spot's graph of measured and coming
 *  wind) may peek this far (18-nov): the verdict and the coming hours without sliding. */
export const PEEK_MAX_MARKED = 400;
/** Less than this under the head is not worth a second height. */
const PEEK_SLACK = 24;
/** Map left in view above the open sheet. */
const MAP_STRIP = 44;
const DRAG_OPEN = 40;
const DRAG_DOWN = 60;

/** Height of the head and whether there is more under it, from the card as laid out. */
export function peekOf(headBottom: number | null, total: number, max = PEEK_MAX): { px: number; more: boolean } {
  // A card that fits in the tallest head is shown whole: two heights for a few lines is a tap for nothing
  if (total <= max) return { px: Math.round(total), more: false };
  const px = Math.round(Math.min(max, Math.max(PEEK_MIN, headBottom ?? total)));
  return { px, more: total > px + PEEK_SLACK };
}

/** What the end of a drag on the sheet does: up opens, down folds, and down from the lowest height closes. */
export function dragOutcome(dy: number, detent: SheetDetent, more: boolean): SheetDetent | 'close' | null {
  if (dy <= -DRAG_OPEN) return more && detent === 'peek' ? 'open' : null;
  if (dy >= DRAG_DOWN) return more && detent === 'open' ? 'peek' : 'close';
  return null;
}

/**
 * How far to pan (map convention: positive moves the view right or down) so the marker is in view and
 * clear of the card. Coordinates are relative to the map. A marker already in the free part stays put.
 */
export function panToClearCard(
  marker: { x: number; y: number },
  card: { top: number; right: number },
  frame: { width: number; height: number },
  side: FreeSide,
  margin = 44,
): { x: number; y: number } {
  const beyond = (v: number, lo: number, hi: number) => (v < lo ? v - lo : v > hi ? v - hi : 0);
  if (side === 'above') {
    // The card covers the bottom: a marker out of the free part goes to the middle of it
    const clearY = marker.y >= margin && marker.y <= card.top - margin;
    const clearX = marker.x >= margin && marker.x <= frame.width - margin;
    return {
      x: clearX ? 0 : Math.round(marker.x - frame.width / 2),
      y: clearY ? 0 : Math.round(marker.y - card.top / 2),
    };
  }
  return {
    x: Math.round(beyond(marker.x, card.right + margin, Math.max(card.right + margin, frame.width - margin))),
    y: Math.round(beyond(marker.y, margin, Math.max(margin, frame.height - BOTTOM_TOOLS))),
  };
}

interface FichaProps {
  longitude: number;
  latitude: number;
  onClose: () => void;
  /** id of the element that names the card: the sheet is announced with it */
  titleId?: string;
  /**
   * For cards the map's own click does not close (fire, airspace, aircraft): what this card is showing.
   * A click elsewhere on the map closes it; a click that picks another one changes this and keeps it open.
   */
  mapClickKey?: string;
  /** Address of the page while this card is open (a spot's own link), so it can be shared and reloaded. */
  backUrl?: string;
  children: ReactNode;
}

export function Ficha({ longitude, latitude, onClose, titleId, mapClickKey, backUrl, children }: FichaProps) {
  const isMobile = useUIStore((s) => s.isMobile);
  const { current: map } = useMap();
  const [detent, setDetent] = useState<SheetDetent>('peek');
  // Not measured yet counts as peeking: the focus must not go into a sheet that is about to fold
  const [peek, setPeek] = useState<{ px: number; more: boolean } | null>(null);
  const more = peek?.more ?? false;
  // Whole on screen: either opened, or a card with nothing under its head
  const whole = peek != null && (!more || detent === 'open');
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  // Whole, the focus moves to the first focusable element (the close button), Tab stays inside, and focus
  // is handed back on close. Peeking there is no trap: the map above is in use. Non-modal in both: tapping
  // the map still closes it or picks another one.
  const trapRef = useFocusTrap<HTMLDivElement>(isMobile && whole);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const keyRef = useRef(mapClickKey);
  keyRef.current = mapClickKey;

  useEffect(() => {
    const me = { close: () => closeRef.current() };
    if (openFicha) openFicha.close();
    openFicha = me;
    return () => { if (openFicha === me) openFicha = null; };
  }, []);

  // A narrow desktop window: the card and the open side panel do not fit on the map together, so the
  // card takes the room. The reader can open the panel again with the card up.
  useEffect(() => {
    if (isNarrowDesktop(window.innerWidth)) useUIStore.getState().setSidebarCollapsed(true);
  }, [longitude, latitude]);

  // The back button closes the card instead of leaving the app. One slot for every card: opening another
  // keeps a single step back.
  useEffect(() => holdBackSlot('ficha', () => closeRef.current(), { url: backUrl }), [backUrl]);
  // An open sheet takes one more step: back folds it first, and the next one closes it.
  const fold = useCallback(() => setDetent('peek'), []);
  useBackCloses(isMobile && more && detent === 'open', fold, 'ficha-open');

  // Another marker picked with the sheet in place: its card starts peeking, like any card.
  useEffect(() => { setDetent('peek'); }, [longitude, latitude]);

  // Where the head ends, measured before the first paint: it changes as the data of the card arrives.
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!isMobile || !content) return;
    const measure = () => {
      const top = content.getBoundingClientRect().top;
      // The card may say where its first look ends; otherwise the head ends where its first group starts.
      const marked = content.querySelector('[data-peek-end]');
      const firstGroup = content.querySelector('.gf-group');
      const next = marked
        ? peekOf(marked.getBoundingClientRect().bottom - top + 8, content.scrollHeight, PEEK_MAX_MARKED)
        : peekOf(firstGroup ? firstGroup.getBoundingClientRect().top - top : null, content.scrollHeight);
      setPeek((was) => (was && was.px === next.px && was.more === next.more ? was : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(measure);
    watch.observe(content);
    return () => watch.disconnect();
  }, [isMobile]);

  // Room for the open sheet: from under the strip of map it leaves to the bottom of the screen. Measured
  // again when the screen or the map changes size (a turn of the phone, a notice strip coming or going).
  const [openMax, setOpenMax] = useState<string | undefined>(undefined);
  // The whole height of the map's box. The style sheet takes off it what floats over the top of the map (the
  // warnings strip and the safety bands, --ticker-h and --map-stack-h): they sit above the sheet, and an
  // open sheet that ran under them lost its handle and its close button (25-nov, on a phone).
  const [boxHeight, setBoxHeight] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!isMobile) return;
    const box = map?.getContainer();
    const calc = () => {
      // The sheet lives inside the map's box, so its room ends where that box ends (above the bottom bar), not
      // at the bottom of the window: measured to the window it was 768 px in a 703 px box, and the box
      // scrolled to hold it (18-nov). Never above the top of the screen: the box reads off-screen for a
      // moment while the page settles.
      const rect = box?.getBoundingClientRect();
      const mapTop = Math.max(0, rect ? rect.top : 0);
      const bottom = rect && rect.height > 0 ? rect.bottom : window.innerHeight;
      const room = bottom - mapTop - MAP_STRIP;
      setOpenMax(room > 200 ? `${Math.round(room)}px` : undefined);
      setBoxHeight(room > 200 ? `${Math.round(bottom - mapTop)}px` : undefined);
    };
    calc();
    window.addEventListener('resize', calc);
    const watch = typeof ResizeObserver !== 'undefined' && box instanceof Element ? new ResizeObserver(calc) : null;
    if (watch && box instanceof Element) watch.observe(box);
    return () => {
      window.removeEventListener('resize', calc);
      watch?.disconnect();
    };
    // `detent`: measured again at the moment it opens, when it matters
  }, [isMobile, map, detent]);

  // Folded, the card is back at its head
  useEffect(() => {
    if (!whole && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [whole]);

  // Escape closes it, on the sheet and on the panel. Capture phase, so it runs before the handlers of
  // what opens on top: while an aria-modal dialog is open the key belongs to it, and a text field keeps
  // its own Escape. So does a layer over the map that closes with its own Escape and says so with
  // `data-escape-first` (the rain legend): one key, the thing on top (P3 review, 19-nov).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[aria-modal="true"], [data-escape-first]')) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      closeRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // A card is about the sector on screen. Fire and airspace keep their selection to themselves, so the
  // reset the map does for the stores does not reach them: closing here covers all of them.
  const openedInSector = useRef(sectorId);
  useEffect(() => {
    if (sectorId !== openedInSector.current) closeRef.current();
  }, [sectorId]);

  // Desktop: a card is opened from a marker, so with a keyboard the focus would stay out there, 19 tabs
  // away. No trap, the map stays usable; and it goes back where it was on close, unless the user is
  // already somewhere else.
  useEffect(() => {
    const panel = panelRef.current;
    if (isMobile || !panel) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.focus({ preventScroll: true });
    return () => {
      const now = document.activeElement;
      const lost = !now || now === document.body || panel.contains(now);
      if (lost && before?.isConnected) before.focus({ preventScroll: true });
    };
  }, [isMobile]);

  // Phone, opened with the keyboard (Enter on a marker): the focus goes to the sheet, peeking or not, so a screen
  // reader says which card opened; and back to the marker on close, unless the user is already elsewhere. A tap
  // leaves the focus alone, as before.
  useEffect(() => {
    const opener = takeKeyboardOpener();
    const sheet = trapRef.current;
    if (!isMobile || !opener || !sheet) return;
    sheet.focus({ preventScroll: true });
    return () => {
      const now = document.activeElement;
      const lost = !now || now === document.body || sheet.contains(now);
      if (lost && opener.isConnected) opener.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on open only
  }, []);

  // On open only: what the card is about must be in view and not under it. After that the map is the
  // user's, so a drag during the wait wins.
  useEffect(() => {
    const el = isMobile ? trapRef.current : panelRef.current;
    if (!map || !el || !Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
    let cancelled = false;
    const pan = (e?: { originalEvent?: unknown }) => {
      if (cancelled || e?.originalEvent) return;
      const frame = map.getContainer().getBoundingClientRect();
      const box = el.getBoundingClientRect();
      const card = { top: box.top - frame.top, right: box.right - frame.left };
      const side: FreeSide = isMobile || frame.width - card.right < MIN_ROOM_BESIDE ? 'above' : 'right';
      const shift = panToClearCard(map.project([longitude, latitude]), card, frame, side);
      if (shift.x !== 0 || shift.y !== 0) map.panBy([shift.x, shift.y], { duration: 250 });
    };
    // A pan now would cut a flight to this same marker short (list, compare), so it waits for it to land.
    // The timer lets the effects of this commit start that flight.
    const whenStill = () => {
      if (cancelled) return;
      if (map.isMoving()) map.once('moveend', pan);
      else pan();
    };
    // The sheet is measured where it ends up: in the first frame of its slide it is still off screen.
    const sliding = typeof el.getAnimations === 'function' ? el.getAnimations() : [];
    const timer = setTimeout(() => {
      void Promise.allSettled(sliding.map((a) => a.finished)).then(whenStill);
    }, 0);
    // A cold start through a shared link: the first camera comes with the map's load and would undo the pan.
    map.once('load', pan);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      map.off('moveend', pan);
      map.off('load', pan);
    };
  }, [map, longitude, latitude, isMobile, trapRef]);

  const closesOnMapClick = mapClickKey !== undefined;
  useEffect(() => {
    if (!map || !closesOnMapClick) return;
    const onClick = () => {
      const before = keyRef.current;
      // The layer's own handler runs on the same click: if it picked another one, stay open.
      setTimeout(() => { if (keyRef.current === before) closeRef.current(); }, 0);
    };
    map.on('click', onClick);
    return () => { map.off('click', onClick); };
  }, [map, closesOnMapClick]);

  // The sheet follows the finger down from its lowest height, and the end of the drag decides.
  const drag = useRef({ y0: 0, y: 0, moved: false });
  const swipeCloseRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(swipeCloseRef.current), []);
  const onTouchStart = useCallback((e: ReactTouchEvent) => {
    drag.current = { y0: e.touches[0].clientY, y: e.touches[0].clientY, moved: false };
    if (sheetRef.current) sheetRef.current.style.transition = 'none';
  }, []);
  const onTouchMove = useCallback((e: ReactTouchEvent) => {
    const d = drag.current;
    d.y = e.touches[0].clientY;
    const dy = d.y - d.y0;
    if (Math.abs(dy) > 6) d.moved = true;
    const lowest = !more || detent === 'peek';
    if (dy > 0 && lowest && sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${dy}px)`;
      sheetRef.current.style.opacity = `${Math.max(0.3, 1 - dy / 300)}`;
    }
  }, [more, detent]);
  const onTouchEnd = useCallback(() => {
    const box = sheetRef.current;
    const outcome = dragOutcome(drag.current.y - drag.current.y0, detent, more);
    if (box) box.style.transition = 'transform 0.2s ease-out, opacity 0.2s ease-out';
    if (outcome === 'close') {
      if (box) { box.style.transform = 'translateY(100%)'; box.style.opacity = '0'; }
      // Kept so that unmounting cancels it: swiping card A away and tapping B within 200 ms closed B (review, 18-nov)
      clearTimeout(swipeCloseRef.current);
      swipeCloseRef.current = setTimeout(() => closeRef.current(), 200);
      return;
    }
    if (box) { box.style.transform = 'translateY(0)'; box.style.opacity = '1'; }
    if (outcome) setDetent(outcome);
  }, [detent, more]);
  // Peeking nothing scrolls, so the whole sheet takes the drag; open, only the handle does.
  const dragHandlers = { onTouchStart, onTouchMove, onTouchEnd };
  const sheetDrag = whole ? {} : dragHandlers;
  const handleDrag = whole ? dragHandlers : {};
  const toggle = () => {
    // The click that ends a drag is not a tap
    if (drag.current.moved) { drag.current.moved = false; return; }
    setDetent(detent === 'open' ? 'peek' : 'open');
  };
  const closeButton = (
    <button type="button" onClick={onClose} className="gc-btn gc-btn--plain gc-btn--icon gf-close" aria-label="Cerrar">
      <WeatherIcon id="x" size={18} />
    </button>
  );

  if (isMobile) {
    return (
      // Peeking it is a region beside the map, not a dialog: the map is still the thing in use
      <div
        ref={trapRef}
        role={whole ? 'dialog' : 'region'}
        aria-labelledby={titleId}
        tabIndex={-1}
        className="g-theme gf-sheetwrap animate-slide-up"
        data-detent={whole ? 'open' : 'peek'}
        style={{ ['--gf-peek' as string]: `${peek?.px ?? 160}px`, ...(openMax ? { ['--gf-open' as string]: openMax } : null), ...(boxHeight ? { ['--gf-box' as string]: boxHeight } : null) }}
      >
        {/* The swipe moves this box, so the close button goes down with the sheet */}
        <div ref={sheetRef} className="gf-sheetbox" {...sheetDrag}>
          {closeButton}
          <div ref={scrollRef} className="gf-sheet">
            {more ? (
              // The same thing by drag and by button: nothing here works by gesture alone
              <button
                type="button"
                className="gf-handle"
                aria-expanded={detent === 'open'}
                onClick={toggle}
                {...handleDrag}
              >
                <span className="gf-handle-bar" />
                <span className="gf-handle-say">{detent === 'open' ? 'Recoger' : 'Ver todo'}<Chevron open={detent !== 'open'} /></span>
              </button>
            ) : (
              <div className="gf-handle" {...handleDrag}>
                <span className="gf-handle-bar" />
              </div>
            )}
            <div
              ref={contentRef}
              className="gf"
              // Keyboard or screen reader reaching what is under the head: the sheet opens for it
              onFocusCapture={(e) => {
                if (whole || !contentRef.current) return;
                const under = e.target.getBoundingClientRect().top - contentRef.current.getBoundingClientRect().top;
                if (peek && under >= peek.px) setDetent('open');
              }}
            >
              {children}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={panelRef} role="region" aria-labelledby={titleId} tabIndex={-1} className="g-theme gf-dock">
      {closeButton}
      <div className="gf-body">
        <div className="gf">{children}</div>
      </div>
    </div>
  );
}

export type NoteTone = 'ok' | 'riesgo' | 'moderado' | 'alto' | 'critico';

/** One line of what is going on: a state icon and the words in ink, which read in both themes. */
export function Note({ icon, tone, title, children }: { icon: IconId; tone?: NoteTone; title?: string; children: ReactNode }) {
  return (
    <div className={`gf-note${tone ? ` gc-t-${tone}` : ''}`} title={title}>
      <span aria-hidden="true"><WeatherIcon id={icon} size={14} /></span>
      <div>{children}</div>
    </div>
  );
}

export function Chevron({ open, dir = 'down' }: { open?: boolean; dir?: 'down' | 'right' }) {
  const deg = dir === 'right' ? -90 : open ? 180 : 0;
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: `rotate(${deg}deg)`, transition: 'transform .15s' }}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** A row that folds what is under it. The same one in every card. */
export function FoldRow({ icon, title, note, defaultOpen = false, onToggle, children }: {
  icon: IconId;
  title: string;
  note?: ReactNode;
  defaultOpen?: boolean;
  onToggle?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <button
        type="button"
        className="gf-row"
        aria-expanded={open}
        onClick={() => { setOpen(!open); onToggle?.(!open); }}
      >
        <WeatherIcon id={icon} size={16} />
        <span className="gf-grow">{title}{note != null && <small> {note}</small>}</span>
        <Chevron open={open} />
      </button>
      {open && <div className="gf-panel">{children}</div>}
    </>
  );
}

/**
 * One group of a long card: a heading with a thick rule, little air inside and more between groups, so that the
 * card reads as four things and not as fourteen. A group left with nothing inside draws nothing (ficha.css).
 */
export function FichaGroup({ title, note, list = false, children }: { title: string; note?: ReactNode; list?: boolean; children: ReactNode }) {
  return (
    <section className={list ? 'gf-group gf-group--list' : 'gf-group'}>
      <div className="gf-grouphead">
        <h3>{title}</h3>
        {note != null && <span>{note}</span>}
      </div>
      {children}
    </section>
  );
}

/** The discreet support link of a card with real data. */
export function SupportLink() {
  return (
    <a href="https://ko-fi.com/bateas" target="_blank" rel="noopener noreferrer" className="gc-btn gc-btn--plain" title="Apoyar el proyecto (Ko-fi)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z" /></svg>
      Apoyar
    </a>
  );
}

/** A number with the decimal comma the rest of the card reads with. */
export const dec = (n: number, digits = 1) => n.toFixed(digits).replace('.', ',');
