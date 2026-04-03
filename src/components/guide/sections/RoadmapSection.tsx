/**
 * Guide section: Roadmap — vertical timeline + data sources.
 * Concise, user-friendly. No architecture details exposed.
 */
import { WeatherIcon } from '../../icons/WeatherIcons';
import type { IconId } from '../../icons/WeatherIcons';

export function RoadmapSection() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h2 className="text-3xl font-extrabold text-white tracking-tight">Roadmap</h2>
        <p className="text-slate-400 text-sm leading-relaxed">
          Progreso del proyecto, próximas funcionalidades y fuentes de datos.
        </p>
      </div>

      {/* ── Timeline ─────────────────────────────────────── */}
      <div className="relative pl-8">
        {/* Vertical line */}
        <div className="absolute left-[11px] top-0 bottom-0 w-px bg-slate-700" />

        {/* ── Ultimas novedades ── */}
        <TimelineGroup label="Últimas novedades" dotColor="bg-emerald-500" textColor="text-emerald-400" />
        <TimelineMilestone iconId="sailboat" title="13 spots con veredicto automático" desc="10 de vela + 3 de surf. Scoring basado en 100+ estaciones y 13 boyas marinas." status="done" />
        <TimelineMilestone iconId="waves" title="Previsión de olas 24h" desc="Altura, período, tendencia y veredicto de surf (FLAT/PEQUE/SURF OK/CLÁSICO/GRANDE)." status="done" />
        <TimelineMilestone iconId="camera" title="20 webcams con visión IA" desc="19 cámaras MeteoGalicia + webcam propia ESP32-CAM en Castrelo. Análisis automático: Beaufort, niebla, visibilidad." status="done" />
        <TimelineMilestone iconId="bell" title="Alertas inteligentes por Telegram" desc="Avisos de cambio de condiciones: viento, niebla, tormentas, olas. Silencio nocturno." status="done" />
        <TimelineMilestone iconId="sailboat" title="Modo Evento para regatas" desc="Zona de agua, panel de seguridad, balizas, mareas, aviación, previsión 6h." status="done" />
        <TimelineMilestone iconId="compass" title="Previsión horaria por spot" desc="Ventana de navegación 48h + mini-timeline 12h directamente en el popup." status="done" />
        <TimelineMilestone iconId="map-pin" title="Compartir, favoritos y comparador" desc="Comparte condiciones por WhatsApp/Telegram. Compara todos los spots en una tabla." status="done" />
        <TimelineMilestone iconId="layers" title="Radar, corrientes y cartas náuticas" desc="Capas de datos: radar precipitación, batimetría, corrientes HF, señalización marítima, carta IHM." status="done" />

        {/* ── Proximamente ── */}
        <TimelineGroup label="Próximamente" dotColor="bg-sky-500" textColor="text-sky-400" />
        <TimelineMilestone iconId="anchor" title="Seguimiento de embarcaciones" desc="Posición de barcos en tiempo real y alertas marítimas inteligentes." status="idea" />
        <TimelineMilestone iconId="bell" title="Alertas a medida" desc="Define tus umbrales de viento, olas o temperatura y recibe avisos automáticos." status="idea" />
        <TimelineMilestone iconId="map-pin" title="Más zonas y actividades" desc="A Coruña, Costa da Morte, nuevos spots. Scoring por actividad: surf, vela, kite, SUP." status="idea" />
        <TimelineMilestone iconId="eye" title="Correlaciones históricas" desc={'Patrones basados en datos reales acumulados: "Cuando Silleiro marca X, Patos tiene Y."'} status="idea" />
      </div>

      {/* ── Fuentes de datos ─────────────────────────────── */}
      <div className="border-t border-slate-700/50 pt-6 space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-white">Fuentes de datos</h2>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Todos los datos provienen de <strong className="text-slate-400">fuentes abiertas y públicas</strong>:
            organismos oficiales, redes ciudadanas y proyectos de ciencia abierta.
          </p>
        </div>

        <div className="space-y-3">
          <h3 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
            <WeatherIcon id="database" size={13} /> Estaciones en tiempo real
          </h3>
          <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800 space-y-2">
            <SourceRow letter="A" name="AEMET" desc="Agencia Estatal de Meteorología — 9 estaciones" color="#ef4444" />
            <SourceRow letter="M" name="MeteoGalicia" desc="Xunta de Galicia — 13 estaciones" color="#3b82f6" />
            <SourceRow letter="C" name="Meteoclimatic" desc="Red ciudadana — 6 estaciones" color="#22c55e" />
            <SourceRow letter="W" name="Weather Underground" desc="Estaciones personales — 1 estación" color="#f59e0b" />
            <SourceRow letter="N" name="Netatmo" desc="Red doméstica IoT — 31+ estaciones" color="#a855f7" />
            <SourceRow letter="S" name="SkyX" desc="Estación personal portátil — auto-descubrimiento por GPS" color="#64748b" />
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
            <WeatherIcon id="satellite" size={13} /> Fuentes complementarias
          </h3>
          <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800 space-y-2">
            <SourceRow letter="O" name="Open-Meteo" desc="Modelo numérico (ECMWF/GFS) — previsión horaria" color="#06b6d4" />
            <SourceRow letter="R" name="AEMET Radar" desc="Radar nacional (Cerceda/A Coruña)" color="#ec4899" />
            <SourceRow letter="L" name="MeteoGalicia" desc="Red de detección de rayos" color="#f43f5e" />
            <SourceRow letter="E" name="ENAIRE" desc="Espacio aéreo y NOTAMs para drones" color="#6366f1" />
            <SourceRow letter="T" name="IHM / Puertos del Estado" desc="Predicciones de mareas (5 puertos)" color="#14b8a6" />
            <SourceRow letter="B" name="Puertos del Estado (PORTUS)" desc="Boyas marinas — oleaje, viento, corrientes (12 estaciones)" color="#06b6d4" />
            <SourceRow letter="X" name="Observatorio Costeiro (Xunta)" desc="Boyas suplementarias — humedad, punto de rocío, 10min (6 plataformas)" color="#14b8a6" />
            <SourceRow letter="H" name="RADAR ON RAIA (INTECMAR)" desc="Corrientes superficiales — radar HF costero, actualización horaria" color="#0ea5e9" />
            <SourceRow letter="C" name="CMEMS / Copernicus Marine" desc="Temperatura superficial del mar (SST) — WMTS tiles" color="#0d9488" />
            <SourceRow letter="D" name="EMODnet" desc="Batimetría — profundidades marinas WMS" color="#475569" />
            <SourceRow letter="N" name="NOAA" desc="Índices NAO/AO — teleconexiones atlánticas" color="#059669" />
            <SourceRow letter="I" name="IGN" desc="Cartografía: ortofotos PNOA, sombreado MDT, curvas de nivel" color="#7c3aed" />
            <SourceRow letter="W" name="MeteoGalicia Webcams" desc="19 cámaras costeras públicas (imágenes cada 5 min)" color="#3b82f6" />
            <SourceRow letter="O" name="Open-Meteo Marine" desc="Previsión horaria de oleaje y swell (48h)" color="#06b6d4" />
          </div>
        </div>

        {/* Tech stack — simplified, no architecture details */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
            <WeatherIcon id="info" size={13} /> Tecnologías
          </h3>
          <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
              <TechRow name="React + Vite" license="MIT" />
              <TechRow name="TypeScript" license="Apache-2" />
              <TechRow name="MapLibre GL" license="BSD-3" />
              <TechRow name="Tailwind CSS" license="MIT" />
              <TechRow name="Zustand" license="MIT" />
              <TechRow name="Recharts" license="MIT" />
            </div>
            <div className="flex gap-4 mt-3 pt-2 border-t border-slate-700/50 text-[11px]">
              <span className="text-slate-500">100+ estaciones</span>
              <span className="text-slate-500">19 webcams + IA</span>
              <span className="text-slate-500">235 tests</span>
              <span className="text-slate-500">TimescaleDB 24/7</span>
            </div>
          </div>
        </div>

        {/* Open source note */}
        <div className="bg-slate-900/30 rounded-lg p-3 border border-slate-700/50">
          <p className="text-[11px] text-slate-400">
            <strong className="text-slate-300">Código abierto:</strong> MeteoMapGal es un proyecto open source
            basado íntegramente en datos abiertos. Todas las licencias utilizadas (MIT, BSD, Apache)
            son libres — permiten su uso, modificación y distribución sin restricciones.
            {' '}
            <a
              href="https://github.com/Bateas/MeteoMapGal"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
            >Ver en GitHub</a>
            {' · '}
            <a
              href="https://github.com/Bateas/MeteoMapGal/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
            >Reportar bug / Sugerencias</a>
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─── Timeline sub-components ───────────────────── */

function TimelineGroup({ label, dotColor, textColor }: { label: string; dotColor: string; textColor: string }) {
  return (
    <div className="relative flex items-center gap-2 pt-5 pb-2">
      <div className={`absolute left-[-21px] w-[21px] h-[21px] rounded-full ${dotColor} flex items-center justify-center ring-2 ring-slate-950`}>
        {dotColor.includes('emerald') && (
          <WeatherIcon id="check" size={12} className="text-white" />
        )}
        {dotColor.includes('amber') && (
          <WeatherIcon id="clock" size={12} className="text-white" />
        )}
      </div>
      <span className={`text-sm font-bold ${textColor} ml-3 uppercase tracking-wide`}>{label}</span>
    </div>
  );
}

function TimelineMilestone({
  iconId,
  title,
  desc,
  status,
}: {
  iconId: IconId;
  title: string;
  desc: string;
  status: 'done' | 'planned' | 'idea' | 'wip';
}) {
  const cfg = {
    done:    { dot: 'bg-emerald-500/30 border-emerald-500/50', text: 'text-emerald-400', icon: 'text-emerald-400/70' },
    wip:     { dot: 'bg-sky-500/30 border-sky-500/50', text: 'text-sky-400', icon: 'text-sky-400/70' },
    planned: { dot: 'bg-amber-500/20 border-amber-500/40', text: 'text-amber-400', icon: 'text-amber-400/70' },
    idea:    { dot: 'bg-slate-500/20 border-slate-500/40', text: 'text-slate-400', icon: 'text-slate-500' },
  };
  const s = cfg[status];

  return (
    <div className="relative flex items-start gap-3 pb-4 ml-3">
      {/* Small dot on timeline */}
      <div className={`absolute left-[-33px] top-1.5 w-[9px] h-[9px] rounded-full border ${s.dot}`} />
      <span className={`shrink-0 mt-0.5 ${s.icon}`}>
        <WeatherIcon id={iconId} size={15} />
      </span>
      <div className="min-w-0">
        <span className={`text-xs font-bold ${s.text}`}>{title}</span>
        <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

/* ─── Shared sub-components ─────────────────────── */

function SourceRow({ letter, name, desc, color }: { letter: string; name: string; desc: string; color: string }) {
  return (
    <div className="flex items-start gap-3">
      <div
        className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white"
        style={{ background: color }}
      >
        {letter}
      </div>
      <div>
        <span className="text-[11px] font-bold text-slate-300">{name}</span>
        <span className="text-[11px] text-slate-500 ml-1">{desc}</span>
      </div>
    </div>
  );
}

function TechRow({ name, license }: { name: string; license: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-300 font-medium">{name}</span>
      <span className="text-slate-600 font-mono text-[11px]">{license}</span>
    </div>
  );
}
