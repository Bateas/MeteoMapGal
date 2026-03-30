import { useEffect, useMemo, useState, memo } from 'react';
import { useSectorStore } from '../../store/sectorStore';
import { useUIStore } from '../../store/uiStore';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { WeatherIcon } from '../icons/WeatherIcons';
import { ReadingMapSection } from './sections/ReadingMapSection';
import { SpotScoringSection } from './sections/SpotScoringSection';
import { ThermalCastreloSection } from './sections/ThermalCastreloSection';
import { RiasBaixasSection } from './sections/RiasBaixasSection';
import { CampoPanelSection } from './sections/CampoPanelSection';
import { HistorySection } from './sections/HistorySection';
import { GlossarySection } from './sections/GlossarySection';
import { RoadmapSection } from './sections/RoadmapSection';
import { LegalSection } from './sections/LegalSection';

// ── Section definitions per sector ─────────────────────────────

interface GuideSection {
  id: string;
  label: string;
  /** If set, section only shows in these sector IDs */
  sectorOnly?: string[];
}

const ALL_SECTIONS: GuideSection[] = [
  { id: 'intro', label: 'Introducción' },
  { id: 'reading', label: 'Cómo leer el mapa' },
  { id: 'spots', label: 'Spots de navegación' },
  { id: 'thermal', label: 'El térmico de Castrelo', sectorOnly: ['embalse'] },
  { id: 'rias-winds', label: 'Vientos de las Rías', sectorOnly: ['rias'] },
  { id: 'panels', label: 'Paneles y alertas' },
  { id: 'history', label: 'Historial' },
  { id: 'glossary', label: 'Glosario' },
  { id: 'roadmap', label: 'Roadmap y fuentes' },
  { id: 'legal', label: 'Aviso legal' },
];

/** Single generic title — sector details go in the intro content */
const GUIDE_TITLE = 'Guía MeteoMapGal';

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

  const focusTrapRef = useFocusTrap<HTMLDivElement>(open);

  if (!open) return null;

  return (
    <div ref={focusTrapRef} className="fixed inset-0 z-50 bg-slate-950/98 overflow-hidden flex flex-col max-w-full" role="dialog" aria-modal="true" aria-label="Guía MeteoMapGal">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 sm:px-6 py-3 border-b border-slate-800 bg-slate-950/90 backdrop-blur-sm shrink-0 max-w-full overflow-hidden">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <span className="shrink-0"><WeatherIcon id="thermal-wind" size={isMobile ? 22 : 20} /></span>
          <h1 className="text-base sm:text-lg font-bold text-white tracking-tight truncate">
            {GUIDE_TITLE}
          </h1>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="shrink-0 ml-2 text-slate-500 hover:text-white transition-colors text-sm px-3 py-2 rounded hover:bg-slate-800 min-h-[44px] min-w-[44px] active:bg-slate-700 flex items-center gap-1"
        >
          <WeatherIcon id="x" size={18} />
          {!isMobile && (
            <>
              Cerrar <kbd className="ml-1 text-[11px] px-1 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono">G</kbd>
            </>
          )}
        </button>
      </div>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Sidebar nav — horizontal scroll on mobile, vertical on desktop */}
        {isMobile ? (
          <div className="shrink-0 bg-slate-950/95 border-b border-slate-800 overflow-x-auto scrollbar-none">
            <div className="flex gap-1 px-2 py-2 min-w-max">
              {sections.map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => setActiveSection(s.id)}
                  className={`shrink-0 px-3 py-2 rounded-lg text-[11px] font-medium transition-all min-h-[36px] whitespace-nowrap ${
                    activeSection === s.id
                      ? 'bg-blue-600/15 text-blue-400 font-semibold'
                      : 'text-slate-500 active:bg-slate-800'
                  }`}
                >
                  <span className="text-[11px] font-mono text-slate-600 mr-1">{i + 1}</span>
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
                <span className="text-[11px] font-mono text-slate-600 w-4">{i + 1}</span>
                {s.label}
              </button>
            ))}
            {/* Ko-fi support — prominent card below nav */}
            <div className="mt-6 mx-3 p-4 rounded-xl bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-500/20">
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                  <svg className="w-4 h-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/></svg>
                </div>
                <span className="text-xs font-bold text-amber-400">Apoya el proyecto</span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed mb-3">
                MeteoMapGal es gratuito y open source. Si te resulta útil, puedes apoyar su desarrollo.
              </p>
              <a
                href="https://ko-fi.com/meteomapgal"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg
                  bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[11px] font-bold
                  hover:bg-amber-500/25 hover:border-amber-400/50 transition-all"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/></svg>
                ko-fi.com/meteomapgal
              </a>
            </div>
          </nav>
        )}

        {/* Content area */}
        <div className={`flex-1 min-w-0 overflow-y-auto py-4 sm:py-6 ${isMobile ? 'px-3' : 'px-6'}`}>
          <div className="max-w-3xl mx-auto">
            {activeSection === 'intro' && (
              activeSector.id === 'embalse' ? <IntroSection /> : <RiasIntroSection />
            )}
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

