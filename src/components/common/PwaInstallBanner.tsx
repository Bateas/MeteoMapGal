/**
 * PwaInstallBanner — prompts user to install PWA after 2+ visits.
 *
 * Android: captures `beforeinstallprompt` event.
 * iOS: shows manual instructions (no native prompt available).
 * Dismissed state persisted in localStorage.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { WeatherIcon } from '../icons/WeatherIcons';

const STORAGE_KEY = 'pwa-install-dismissed';
const VISIT_COUNT_KEY = 'pwa-visit-count';
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
  const [isIosDevice] = useState(isIos);
  const promptRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Already installed or dismissed
    if (isStandalone()) return;
    if (localStorage.getItem(STORAGE_KEY)) return;

    // Count visits
    const count = parseInt(localStorage.getItem(VISIT_COUNT_KEY) || '0', 10) + 1;
    localStorage.setItem(VISIT_COUNT_KEY, String(count));
    if (count < MIN_VISITS) return;

    // iOS: show manual instructions
    if (isIos()) {
      setShow(true);
      return;
    }

    // Android/Desktop: wait for beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault();
      promptRef.current = e as BeforeInstallPromptEvent;
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

  if (!show) return null;

  return (
    <div className="fixed bottom-16 left-2 right-2 sm:left-auto sm:right-4 sm:bottom-4 sm:w-80 z-50 bg-slate-800 border border-slate-600 rounded-xl p-3 shadow-2xl animate-in slide-in-from-bottom-2">
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center">
          <WeatherIcon id="wind" size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">Instalar MeteoMapGal</p>
          {isIosDevice ? (
            <p className="text-[11px] text-slate-400 mt-0.5">
              Toca <strong>Compartir</strong> y luego <strong>Añadir a pantalla de inicio</strong>
            </p>
          ) : (
            <p className="text-[11px] text-slate-400 mt-0.5">
              Accede sin navegador, datos en tiempo real en tu pantalla de inicio
            </p>
          )}
        </div>
        <button
          onClick={handleDismiss}
          className="shrink-0 text-slate-500 hover:text-slate-300 min-w-[32px] min-h-[32px] flex items-center justify-center"
          aria-label="Cerrar"
        >
          <WeatherIcon id="x" size={14} />
        </button>
      </div>
      {!isIosDevice && (
        <button
          onClick={handleInstall}
          className="mt-2 w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors min-h-[40px]"
        >
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
