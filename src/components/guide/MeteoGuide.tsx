import { useEffect, useMemo, useRef, useState, memo, type MouseEvent } from 'react';
import { useSectorStore } from '../../store/sectorStore';
import { useUIStore } from '../../store/uiStore';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { WeatherIcon } from '../icons/WeatherIcons';
import type { IconId } from '../icons/WeatherIcons';
import { Ico, type Tone } from './guideParts';
import { QuickStartSection } from './sections/QuickStartSection';
import { ReadingMapSection } from './sections/ReadingMapSection';
import { SpotScoringSection } from './sections/SpotScoringSection';
import { ThermalCastreloSection } from './sections/ThermalCastreloSection';
import { RiasBaixasSection } from './sections/RiasBaixasSection';
import { CampoPanelSection } from './sections/CampoPanelSection';
import { HistorySection } from './sections/HistorySection';
import { GlossarySection } from './sections/GlossarySection';
import { RoadmapSection } from './sections/RoadmapSection';
import { LegalSection } from './sections/LegalSection';
import { DataSection } from './sections/DataSection';
import {
  GUIDE_SECTIONS,
  GUIDE_PATH,
  parseGuideTarget,
  guideShareUrl,
} from '../../config/guideRoute';
import '../charts/forecastG.css';
import '../../styles/archivoFonts.css';
import './guide.css';
import { useBackCloses } from '../../hooks/useBackCloses';

// Section list and URL shape both live in config/guideRoute so that the boot
// path (useDeepLink) can read them without importing this lazy chunk.
const ALL_SECTIONS = GUIDE_SECTIONS;

/** Single generic title — sector details go in the intro content */
const GUIDE_TITLE = 'Guía MeteoMapGal';

const NAV_ICON: Record<string, [IconId, Tone]> = {
  intro: ['clock', 'sea'],
  datos: ['database', 'rain'],
  reading: ['map-pin', 'fire'],
  spots: ['sailboat', 'wind'],
  thermal: ['thermal-wind', 'fire'],
  'rias-winds': ['waves', 'sea'],
  panels: ['activity', 'storm'],
  history: ['clock', 'air'],
  glossary: ['book-open', 'field'],
  roadmap: ['compass', 'wind'],
  legal: ['info', 'fog'],
};

