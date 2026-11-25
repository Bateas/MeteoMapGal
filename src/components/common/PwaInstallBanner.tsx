/**
 * PwaInstallBanner — prompts user to install PWA after 2+ visits.
 *
 * Android: captures `beforeinstallprompt` event.
 * iOS: shows manual instructions (no native prompt available).
 * Dismissed state persisted in localStorage.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { WeatherIcon } from '../icons/WeatherIcons';
import { useSpotStore } from '../../store/spotStore';
import { countVisitDay } from '../../services/visitDays';

const STORAGE_KEY = 'pwa-install-dismissed';
const MIN_VISITS = 2;

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window);
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && (navigator as unknown as { standalone: boolean }).standalone);
}

export function PwaInstallBanner() {
  const [show, setShow] = useState(false);
  const spotCardOpen = useSpotStore((s) => s.activeSpotId !== '');
  const [isIosDevice] = useState(isIos);
  const promptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [canPrompt, setCanPrompt] = useState(false);

  useEffect(() => {
    // Already installed or dismissed
    if (isStandalone()) return;
    if (localStorage.getItem(STORAGE_KEY)) return;
    // Only show on mobile — desktop users don't need PWA install prompt
    if (window.innerWidth > 768) return;

    // Count visits by DAY: every load counted, so two reloads on the first day put the card over the map
    // of someone who had not yet seen it (18-nov). A visit is a new day.
    if (countVisitDay(localStorage) < MIN_VISITS) return;

    // iOS: show manual instructions
    if (isIos()) {
      setShow(true);
      return;
    }

    // Android/Desktop: wait for beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault();
      promptRef.current = e as BeforeInstallPromptEvent;
      setCanPrompt(true);
      setShow(true);
    };
    window.addEventListener('beforeinstallprompt', handler);

    // Fallback: if beforeinstallprompt doesn't fire after 10s (e.g. already
    // installable but browser didn't prompt, or Firefox/Safari), show anyway
    // with a generic "add to home screen" message
    const fallbackTimer = setTimeout(() => {
      if (!promptRef.current) setShow(true);
    }, 10_000);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      clearTimeout(fallbackTimer);
    };
  }, []);

  const handleInstall = useCallback(async () => {
    if (promptRef.current) {
      promptRef.current.prompt();
      const result = await promptRef.current.userChoice;
      if (result.outcome === 'accepted') {
        setShow(false);
        localStorage.setItem(STORAGE_KEY, '1');
      }
    }
  }, []);

  const handleDismiss = useCallback(() => {
    setShow(false);
    localStorage.setItem(STORAGE_KEY, '1');
  }, []);

  // A spot card open on a phone peeks over this very place: the invitation waits until it closes.
  if (!show || spotCardOpen) return null;

  return (
    <div className="g-theme gc-card">
      <div className="gc-card-head">
        <div>
          <p className="gc-card-title">Instalar MeteoMapGal</p>
          {isIosDevice ? (
            <p className="gc-card-text">
              Toca <strong>Compartir</strong> y luego <strong>Añadir a pantalla de inicio</strong>
            </p>
          ) : (
            <p className="gc-card-text">
              {canPrompt
                ? 'Ábrela sin navegador, desde tu pantalla de inicio'
                : 'En el menú de tu navegador, elige «Instalar aplicación» o «Añadir a pantalla de inicio»'}
            </p>
          )}
        </div>
        <button type="button" onClick={handleDismiss} className="gc-btn gc-btn--plain gc-btn--icon" aria-label="Cerrar">
          <WeatherIcon id="x" size={14} />
        </button>
      </div>
      {!isIosDevice && canPrompt && (
        <button type="button" onClick={handleInstall} className="gc-btn gc-btn--primary">
          Instalar app
        </button>
      )}
    </div>
  );
}

// TypeScript: extend Window for beforeinstallprompt
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