/* ─── Intro Section (Embalse) — Generic overview, NOT thermal-specific ───── */
function IntroSection() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Embalse de Castrelo de Miño</h2>

      <p className="text-slate-400 leading-relaxed">
        MeteoMapGal monitoriza en tiempo real las condiciones meteorológicas del embalse de Castrelo
        de Miño y su entorno (radio 35 km). Diseñada para navegantes, kitesurfistas, windsurfistas
        y cualquier persona que necesite datos fiables de viento, temperatura y condiciones.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-800">
          <h3 className="text-sm font-bold text-emerald-400 mb-2 flex items-center gap-1.5">
            <WeatherIcon id="wind" size={16} /> Datos en tiempo real
          </h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            6 fuentes meteorol&oacute;gicas combinadas: AEMET, MeteoGalicia, Meteoclimatic,
            Weather Underground, Netatmo y SkyX. M&aacute;s de 40 estaciones en la zona.
          </p>
        </div>
        <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-800">
          <h3 className="text-sm font-bold text-amber-400 mb-2 flex items-center gap-1.5">
            <WeatherIcon id="sun" size={16} /> Viento t&eacute;rmico
          </h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            Detecci&oacute;n autom&aacute;tica de vientos t&eacute;rmicos del W/SW, con scoring
            basado en datos hist&oacute;ricos AEMET. Ver secci&oacute;n &quot;El t&eacute;rmico de Castrelo&quot;.
          </p>
        </div>
        <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-800">
          <h3 className="text-sm font-bold text-sky-400 mb-2 flex items-center gap-1.5">
            <WeatherIcon id="alert" size={16} /> Alertas inteligentes
          </h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            Avisos autom&aacute;ticos de condiciones adversas: tormentas, niebla,
            inversiones t&eacute;rmicas, rachas fuertes y m&aacute;s. Notificaciones por Telegram.
          </p>
        </div>
        <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-800">
          <h3 className="text-sm font-bold text-violet-400 mb-2 flex items-center gap-1.5">
            <WeatherIcon id="thermometer" size={16} /> Spots de navegaci&oacute;n
          </h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            Scoring autom&aacute;tico del spot Castrelo: calma/flojo/navegable/bueno/fuerte.
            Pron&oacute;stico 12h, ventanas de navegaci&oacute;n y favoritos.
          </p>
        </div>
      </div>

      <div className="bg-gradient-to-r from-blue-900/20 to-emerald-900/20 rounded-lg p-4 border border-slate-700">
        <p className="text-xs text-slate-400">
          <strong className="text-slate-300">Tip:</strong> Esta gu&iacute;a tiene secciones espec&iacute;ficas
          para cada tema. Consulta &quot;El t&eacute;rmico de Castrelo&quot; para entender los vientos
          t&eacute;rmicos del embalse en detalle.
        </p>
      </div>
    </div>
  );
}

/* ─── Rías Baixas Intro Section ──────────────────────────────── */
function RiasIntroSection() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white flex items-center gap-2"><WeatherIcon id="waves" size={24} /> Monitorización costera — Rías Baixas</h2>

      <p className="text-slate-400 leading-relaxed">
        El sector Rías Baixas cubre la costa pontevedresa desde Vigo hasta Vilagarcía de Arousa,
        incluyendo las rías de Vigo, Pontevedra y Arousa. Esta zona presenta una dinámica eólica
        dominada por los vientos atlánticos y la brisa costera.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-800">
          <h3 className="text-sm font-bold text-cyan-400 mb-2 flex items-center gap-1.5"><WeatherIcon id="thermal-wind" size={16} /> Vientos dominantes</h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            Componente N/NW predominante (nortada atlántica), especialmente en verano.
            Las rías canalizan el viento, amplificando su efecto en las bocas.
          </p>
        </div>
        <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-800">
          <h3 className="text-sm font-bold text-emerald-400 mb-2 flex items-center gap-1.5"><WeatherIcon id="beach" size={16} /> Brisa costera</h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            Ciclo térmico tierra-mar: brisa de mar (W) por la tarde,
            terral (E) nocturno. Más suave que los térmicos de valle.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800 text-center">
          <span className="text-2xl"><WeatherIcon id="radar" size={24} /></span>
          <p className="text-xs text-slate-400 mt-1 font-medium">Estaciones en tiempo real</p>
          <p className="text-[11px] text-slate-600">AEMET, MeteoGalicia, Meteoclimatic, Netatmo</p>
        </div>
        <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800 text-center">
          <span className="text-2xl"><WeatherIcon id="anchor" size={24} /></span>
          <p className="text-xs text-slate-400 mt-1 font-medium">Boyas marinas</p>
          <p className="text-[11px] text-slate-600">Oleaje, viento, T agua, humedad de 13 boyas</p>
        </div>
        <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800 text-center">
          <span className="text-2xl"><WeatherIcon id="map" size={24} /></span>
          <p className="text-xs text-slate-400 mt-1 font-medium">Capas interactivas</p>
          <p className="text-[11px] text-slate-600">Viento, humedad, satélite IR, radar, rayos</p>
        </div>
        <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800 text-center">
          <span className="text-2xl"><WeatherIcon id="alert-triangle" size={24} /></span>
          <p className="text-xs text-slate-400 mt-1 font-medium">Alertas automáticas</p>
          <p className="text-[11px] text-slate-600">Viento, tormentas, visibilidad</p>
        </div>
      </div>

      <div className="bg-gradient-to-r from-cyan-900/20 to-blue-900/20 rounded-lg p-4 border border-slate-700">
        <p className="text-xs text-slate-400 italic">
          <strong className="text-slate-300">Modo Rías Baixas:</strong> Este sector se centra en la
          monitorización del viento costero, oleaje y condiciones marinas. Incluye boyas marinas
          (PORTUS + Observatorio Costeiro) en el mapa y mareas de 5 puertos. El scoring de spots
          y las alertas de navegación funcionan en ambos sectores. Las zonas térmicas y el análisis
          térmico de valle son exclusivos del sector Embalse de Castrelo.
        </p>
      </div>
    </div>
  );
}
