import { useEffect, useMemo, useState, memo } from 'react';
import { useSectorStore } from '../../store/sectorStore';
import { useUIStore } from '../../store/uiStore';
import { ThermalCycleSection } from './sections/ThermalCycleSection';
import { ZonesMapSection } from './sections/ZonesMapSection';
import { HumiditySection } from './sections/HumiditySection';
import { PropagationSection } from './sections/PropagationSection';
import { BestConditionsSection } from './sections/BestConditionsSection';
import { ReadingMapSection } from './sections/ReadingMapSection';
import { CampoPanelSection } from './sections/CampoPanelSection';
import { SailingBannerSection } from './sections/SailingBannerSection';
import { GlossarySection } from './sections/GlossarySection';

// ── Section definitions per sector ─────────────────────────────

interface GuideSection {
  id: string;
  label: string;
  /** If set, section only shows in these sector IDs */
  sectorOnly?: string[];
}

const ALL_SECTIONS: GuideSection[] = [
  { id: 'intro', label: 'Introducción' },
  { id: 'glossary', label: 'Glosario' },
  { id: 'cycle', label: 'Ciclo diario', sectorOnly: ['embalse'] },
  { id: 'zones', label: 'Nuestras zonas', sectorOnly: ['embalse'] },
  { id: 'humidity', label: 'Humedad e indicadores' },
  { id: 'propagation', label: 'Propagación', sectorOnly: ['embalse'] },
  { id: 'best', label: 'Mejores condiciones', sectorOnly: ['embalse'] },
  { id: 'reading', label: 'Leer el mapa' },
  { id: 'campo', label: 'Panel Alertas' },
  { id: 'sailing', label: 'Navegación y fuentes', sectorOnly: ['embalse'] },
];

/** Single generic title — sector details go in the intro content */
const GUIDE_TITLE = 'Guía MeteoMap';

export const MeteoGuide = memo(function MeteoGuide() {
  const open = useUIStore((s) => s.guideOpen);
  const setOpen = useUIStore((s) => s.setGuideOpen);
  const [activeSection, setActiveSection] = useState('intro');
  const activeSector = useSectorStore((s) => s.activeSector);
  const isMobile = useUIStore((s) => s.isMobile);

  // Filter sections for current sector
  const sections = useMemo(
    () => ALL_SECTIONS.filter((s) => !s.sectorOnly || s.sectorOnly.includes(activeSector.id)),
    [activeSector.id],
  );

  // Reset to intro if current section is hidden after sector switch
  useEffect(() => {
    if (!sections.find((s) => s.id === activeSection)) {
      setActiveSection('intro');
    }
  }, [sections, activeSection]);

  // Listen for 'G' key (all platforms) + Escape to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key.toLowerCase() === 'g') setOpen(!open);
      if (e.key === 'Escape' && open) setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/98 overflow-hidden flex flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-slate-800 bg-slate-950/90 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xl">🌬️</span>
          <h1 className="text-lg font-bold text-white tracking-tight">
            {GUIDE_TITLE}
          </h1>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="text-slate-500 hover:text-white transition-colors text-sm px-3 py-2 rounded hover:bg-slate-800 min-h-[44px] active:bg-slate-700"
        >
          Cerrar {!isMobile && <kbd className="ml-1 text-[10px] px-1 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono">G</kbd>}
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar nav — horizontal scroll on mobile, vertical on desktop */}
        {isMobile ? (
          <div className="absolute top-[53px] left-0 right-0 z-10 bg-slate-950/95 border-b border-slate-800 overflow-x-auto">
            <div className="flex gap-0.5 px-2 py-1.5">
              {sections.map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => setActiveSection(s.id)}
                  className={`shrink-0 px-3 py-2 rounded-lg text-[11px] font-medium transition-all ${
                    activeSection === s.id
                      ? 'bg-blue-600/15 text-blue-400 font-semibold'
                      : 'text-slate-500 active:bg-slate-800'
                  }`}
                >
                  <span className="text-[9px] font-mono text-slate-600 mr-1">{i + 1}</span>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <nav className="w-56 shrink-0 border-r border-slate-800 py-4 overflow-y-auto">
            {sections.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className={`w-full text-left px-4 py-2.5 text-xs transition-all flex items-center gap-2 ${
                  activeSection === s.id
                    ? 'bg-blue-600/10 text-blue-400 border-r-2 border-blue-500 font-semibold'
                    : 'text-slate-500 hover:text-slate-300 hover:bg-slate-900'
                }`}
              >
                <span className="text-[10px] font-mono text-slate-600 w-4">{i + 1}</span>
                {s.label}
              </button>
            ))}
          </nav>
        )}

        {/* Content area */}
        <div className={`flex-1 overflow-y-auto py-6 ${isMobile ? 'px-4 pt-16' : 'px-8'}`}>
          <div className="max-w-3xl mx-auto">
            {activeSection === 'intro' && (
              activeSector.id === 'embalse' ? <IntroSection /> : <RiasIntroSection />
            )}
            {activeSection === 'glossary' && <GlossarySection />}
            {activeSection === 'cycle' && <ThermalCycleSection />}
            {activeSection === 'zones' && <ZonesMapSection />}
            {activeSection === 'humidity' && <HumiditySection />}
            {activeSection === 'propagation' && <PropagationSection />}
            {activeSection === 'best' && <BestConditionsSection />}
            {activeSection === 'reading' && <ReadingMapSection />}
            {activeSection === 'campo' && <CampoPanelSection />}
            {activeSection === 'sailing' && <SailingBannerSection />}
          </div>
        </div>
      </div>
    </div>
  );
});

