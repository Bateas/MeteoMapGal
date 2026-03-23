/**
 * OnboardingTour — first-visit walkthrough (5 steps) with element highlighting.
 *
 * Each step highlights a target element via `data-tour` attribute by
 * pulling it above the backdrop with z-index and adding a pulsing ring.
 * Dialog positions itself near the highlighted element.
 *
 * Persisted via Zustand → localStorage. Auto-launches 3s after first load.
 */
import { memo, useEffect, useCallback, useState, useRef } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useSectorStore } from '../../store/sectorStore';
import { WeatherIcon } from '../icons/WeatherIcons';
import type { IconId } from '../icons/WeatherIcons';

interface Step {
  icon: IconId;
  title: string;
  desc: string;
  tip?: string;
  /** CSS selector for the element to highlight (via data-tour attribute) */
  highlight?: string;
}

const STEPS: Step[] = [
  {
    icon: 'sailboat',
    title: 'Bienvenido a MeteoMapGal',
    desc: 'Condiciones en tiempo real para Galicia. 6 fuentes de datos, 100+ estaciones y 13 boyas marinas actualizadas cada 5 minutos.',
    tip: 'Cambia de zona (Embalse / Rías) con los botones superiores.',
    highlight: '[data-tour="sectors"]',
  },
  {
    icon: 'map-pin',
    title: 'Spots de navegación',
    desc: 'Los marcadores grandes son spots con scoring automático (0-100). Toca uno para ver viento, oleaje, mareas, pronóstico 12h y ventanas de navegación.',
    tip: 'Marca tu spot favorito con la estrella para acceso rápido.',
  },
  {
    icon: 'wind',
    title: 'Panel lateral',
    desc: 'Estaciones, gráficas, previsión multi-modelo, boyas marinas, rankings y verificación de pronósticos. Todo organizado por pestañas.',
    tip: 'En desktop el panel está siempre visible a la izquierda.',
    highlight: '[data-tour="sidebar"]',
  },
  {
    icon: 'alert-triangle',
    title: 'Alertas inteligentes',
    desc: 'Detección automática de tormentas, niebla, mar cruzado, lluvia, cambios bruscos de viento y más. Las alertas críticas llegan por Telegram.',
    tip: 'Verde = todo bien. Naranja/rojo = revisar alertas.',
    highlight: '[data-tour="panel"]',
  },
  {
    icon: 'book-open',
    title: 'Guía completa',
    desc: 'Documentación de cada función: spots, térmicos, alertas, fuentes de datos, patrones de viento y glosario meteorológico.',
    tip: 'Pulsa ? en cualquier momento para ver atajos de teclado.',
    highlight: '[data-tour="guide"]',
  },
];

/** Ring animation styles applied to highlighted element */
const HIGHLIGHT_RING_CLASS = 'onboarding-highlight';