export const MeteoGuide = memo(function MeteoGuide() {
  const open = useUIStore((s) => s.guideOpen);
  const setOpen = useUIStore((s) => s.setGuideOpen);
  // The back button closes the guide. Declared before the effect that writes the guide's address, so that
  // address lands on the guide's own history entry and not on the map's. Arriving by /guia, the entry
  // underneath still says /guia once the guide is closed: it is put back to the map's.
  useBackCloses(open, () => setOpen(false), 'guide', {
    onReleased: () => {
      if (window.location.pathname.toLowerCase().startsWith(GUIDE_PATH)) history.replaceState(null, '', `/${window.location.search}`);
    },
  });
  // Deep-linking: /guia/<seccion> or the older #guia/<seccion>.
  const [activeSection, setActiveSection] = useState(
    () => parseGuideTarget(window.location.pathname, window.location.hash).section,
  );
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const isMobile = useUIStore((s) => s.isMobile);

  // Sections of the current sector, plus the one on screen: a /guia/thermal link has to open what it
  // says even if the reader's saved zone is the other one, not jump to the first page.
  const sections = useMemo(
    () => ALL_SECTIONS.filter((s) => !s.sectorOnly || s.sectorOnly.includes(sectorId) || s.id === activeSection),
    [sectorId, activeSection],
  );

  // Keep the URL in step with what is on screen, so whatever the reader is
  // looking at can be copied and sent. Two shapes on purpose: arriving by
  // /guia keeps a path (the shareable form), while opening with the G key from
  // the map only appends a hash, which leaves the map's own URL untouched.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    const onGuidePath = window.location.pathname.toLowerCase().startsWith(GUIDE_PATH);

    if (open) {
      wasOpenRef.current = true;
      history.replaceState(null, '', onGuidePath
        ? `${guideShareUrl(activeSection, '')}${window.location.search}`
        : `${window.location.pathname}${window.location.search}#guia/${activeSection}`);
      return;
    }

    // Clean up only after a real close, never on first mount — at boot the URL
    // still has to be readable by useDeepLink, which runs before this chunk
    // has even finished loading.
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    history.replaceState(null, '', `/${window.location.search}`);
  }, [open, activeSection]);

  // Listen for 'G' key (all platforms) + Escape to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!open && document.querySelector('[aria-modal="true"]')) return;
      if (e.key.toLowerCase() === 'g') setOpen(!open);
      if (e.key === 'Escape' && open) setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  const focusTrapRef = useFocusTrap<HTMLDivElement>(open);

  // A new section starts at its top, and a screen reader is told where it landed: on the heading of the
  // section, so reading goes on from there into the text. On the whole box (a region with a name) a screen
  // reader said the name and stopped, and the next swipe could land back on the list of sections. Only after
  // the reader picks one: opening the guide leaves the focus where the dialog puts it.
  const contentRef = useRef<HTMLDivElement>(null);
  const activeLinkRef = useRef<HTMLAnchorElement>(null);
  const pickedRef = useRef(false);
  useEffect(() => {
    if (!pickedRef.current) return;
    pickedRef.current = false;
    const content = contentRef.current;
    content?.scrollTo?.(0, 0);
    const heading = content?.querySelector<HTMLElement>('h2');
    if (heading) heading.tabIndex = -1;
    (heading ?? content)?.focus({ preventScroll: true });
  }, [activeSection]);

  // On a phone the bar scrolls sideways: the current section must not be left out of sight.
  useEffect(() => {
    if (open && isMobile) activeLinkRef.current?.scrollIntoView?.({ inline: 'center', block: 'nearest' });
  }, [open, isMobile, activeSection]);

  const pick = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    // Real links, so a section can be opened in a new tab or have its address copied.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (id === activeSection) return;
    pickedRef.current = true;
    setActiveSection(id);
  };

  if (!open) return null;

  const activeLabel = sections.find((s) => s.id === activeSection)?.label ?? GUIDE_TITLE;

  return (
    <div ref={focusTrapRef} className="g-theme gg-shell" role="dialog" aria-modal="true" aria-labelledby="gg-title">
      <div className="gg-top">
        <div className="gg-title">
          <span className="gg-title-icon" aria-hidden="true"><WeatherIcon id="thermal-wind" size={22} /></span>
          <h2 id="gg-title">{GUIDE_TITLE}</h2>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="g-btn" aria-label="Volver al mapa">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
          {!isMobile && <>Volver al mapa <kbd className="gg-kbd">G</kbd></>}
        </button>
      </div>

      <div className="gg-layout">
        <nav className={isMobile ? 'gg-nav gg-nav-bar' : 'gg-nav'} aria-label="Secciones de la guía">
          <ul>
            {sections.map((s) => {
              const current = activeSection === s.id;
              return (
                <li key={s.id}>
                  <a
                    ref={current ? activeLinkRef : undefined}
                    href={guideShareUrl(s.id, '')}
                    aria-current={current ? 'page' : undefined}
                    onClick={(e) => pick(e, s.id)}
                  >
                    {!isMobile && NAV_ICON[s.id] && <Ico id={NAV_ICON[s.id][0]} tone={NAV_ICON[s.id][1]} />}
                    {s.label}
                  </a>
                </li>
              );
            })}
          </ul>
          {!isMobile && (
            <div className="gg-support">
              <p><b>Apoya el proyecto</b></p>
              <p>
                MeteoMapGal es gratuito y open source. Las donaciones son voluntarias y sin contraprestación:
                cubren coste de servidor y tiempo. La app y los datos seguirán siendo libres y gratuitos.
              </p>
              <a href="https://ko-fi.com/bateas" target="_blank" rel="noopener noreferrer">ko-fi.com/bateas</a>
            </div>
          )}
        </nav>

        <div ref={contentRef} className="gg-content" tabIndex={0} role="region" aria-label={activeLabel}>
          <div className="gg-column">
            {activeSection === 'intro' && <QuickStartSection />}
            {activeSection === 'datos' && <DataSection />}
            {activeSection === 'reading' && <ReadingMapSection />}
            {activeSection === 'spots' && <SpotScoringSection />}
            {activeSection === 'thermal' && <ThermalCastreloSection />}
            {activeSection === 'rias-winds' && <RiasBaixasSection />}
            {activeSection === 'panels' && <CampoPanelSection />}
            {activeSection === 'history' && <HistorySection />}
            {activeSection === 'glossary' && <GlossarySection />}
            {activeSection === 'roadmap' && <RoadmapSection />}
            {activeSection === 'legal' && <LegalSection />}
          </div>
        </div>
      </div>
    </div>
  );
});