/* ─── Intro Section ──────────────────────────────────────────── */
function IntroSection() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">¿Qué son los vientos térmicos?</h2>

      <p className="text-slate-400 leading-relaxed">
        Los vientos térmicos son brisas locales generadas por el calentamiento diferencial del terreno.
        Cuando el sol calienta las laderas más rápido que el valle, el aire caliente asciende y el aire
        más fresco del valle se desplaza para reemplazarlo, creando un flujo predecible.
      </p>

      {/* Animated thermal diagram */}
      <div className="bg-slate-900/50 rounded-xl p-6 border border-slate-800">
        <ThermalDiagram />
        <p className="text-[9px] text-slate-600 text-center mt-2 italic">
          Esquema conceptual — los térmicos de valle siguen este patrón en cualquier cuenca fluvial
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-800">
          <h3 className="text-sm font-bold text-amber-400 mb-2">☀️ Viento anabático (día)</h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            El sol calienta las laderas. El aire asciende por la montaña, creando un flujo
            desde el valle hacia arriba, típicamente por las tardes.
          </p>
          <p className="text-[9px] text-slate-600 mt-1.5 italic">
            Ej: en Ribadavia, viento del W/SW por las tardes de verano.
          </p>
        </div>
        <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-800">
          <h3 className="text-sm font-bold text-blue-400 mb-2">🌙 Viento catabático (noche)</h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            Al enfriarse, el aire denso desciende por las laderas hacia el valle.
            Más intenso en noches despejadas y secas.
          </p>
          <p className="text-[9px] text-slate-600 mt-1.5 italic">
            Ej: drenaje N nocturno en Castrelo, 37% frecuencia, 3-4 m/s.
          </p>
        </div>
      </div>

      <div className="bg-gradient-to-r from-blue-900/20 to-amber-900/20 rounded-lg p-4 border border-slate-700 space-y-2">
        <p className="text-xs text-slate-400 italic">
          <strong className="text-slate-300">Dato real (AEMET 2022-2025):</strong> En el embalse de Castrelo de Miño,
          los térmicos del W/SW soplan el 74% de las tardes de verano con Tmax {'>'}31°C,
          alcanzando 7-12 nudos entre las 13h y 20h. Basado en 1.412 registros diarios de
          3 estaciones AEMET (Ribadavia, Ourense, Carballiño).
        </p>
        <p className="text-[10px] text-slate-500">
          <strong className="text-amber-500/70">Nota:</strong> Esta guía distingue entre{' '}
          <span className="text-emerald-400">datos reales de AEMET</span> y{' '}
          <span className="text-amber-400">teoría meteorológica general</span>.
          Los conceptos teóricos se marcan claramente.
        </p>
      </div>
    </div>
  );
}

