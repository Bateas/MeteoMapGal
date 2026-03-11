import { useState, useEffect, useRef, useMemo } from 'react';
import { useWeatherStore, type WeatherSource } from '../../store/weatherStore';

// ── Source display info ─────────────────────────────────────────
const SOURCE_META: Record<WeatherSource, { label: string; abbr: string; color: string }> = {
  aemet: { label: 'AEMET', abbr: 'A', color: '#3b82f6' },
  meteogalicia: { label: 'MeteoGalicia', abbr: 'MG', color: '#10b981' },
  meteoclimatic: { label: 'Meteoclimatic', abbr: 'MC', color: '#f59e0b' },
  wunderground: { label: 'Weather Underground', abbr: 'WU', color: '#8b5cf6' },
  netatmo: { label: 'Netatmo', abbr: 'NT', color: '#06b6d4' },
};

const SOURCES: WeatherSource[] = ['aemet', 'meteogalicia', 'meteoclimatic', 'wunderground', 'netatmo'];

// ── Phase definitions ───────────────────────────────────────────
type Phase = 'init' | 'discovering' | 'connecting' | 'ready';
const PHASE_LABELS: Record<Phase, string> = {
  init: 'Iniciando...',
  discovering: 'Descubriendo estaciones',
  connecting: 'Conectando fuentes de datos',
  ready: '¡Datos cargados!',
};

interface LoadingScreenProps {
  sectorName: string;
  error: string | null;
  onRetry: () => void;
}

/** Minimum time (ms) the loading screen stays visible — ensures smooth UX even with fast loads */
const MIN_DISPLAY_MS = 1800;