export const OnboardingTour = memo(function OnboardingTour() {
  const step = useUIStore((s) => s.onboardingStep);
  const completed = useUIStore((s) => s.onboardingCompleted);
  const setStep = useUIStore((s) => s.setOnboardingStep);
  const complete = useUIStore((s) => s.completeOnboarding);
  const isMobile = useUIStore((s) => s.isMobile);
  const sectorName = useSectorStore((s) => s.activeSector.name);

  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);
  const prevHighlightRef = useRef<Element | null>(null);

  // Auto-launch on first visit, 3s after load
  useEffect(() => {
    if (completed || step !== null) return;
    const timer = setTimeout(() => setStep(0), 3000);
    return () => clearTimeout(timer);
  }, [completed, step, setStep]);

  // Highlight target element for current step
  useEffect(() => {
    // Clean up previous highlight
    if (prevHighlightRef.current) {
      prevHighlightRef.current.classList.remove(HIGHLIGHT_RING_CLASS);
      (prevHighlightRef.current as HTMLElement).style.removeProperty('z-index');
      (prevHighlightRef.current as HTMLElement).style.removeProperty('position');
      prevHighlightRef.current = null;
    }

    if (step === null) {
      setHighlightRect(null);
      return;
    }

    const current = STEPS[step];
    if (!current.highlight) {
      setHighlightRect(null);
      return;
    }

    const el = document.querySelector(current.highlight);
    if (!el) {
      setHighlightRect(null);
      return;
    }

    // Pull element above backdrop
    const htmlEl = el as HTMLElement;
    htmlEl.style.position = 'relative';
    htmlEl.style.zIndex = '51';
    htmlEl.classList.add(HIGHLIGHT_RING_CLASS);
    prevHighlightRef.current = el;

    setHighlightRect(el.getBoundingClientRect());

    return () => {
      htmlEl.classList.remove(HIGHLIGHT_RING_CLASS);
      htmlEl.style.removeProperty('z-index');
      htmlEl.style.removeProperty('position');
    };
  }, [step]);

  const handleNext = useCallback(() => {
    if (step === null) return;
    if (step >= STEPS.length - 1) {
      complete();
    } else {
      setStep(step + 1);
    }
  }, [step, setStep, complete]);

  const handleSkip = useCallback(() => {
    complete();
  }, [complete]);

  const handleBack = useCallback(() => {
    if (step !== null && step > 0) setStep(step - 1);
  }, [step, setStep]);

  if (step === null) return null;

  const current = STEPS[step];
  const isLast = step >= STEPS.length - 1;
  const isFirst = step === 0;

  // Position dialog near highlighted element or center
  const dialogStyle: React.CSSProperties = {};
  if (highlightRect && !isMobile) {
    // Desktop: position below the highlighted element
    dialogStyle.position = 'fixed';
    dialogStyle.top = highlightRect.bottom + 12;
    dialogStyle.left = Math.max(16, Math.min(highlightRect.left, window.innerWidth - 380));
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
      onClick={handleSkip}
      onKeyDown={(e) => { if (e.key === 'Escape') handleSkip(); }}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Tour de bienvenida"
    >
      {/* Dialog */}
      <div
        className={`bg-slate-900 border border-slate-700 rounded-xl shadow-2xl animate-fade-in
          ${highlightRect && !isMobile
            ? ''
            : 'fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'
          }
          ${isMobile ? 'mx-4 p-5 max-w-[340px] fixed bottom-20 left-0 right-0 mx-auto' : 'p-6 max-w-sm'}
          w-full`}
        style={highlightRect && !isMobile ? dialogStyle : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Icon + Title */}
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center shrink-0">
            <WeatherIcon id={current.icon} size={20} className="text-blue-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white leading-tight">{current.title}</h3>
            {isFirst && (
              <span className="text-[10px] text-slate-500">Zona: {sectorName}</span>
            )}
          </div>
        </div>

        {/* Description */}
        <p className="text-sm text-slate-400 leading-relaxed mb-3">
          {current.desc}
        </p>

        {/* Tip */}
        {current.tip && (
          <div className="bg-slate-800/50 rounded-lg px-3 py-2 mb-4 border border-slate-700/50">
            <p className="text-[11px] text-slate-500">
              <span className="text-amber-400 font-bold">Tip:</span> {current.tip}
            </p>
          </div>
        )}

        {/* Footer: step counter + buttons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`w-2 h-2 rounded-full transition-colors ${
                  i === step ? 'bg-blue-400' : i < step ? 'bg-blue-400/30' : 'bg-slate-700'
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {!isFirst && (
              <button
                onClick={handleBack}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
              >
                {"Atr\u00e1s"}
              </button>
            )}
            {!isLast && (
              <button
                onClick={handleSkip}
                className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                Saltar
              </button>
            )}
            <button
              onClick={handleNext}
              className="px-4 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500
                rounded-lg transition-colors min-h-[36px]"
            >
              {isLast ? 'Empezar' : 'Siguiente'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