/* ─── Animated thermal convection SVG ─────────────────────────── */
function ThermalDiagram() {
  return (
    <svg viewBox="0 0 600 280" className="w-full" aria-label="Diagrama de convección térmica">
      <defs>
        {/* Sun glow */}
        <radialGradient id="sunGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#facc15" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#facc15" stopOpacity="0" />
        </radialGradient>
        {/* Mountain gradient */}
        <linearGradient id="mountainGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#475569" />
          <stop offset="100%" stopColor="#1e293b" />
        </linearGradient>
        {/* Water gradient */}
        <linearGradient id="waterGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1e40af" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#1e3a5f" stopOpacity="0.5" />
        </linearGradient>
        {/* Animated arrow marker */}
        <marker id="arrowRed" viewBox="0 0 10 6" refX="10" refY="3" markerWidth="8" markerHeight="6" orient="auto">
          <polygon points="0,0 10,3 0,6" fill="#ef4444" />
        </marker>
        <marker id="arrowBlue" viewBox="0 0 10 6" refX="10" refY="3" markerWidth="8" markerHeight="6" orient="auto">
          <polygon points="0,0 10,3 0,6" fill="#60a5fa" />
        </marker>
      </defs>

      {/* Sky */}
      <rect width="600" height="280" fill="#0f172a" rx="8" />

      {/* Sun */}
      <circle cx="500" cy="50" r="60" fill="url(#sunGlow)" />
      <circle cx="500" cy="50" r="18" fill="#facc15" opacity="0.9">
        <animate attributeName="r" values="18;20;18" dur="3s" repeatCount="indefinite" />
      </circle>

      {/* Left mountain */}
      <polygon points="0,280 0,130 80,90 160,120 200,160 200,280" fill="url(#mountainGrad)" />
      <text x="60" y="115" className="text-[9px] fill-slate-400" textAnchor="middle">Monte</text>
      <text x="60" y="127" className="text-[8px] fill-slate-500" textAnchor="middle">ladera W</text>

      {/* Right mountain */}
      <polygon points="400,280 400,160 440,120 520,100 600,140 600,280" fill="url(#mountainGrad)" />
      <text x="520" y="125" className="text-[9px] fill-slate-400" textAnchor="middle">Monte</text>
      <text x="520" y="137" className="text-[8px] fill-slate-500" textAnchor="middle">ladera E</text>

      {/* Valley floor */}
      <rect x="200" y="220" width="200" height="60" fill="#1e293b" />

      {/* Water (reservoir) */}
      <ellipse cx="300" cy="235" rx="80" ry="15" fill="url(#waterGrad)">
        <animate attributeName="rx" values="80;82;80" dur="4s" repeatCount="indefinite" />
      </ellipse>
      <text x="300" y="238" className="text-[8px] fill-blue-400/60" textAnchor="middle">Embalse 110m</text>

      {/* Rising warm air (red arrows from valley to mountains) */}
      <g opacity="0.7">
        {/* Left rising */}
        <path d="M 200,200 Q 150,150 100,110" fill="none" stroke="#ef4444" strokeWidth="2" strokeDasharray="6,4" markerEnd="url(#arrowRed)">
          <animate attributeName="stroke-dashoffset" values="0;-30" dur="2s" repeatCount="indefinite" />
        </path>
        {/* Right rising */}
        <path d="M 380,200 Q 430,150 480,120" fill="none" stroke="#ef4444" strokeWidth="2" strokeDasharray="6,4" markerEnd="url(#arrowRed)">
          <animate attributeName="stroke-dashoffset" values="0;-30" dur="2s" repeatCount="indefinite" />
        </path>
        {/* Center rising */}
        <path d="M 300,210 Q 300,160 300,80" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4,6" markerEnd="url(#arrowRed)">
          <animate attributeName="stroke-dashoffset" values="0;-30" dur="2.5s" repeatCount="indefinite" />
        </path>
      </g>

      {/* Cool air flowing in from sides (blue arrows at valley level) */}
      <g opacity="0.6">
        {/* W wind into valley */}
        <path d="M 30,210 Q 100,200 190,210" fill="none" stroke="#60a5fa" strokeWidth="2.5" strokeDasharray="8,4" markerEnd="url(#arrowBlue)">
          <animate attributeName="stroke-dashoffset" values="0;-36" dur="1.8s" repeatCount="indefinite" />
        </path>
        {/* E wind into valley */}
        <path d="M 560,210 Q 480,200 410,210" fill="none" stroke="#60a5fa" strokeWidth="2" strokeDasharray="8,4" markerEnd="url(#arrowBlue)">
          <animate attributeName="stroke-dashoffset" values="0;-36" dur="1.8s" repeatCount="indefinite" />
        </path>
      </g>

      {/* Heat waves on valley floor */}
      <g opacity="0.4">
        <path d="M 220,218 Q 240,212 260,218 Q 280,224 300,218" fill="none" stroke="#f59e0b" strokeWidth="1">
          <animate attributeName="d" values="M 220,218 Q 240,212 260,218 Q 280,224 300,218;M 220,216 Q 240,222 260,216 Q 280,210 300,216;M 220,218 Q 240,212 260,218 Q 280,224 300,218" dur="3s" repeatCount="indefinite" />
        </path>
        <path d="M 300,218 Q 320,212 340,218 Q 360,224 380,218" fill="none" stroke="#f59e0b" strokeWidth="1">
          <animate attributeName="d" values="M 300,218 Q 320,212 340,218 Q 360,224 380,218;M 300,216 Q 320,222 340,216 Q 360,210 380,216;M 300,218 Q 320,212 340,218 Q 360,224 380,218" dur="3s" begin="1s" repeatCount="indefinite" />
        </path>
      </g>

      {/* Labels */}
      <text x="110" y="198" className="text-[9px] fill-red-400 font-semibold" textAnchor="middle">Aire caliente ↑</text>
      <text x="90" y="230" className="text-[9px] fill-blue-400 font-semibold">W → Térmico</text>

      {/* Temperature annotations */}
      <g className="text-[8px]">
        <text x="300" y="265" fill="#f59e0b" textAnchor="middle" opacity="0.6">31°C valle</text>
        <text x="80" y="80" fill="#94a3b8" textAnchor="middle" opacity="0.6">22°C cumbre</text>
      </g>
    </svg>
  );
}

/* ─── Rías Baixas Intro Section ──────────────────────────────── */
function RiasIntroSection() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">🌊 Monitorización costera — Rías Baixas</h2>

      <p className="text-slate-400 leading-relaxed">
        El sector Rías Baixas cubre la costa pontevedresa desde Vigo hasta Vilagarcía de Arousa,
        incluyendo las rías de Vigo, Pontevedra y Arousa. Esta zona presenta una dinámica eólica
        dominada por los vientos atlánticos y la brisa costera.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-800">
          <h3 className="text-sm font-bold text-cyan-400 mb-2">🌬️ Vientos dominantes</h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            Componente N/NW predominante (nortada atlántica), especialmente en verano.
            Las rías canalizan el viento, amplificando su efecto en las bocas.
          </p>
        </div>
        <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-800">
          <h3 className="text-sm font-bold text-emerald-400 mb-2">🏖️ Brisa costera</h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            Ciclo térmico tierra-mar: brisa de mar (W) por la tarde,
            terral (E) nocturno. Más suave que los térmicos de valle.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800 text-center">
          <span className="text-2xl">📡</span>
          <p className="text-xs text-slate-400 mt-1 font-medium">Estaciones en tiempo real</p>
          <p className="text-[10px] text-slate-600">AEMET, MeteoGalicia, Meteoclimatic, Netatmo</p>
        </div>
        <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800 text-center">
          <span className="text-2xl">🗺️</span>
          <p className="text-xs text-slate-400 mt-1 font-medium">Capas interactivas</p>
          <p className="text-[10px] text-slate-600">Viento, humedad, satélite IR, rayos</p>
        </div>
        <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800 text-center">
          <span className="text-2xl">⚠️</span>
          <p className="text-xs text-slate-400 mt-1 font-medium">Alertas automáticas</p>
          <p className="text-[10px] text-slate-600">Viento, tormentas, visibilidad</p>
        </div>
      </div>

      <div className="bg-gradient-to-r from-cyan-900/20 to-blue-900/20 rounded-lg p-4 border border-slate-700">
        <p className="text-xs text-slate-400 italic">
          <strong className="text-slate-300">Modo Rías Baixas:</strong> Este sector se centra en la
          monitorización visual del viento costero. Las funcionalidades de análisis térmico, zonas de
          embalse y navegación a vela están disponibles en el sector Embalse de Castrelo.
        </p>
      </div>
    </div>
  );
}