export function LoadingScreen({ sectorName, error, onRetry }: LoadingScreenProps) {
  const stations = useWeatherStore((s) => s.stations);
  const readingsCount = useWeatherStore((s) => s.currentReadings.size);
  const sourceFreshness = useWeatherStore((s) => s.sourceFreshness);

  // ── Phase progression ─────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>('init');
  const [progress, setProgress] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);
  const [visible, setVisible] = useState(true);
  const startTime = useRef(Date.now());
  const frameRef = useRef<number>(0);

  // Track which sources have reported (real progress)
  const activeSources = useMemo(() => {
    const active = new Set<WeatherSource>();
    for (const [src, status] of sourceFreshness) {
      if (status.lastSuccess || status.lastError) {
        active.add(src as WeatherSource);
      }
    }
    return active;
  }, [sourceFreshness]);

  // Phase transitions based on real state
  // 'ready' requires actual readings, not just station discovery
  useEffect(() => {
    if (readingsCount > 0 && activeSources.size >= 2) {
      setPhase('ready');
    } else if (stations.length > 0 && activeSources.size >= 1) {
      setPhase('connecting');
    } else if (stations.length > 0) {
      setPhase('connecting');
    } else if (Date.now() - startTime.current > 800) {
      setPhase('discovering');
    }
  }, [stations.length, activeSources.size, readingsCount]);

  // Auto-advance from 'init' to 'discovering' after brief delay
  useEffect(() => {
    const t = setTimeout(() => {
      if (phase === 'init') setPhase('discovering');
    }, 800);
    return () => clearTimeout(t);
  }, [phase]);

  // Progress bar: hybrid (time-based placebo + real source completion)
  useEffect(() => {
    const animate = () => {
      const elapsed = Date.now() - startTime.current;
      const sourcePct = (activeSources.size / SOURCES.length) * 100;

      // Time-based component: smooth curve that slows down as it approaches 70%
      // Uses an ease-out curve: 1 - e^(-t/T) scaled to 70%
      const timePct = 70 * (1 - Math.exp(-elapsed / 12000));

      // Real progress overrides placebo when it's ahead
      let pct: number;
      if (phase === 'ready') {
        pct = 100;
      } else if (stations.length > 0) {
        // Discovery done: 50% base + sources fill the rest
        pct = Math.max(50 + sourcePct * 0.5, timePct);
      } else {
        pct = Math.min(timePct, 48); // Cap at 48% until discovery completes
      }

      setProgress((prev) => Math.max(prev, pct)); // Never go backwards
      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  }, [phase, stations.length, activeSources.size, readingsCount]);

  // Fade-out when ready — but respect minimum display time
  useEffect(() => {
    if (phase !== 'ready') return;

    const elapsed = Date.now() - startTime.current;
    const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);

    // Wait for min display time, then start fade
    const t = setTimeout(() => setFadeOut(true), remaining);
    const t2 = setTimeout(() => setVisible(false), remaining + 800);
    return () => { clearTimeout(t); clearTimeout(t2); };
  }, [phase]);

  if (!visible) return null;

  return (
    <div
      className={`absolute inset-0 z-20 flex items-center justify-center transition-opacity duration-700 ${
        fadeOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      style={{ background: 'radial-gradient(ellipse at center, #0f172a 0%, #020617 100%)' }}
    >
      {/* Animated weather particles background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <WeatherParticles />
      </div>

      {/* Main content */}
      <div className="relative z-10 flex flex-col items-center gap-6 px-6 max-w-sm w-full">
        {/* App logo area */}
        <div className="flex flex-col items-center gap-2 mb-2">
          <WindIcon className={phase === 'ready' ? 'animate-none' : ''} />
          <h1 className="text-xl font-bold text-white tracking-wide">
            MeteoMap<span className="text-blue-400">Gal</span>
          </h1>
          <p className="text-xs text-slate-500">{sectorName}</p>
        </div>

        {/* Error state */}
        {error ? (
          <div className="flex flex-col items-center gap-3">
            <div className="text-sm text-red-400 text-center">{error}</div>
            <button
              onClick={onRetry}
              className="px-4 py-2 text-xs rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors font-medium"
            >
              Reintentar
            </button>
          </div>
        ) : (
          <>
            {/* Phase message */}
            <div className="text-center">
              <p className="text-sm text-slate-300 transition-all duration-500">
                {PHASE_LABELS[phase]}
              </p>
            </div>

            {/* Progress bar */}
            <div className="w-full">
              <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500 ease-out"
                  style={{
                    width: `${progress}%`,
                    background: phase === 'ready'
                      ? 'linear-gradient(90deg, #3b82f6, #10b981)'
                      : 'linear-gradient(90deg, #1e40af, #3b82f6)',
                  }}
                />
              </div>
            </div>

            {/* Source indicators */}
            <div className="flex gap-2 flex-wrap justify-center">
              {SOURCES.map((src) => {
                const meta = SOURCE_META[src];
                const isActive = activeSources.has(src);
                const status = sourceFreshness.get(src);
                const hasError = status?.lastError && !status?.lastSuccess;

                return (
                  <div
                    key={src}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-mono transition-all duration-500 ${
                      isActive
                        ? hasError
                          ? 'bg-red-950/50 text-red-400 border border-red-800/40'
                          : 'bg-slate-800/80 text-slate-200 border border-slate-600/40'
                        : 'bg-slate-900/50 text-slate-600 border border-slate-800/30'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full transition-all duration-500 ${
                        isActive
                          ? hasError
                            ? 'bg-red-400'
                            : 'bg-emerald-400'
                          : 'bg-slate-700 animate-pulse'
                      }`}
                    />
                    {meta.abbr}
                    {isActive && !hasError && status?.readingCount != null && (
                      <span className="text-slate-500">{status.readingCount}</span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Station count (once discovered) */}
            {stations.length > 0 && (
              <p className="text-xs text-slate-500 animate-fade-in">
                {stations.length} estaciones encontradas
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Animated wind icon (SVG) ────────────────────────────────────
function WindIcon({ className = '' }: { className?: string }) {
  return (
    <div className={`relative w-16 h-16 ${className}`}>
      <svg viewBox="0 0 64 64" className="w-full h-full">
        {/* Wind lines with staggered animation */}
        <g stroke="#3b82f6" strokeWidth="2.5" fill="none" strokeLinecap="round">
          <path d="M8 24 Q28 18, 48 24 Q56 26, 52 20 Q50 16, 44 18" className="animate-wind-1" />
          <path d="M12 32 Q32 28, 52 32 Q58 33, 56 28 Q54 24, 48 27" className="animate-wind-2" opacity="0.7" />
          <path d="M6 40 Q26 36, 44 40 Q50 41, 48 36 Q46 32, 40 35" className="animate-wind-3" opacity="0.5" />
        </g>
        {/* Subtle compass dot */}
        <circle cx="32" cy="50" r="2" fill="#1e40af" opacity="0.4" />
      </svg>
    </div>
  );
}

// ── Floating particles (CSS-only, no canvas) ────────────────────
function WeatherParticles() {
  const particles = useMemo(() => {
    return Array.from({ length: 20 }, (_, i) => ({
      id: i,
      left: `${(i * 17 + 7) % 100}%`,
      top: `${(i * 23 + 11) % 100}%`,
      size: 1 + (i % 3),
      delay: (i * 0.4) % 8,
      duration: 6 + (i % 5) * 2,
      opacity: 0.1 + (i % 4) * 0.05,
    }));
  }, []);

  return (
    <>
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute rounded-full animate-float-particle"
          style={{
            left: p.left,
            top: p.top,
            width: p.size,
            height: p.size,
            backgroundColor: '#3b82f6',
            opacity: p.opacity,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </>
  );
}
