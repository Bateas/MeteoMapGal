/**
 * WelcomeAssistant: the first visit asks two or three questions and leaves the app set for what the person
 * came to see. It replaces the four-step tour (18-nov). Not a profile: the rules are in services/welcomeAssistant.ts, every answer
 * sets something the app already has, and it is all changed later where it is changed today.
 *
 * It launches once, a moment after the map is up and never over something being read, like the tour did. No
 * final screen: it falls straight onto the map, with the spot card open when one was chosen.
 */
import { memo, useCallback, useEffect, useState, type RefObject } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useBackCloses } from '../../hooks/useBackCloses';
import { useUIStore } from '../../store/uiStore';
import { useSectorStore } from '../../store/sectorStore';
import { useSpotStore } from '../../store/spotStore';
import { SECTORS } from '../../config/sectors';
import { getSpotsForSector } from '../../config/spots';
import { WeatherIcon } from '../icons/WeatherIcons';
import {
  INTEREST_OPTIONS, toggleInterest, welcomePanels, welcomePlan, type Interest,
} from '../../services/welcomeAssistant';

/** Anything else on top of the map: a card, a dialog, the loading screen. The welcome waits for it. */
// The phone's side panel and the «Más» menu are not dialogs, and the welcome came up over them (review, 18-nov)
const BUSY = '.gc-boot, .gf-dock, .gf-sheetwrap, .gc-aside--sheet, .gc-menu, .gc-drawer, [aria-modal="true"], [role="dialog"]';
const LAUNCH_DELAY_MS = 3000;
/** The sector switch moves the map and closes any card: the spot opens after it. */
const AFTER_SWITCH_MS = 450;

