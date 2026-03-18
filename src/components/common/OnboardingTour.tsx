/**
 * OnboardingTour — first-visit walkthrough (5 steps).
 *
 * Shows a centered modal dialog for each step. No element highlighting
 * (lightweight v1). Persisted via Zustand → localStorage.
 *
 * Auto-launches 3s after first load if onboardingCompleted is false.
 * Skippable at any step. Sector-aware welcome message.
 */
import { memo, useEffect, useCallback } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useSectorStore } from '../../store/sectorStore';
import { WeatherIcon } from '../icons/WeatherIcons';
import type { IconId } from '../icons/WeatherIcons';

interface Step {
  icon: IconId;
  title: string;
  desc: string;
  tip?: string;
}

const STEPS: Step[] = [
  {
    icon: 'sailboat',
    title: 'Bienvenido a MeteoMapGal',
    desc: 'Monitoriza las condiciones meteorol\u00f3gicas de Galicia en tiempo real. Datos de 6 fuentes, m\u00e1s de 100 estaciones y 13 boyas marinas.',
    tip: 'Puedes cambiar de zona (Embalse / R\u00edas) en los botones superiores.',
  },
  {
    icon: 'map-pin',
    title: 'Spots de navegaci\u00f3n',
    desc: 'Los marcadores grandes en el mapa son spots de navegaci\u00f3n con scoring autom\u00e1tico (0-100). Toca uno para ver condiciones, pron\u00f3stico 12h y ventanas de viento.',
    tip: 'Marca tu spot favorito con \u2605 para acceso r\u00e1pido.',
  },
  {
    icon: 'wind',
    title: 'Estaciones y boyas',
    desc: 'Los c\u00edrculos peque\u00f1os son estaciones meteorol\u00f3gicas. Las flechas indican direcci\u00f3n del viento. Los anclas son boyas marinas con oleaje y corrientes.',
    tip: 'Al hacer zoom ver\u00e1s m\u00e1s detalles y etiquetas.',
  },
  {
    icon: 'alert-triangle',
    title: 'Panel de alertas',
    desc: 'El bot\u00f3n "Panel" abre alertas inteligentes: viento, niebla, tormentas, mar cruzado y m\u00e1s. Las alertas cr\u00edticas se env\u00edan por Telegram.',
    tip: 'Bot\u00f3n verde = todo bien. Naranja/rojo = revisar alertas.',
  },
  {
    icon: 'info',
    title: '\u00a1Listo para explorar!',
    desc: 'Usa el men\u00fa \u2630 para ver estaciones, gr\u00e1ficas e historial. La gu\u00eda \uD83D\uDCD6 tiene informaci\u00f3n detallada de cada funci\u00f3n.',
    tip: 'Pulsa ? en cualquier momento para ver atajos de teclado.',
  },
];

export const OnboardingTour = memo(function OnboardingTour() {
  const step = useUIStore((s) => s.onboardingStep);
  const completed = useUIStore((s) => s.onboardingCompleted);
  const setStep = useUIStore((s) => s.setOnboardingStep);
  const complete = useUIStore((s) => s.completeOnboarding);
  const isMobile = useUIStore((s) => s.isMobile);
  const sectorName = useSectorStore((s) => s.activeSector.name);

  // Auto-launch on first visit, 3s after load
  useEffect(() => {
    if (completed || step !== null) return;
    const timer = setTimeout(() => setStep(0), 3000);
    return () => clearTimeout(timer);
  }, [completed, step, setStep]);

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleSkip}
      role="dialog"
      aria-modal="true"
      aria-label="Tour de bienvenida"
    >
      <div
        className={`bg-slate-900 border border-slate-700 rounded-xl shadow-2xl
          ${isMobile ? 'mx-4 p-5 max-w-[340px]' : 'p-6 max-w-sm'}
          w-full animate-fade-in`}
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
          {/* Step dots */}
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

          {/* Buttons */}
          <div className="flex items-center gap-2">
            {!isFirst && (
              <button
                onClick={handleBack}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
              >
                Atr\u00e1s
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