export const WelcomeAssistant = memo(function WelcomeAssistant() {
  const step = useUIStore((s) => s.onboardingStep);
  const completed = useUIStore((s) => s.onboardingCompleted);
  const setStep = useUIStore((s) => s.setOnboardingStep);
  const complete = useUIStore((s) => s.completeOnboarding);
  const isMobile = useUIStore((s) => s.isMobile);
  const guideOpen = useUIStore((s) => s.guideOpen);
  const currentSector = useSectorStore((s) => s.activeSector.id);

  const [sector, setSector] = useState(currentSector);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [spotId, setSpotId] = useState<string | null>(null);
  const open = !completed && step !== null;
  const trapRef = useFocusTrap<HTMLDivElement>(open);
  // Android's back button closes the questions, as it closes every panel over the map, instead of leaving the app
  useBackCloses(open, complete, 'welcome');

  // First visit: a moment after the map is up, and never over something being read
  useEffect(() => {
    if (completed || step !== null || guideOpen) return;
    const timer = setInterval(() => {
      if (!document.querySelector(BUSY)) {
        setSector(useSectorStore.getState().activeSector.id);
        setStep(0);
      }
    }, LAUNCH_DELAY_MS);
    return () => clearInterval(timer);
  }, [completed, step, setStep, guideOpen]);

  const panels = welcomePanels({ interests });
  const finish = useCallback(() => {
    const plan = welcomePlan({ sector, interests, spotId });
    const ui = useUIStore.getState();
    const switched = plan.sector !== useSectorStore.getState().activeSector.id;
    if (switched) useSectorStore.getState().switchSector(plan.sector);
    if (plan.simple !== null) ui.setSimpleMode(plan.simple);
    if (plan.campoOpen) ui.setCampoOpen(true);
    if (plan.favoriteSpotId) useSpotStore.setState({ favoriteSpotId: plan.favoriteSpotId });
    complete();
    setTimeout(() => {
      const spot = plan.favoriteSpotId ? getSpotsForSector(plan.sector).find((s) => s.id === plan.favoriteSpotId) : undefined;
      if (plan.openSpot && spot) {
        useSpotStore.getState().selectSpot(spot.id);
        useUIStore.getState().setFlyToTarget({ lon: spot.center[0], lat: spot.center[1], zoom: 11.5 });
      } else if (plan.openConditions) {
        useUIStore.getState().setFieldDrawerOpen(true);
      }
    }, switched ? AFTER_SWITCH_MS : 0);
  }, [sector, interests, spotId, complete]);

  const index = step === null ? 0 : Math.min(step, panels.length - 1);
  // Each panel puts the focus on its first answer: «Atrás» disappears on the first one and the focus fell out of
  // the dialog (review, 18-nov)
  useFocusFirstOption(trapRef, open ? index : null);

  if (!open) return null;
  const panel = panels[index];
  const isLast = index === panels.length - 1;
  const next = () => (isLast ? finish() : setStep(index + 1));
  const spots = getSpotsForSector(sector);
  const notes = INTEREST_OPTIONS.filter((o) => o.note && interests.includes(o.id)).map((o) => o.note!);

  return (
    <div
      ref={trapRef}
      className="gc-scrim gc-tour gc-welcome z-50"
      onKeyDown={(e) => { if (e.key === 'Escape') complete(); }}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-q"
    >
      <div className={`g-theme gc-tourcard ${isMobile ? 'gc-tourcard--sheet' : 'gc-tourcard--center'}`}>
        <div>
          <div key={panel} className="gc-tourtext">
            {panel === 'zona' && (
              <>
                <h3 id="welcome-q">¿Por dónde te mueves?</h3>
                <p className="gc-tourtip">Dos o tres preguntas y la app abre con lo tuyo. Todo se cambia luego.</p>
                <div className="gc-welcome-opts" role="group" aria-labelledby="welcome-q">
                  {SECTORS.map((s) => (
                    <button key={s.id} type="button" className="gc-welcome-opt" aria-pressed={sector === s.id}
                      onClick={() => { setSector(s.id); setSpotId(null); }}>
                      <WeatherIcon id={s.icon} size={20} />
                      <span><b>{s.shortName === 'Rías' ? 'Rías Baixas' : s.shortName}</b><small>{s.id === 'rias' ? 'Costa y rías' : 'Castrelo, Belesar, Velle'}</small></span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {panel === 'mira' && (
              <>
                <h3 id="welcome-q">¿Qué miras antes de salir?</h3>
                <p className="gc-tourtip">Puedes marcar varias. Los avisos oficiales salen siempre.</p>
                <div className="gc-welcome-opts" role="group" aria-labelledby="welcome-q">
                  {INTEREST_OPTIONS.map((o) => (
                    <button key={o.id} type="button" className="gc-welcome-opt" aria-pressed={interests.includes(o.id)}
                      onClick={() => setInterests((list) => toggleInterest(list, o.id))}>
                      <WeatherIcon id={o.icon} size={20} />
                      <span><b>{o.label}</b><small>{o.sub}</small></span>
                    </button>
                  ))}
                </div>
                {notes.map((n) => <p key={n} className="gc-tourtip">{n}</p>)}
              </>
            )}
            {panel === 'spot' && (
              <>
                <h3 id="welcome-q">¿Cuál es tu spot?</h3>
                <p className="gc-tourtip">El mapa abrirá ahí. Se cambia con la estrella de su ficha.</p>
                <div className="gc-welcome-opts gc-welcome-opts--list" role="group" aria-labelledby="welcome-q">
                  {spots.map((s) => (
                    <button key={s.id} type="button" className="gc-welcome-opt" aria-pressed={spotId === s.id} onClick={() => setSpotId(s.id)}>
                      <WeatherIcon id={s.category === 'surf' ? 'waves' : 'map-pin'} size={18} />
                      <span><b>{s.shortName}</b></span>
                    </button>
                  ))}
                  <button type="button" className="gc-welcome-opt" aria-pressed={spotId === null} onClick={() => setSpotId(null)}>
                    <WeatherIcon id="map-pin" size={18} />
                    <span><b>Ninguno en concreto</b></span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="gc-tourfoot">
          <span className="gc-tourcount">{index + 1} de {panels.length}</span>
          <div className="gc-tourbtns">
            {index > 0 && <button type="button" onClick={() => setStep(index - 1)} className="gc-btn gc-btn--plain">Atrás</button>}
            <button type="button" onClick={complete} className="gc-btn gc-btn--plain">Saltar</button>
            <button type="button" onClick={next} className="gc-btn gc-btn--primary">{isLast ? 'Listo' : 'Siguiente'}</button>
          </div>
        </div>
      </div>
    </div>
  );
});

/** Move the focus to the first answer of the panel on screen, every time the panel changes. */
function useFocusFirstOption(ref: RefObject<HTMLDivElement | null>, panelIndex: number | null): void {
  useEffect(() => {
    if (panelIndex === null) return;
    ref.current?.querySelector<HTMLElement>('.gc-welcome-opt')?.focus({ preventScroll: true });
  }, [ref, panelIndex]);
}
