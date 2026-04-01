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

        {/* Funcionalidades principales — resumen compacto */}
        <TimelineGroup label="Funcionalidades actuales" dotColor="bg-emerald-500" textColor="text-emerald-400" />

        {/* Collapsed summary of core features */}
        <div className="relative flex items-start gap-3 pb-4 ml-3">
          <div className="absolute left-[-33px] top-1.5 w-[9px] h-[9px] rounded-full border bg-emerald-500/20 border-emerald-500/30" />
          <span className="shrink-0 mt-0.5 text-emerald-400/50">
            <WeatherIcon id="check" size={15} />
          </span>
          <div className="min-w-0 space-y-1">
            <span className="text-[11px] font-bold text-emerald-400">30+ funcionalidades implementadas</span>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Scoring de spots (0-100), consenso multi-estaci&oacute;n, alertas inteligentes (Telegram),
              mareas (5 puertos), boyas marinas (13), radar, sat&eacute;lite IR, corrientes superficiales,
              batimetr&iacute;a, carta n&aacute;utica, perfil atmosf&eacute;rico, historial con rosa de vientos,
              pan&oacute;ptico de campo (mildiu, riego, GDD), espacio a&eacute;reo UAS, rankings, PWA offline.
            </p>
          </div>
        </div>

        {/* Destacadas recientes */}
        <TimelineGroup label="Novedades recientes" dotColor="bg-sky-500" textColor="text-sky-400" />
        <TimelineMilestone
          iconId="sailboat"
          title="Ventana de navegaci&oacute;n 48h"
          desc="Forecast por spot con scoring dual (t&eacute;rmico/viento). Timeline en popup + resumen."
          status="done"
        />
        <TimelineMilestone
          iconId="clock"
          title="Mini-timeline 12h en spots"
          desc="Pron&oacute;stico horario directo en el popup: viento, direcci&oacute;n y temperatura."
          status="done"
        />
        <TimelineMilestone
          iconId="alert-triangle"
          title="Alertas por Telegram"
          desc="Notificaciones push para alertas moderadas, altas y cr&iacute;ticas. Silencio nocturno."
          status="done"
        />
        <TimelineMilestone
          iconId="navigation"
          title="Gestos nativos en m&oacute;vil"
          desc="Swipe-down para cerrar paneles. Zoom-scale en marcadores. Accesibilidad mejorada."
          status="done"
        />
        <TimelineMilestone
          iconId="map-pin"
          title="Compartir y favoritos"
          desc="Comparte condiciones de spots por WhatsApp/Telegram. Marca favoritos con ★."
          status="done"
        />
        <TimelineMilestone
          iconId="info"
          title="Feedback"
          desc="Sugerencias, bugs y propuestas de spots: usa GitHub Issues o contacto directo."
          status="done"
        />
        <TimelineMilestone
          iconId="sailboat"
          title="Comparador de spots"
          desc="Compara todos los spots en una tabla: veredicto, viento, direcci&oacute;n, olas, temperatura. Pesta&ntilde;a Comparar."
          status="done"
        />
        <TimelineMilestone
          iconId="navigation"
          title="Exportar datos GeoJSON"
          desc="Descarga estaciones y boyas como archivo GeoJSON para QGIS u otras herramientas GIS."
          status="done"
        />
        <TimelineMilestone
          iconId="alert-triangle"
          title="Avisos proactivos de viento"
          desc="Notificaci&oacute;n autom&aacute;tica cuando un spot pasa de calma a condiciones navegables. Telegram + push en navegador."
          status="done"
        />
        <TimelineMilestone
          iconId="info"
          title="Banner de estado de fuentes"
          desc="Aviso visual cuando AEMET, MeteoGalicia u otras fuentes no responden. Datos parciales indicados."
          status="done"
        />
        <TimelineMilestone
          iconId="sailboat"
          title="Calibraci&oacute;n de viento por spot"
          desc="Offset por spot para compensar estaciones amateurs a baja altura o ubicaciones expuestas. Mejora la precisi&oacute;n del veredicto."
          status="done"
        />
        <TimelineMilestone
          iconId="info"
          title="Widget embeddable"
          desc="Mini widget para incrustar en webs de clubs y escuelas. Muestra condiciones de spots en tiempo real. Modo oscuro/claro + compacto."
          status="done"
        />

        {/* Nota beta */}
        <div className="relative flex items-start gap-3 pb-4 ml-3">
          <div className="absolute left-[-33px] top-1.5 w-[9px] h-[9px] rounded-full border bg-amber-500/30 border-amber-500/50" />
          <span className="shrink-0 mt-0.5 text-amber-400/70">
            <WeatherIcon id="alert-triangle" size={15} />
          </span>
          <div className="min-w-0">
            <span className="text-[11px] font-bold text-amber-400">Funcionalidades en <span className="badge-beta" style={{ borderColor: 'rgba(245,158,11,0.3)', color: '#f59e0b', background: 'rgba(245,158,11,0.1)' }}>Beta</span></span>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
              Spots, alertas, niebla, viento por consenso, perfil atmosf&eacute;rico, dron, campo.
              Pueden tener imprecisiones — &uacute;salas como orientaci&oacute;n, no como fuente definitiva.
            </p>
          </div>
        </div>

        {/* v2.1 — Actual */}
        <TimelineGroup label="v2.1 — Actual" dotColor="bg-amber-500" textColor="text-amber-400" />
        <TimelineMilestone
          iconId="zap"
          title="Rendimiento 60fps"
          desc="Marcadores GPU, terrain toggle durante paneo, part&iacute;culas optimizadas con proyecci&oacute;n lineal."
          status="done"
        />
        <TimelineMilestone
          iconId="map-pin"
          title="Marcadores redise&ntilde;ados"
          desc="Estaciones con letra de fuente (A, MG, MC...) y anillo de color. Boyas en forma de diamante. Spots con arco de viento."
          status="done"
        />
        <TimelineMilestone
          iconId="check"
          title="Accesibilidad mejorada"
          desc="18 correcciones: touch 40px, pausa en ticker, tooltips, banner PWA, b&uacute;squeda en glosario."
          status="done"
        />
        <TimelineMilestone
          iconId="layout"
          title="Nuevo layout"
          desc="Panel lateral colapsable para dar m&aacute;s espacio al mapa."
          status="wip"
        />
        <TimelineMilestone
          iconId="ship"
          title="Tr&aacute;fico mar&iacute;timo (AIS)"
          desc="Posiciones de barcos en tiempo real en las R&iacute;as. Cargueros, ferries, veleros."
          status="idea"
        />
        <TimelineMilestone
          iconId="plane"
          title="Alertas de aviaci&oacute;n (Embalse)"
          desc="Aviso cuando hidroaviones o helic&oacute;pteros de extinci&oacute;n se acercan al embalse."
          status="idea"
        />
        <TimelineMilestone
          iconId="sailboat"
          title="Modo regata"
          desc="Mapa completo con balizas, l&iacute;nea de salida y condiciones combinadas para regatas."
          status="idea"
        />

        {/* Futuras funcionalidades */}
        <TimelineGroup label="Pr&oacute;ximamente" dotColor="bg-slate-500" textColor="text-slate-400" />
        <TimelineMilestone
          iconId="map-pin"
          title="M&aacute;s spots y zonas"
          desc="A Lanzada, Sanxenxo, Samil. Nuevas zonas: A Coru&ntilde;a, Costa da Morte."
          status="idea"
        />
        <TimelineMilestone
          iconId="alert-triangle"
          title="Alertas personalizadas"
          desc="Define tus propios umbrales de viento o temperatura con notificaci&oacute;n push."
          status="idea"
        />
        <TimelineMilestone
          iconId="info"
          title="Apoya el proyecto"
          desc="Si MeteoMapGal te resulta &uacute;til, puedes apoyar su desarrollo."
          status="done"
        />
        <div className="ml-8 -mt-1 mb-3">
          <a
            href="https://ko-fi.com/meteomapgal"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[11px] text-amber-400 hover:text-amber-300 transition-colors"
          >
            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/></svg>
            ko-fi.com/meteomapgal
          </a>
        </div>
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
            <SourceRow letter="S" name="EUMETSAT" desc="Satélite Meteosat — imagen infrarroja" color="#8b5cf6" />
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
              <span className="text-slate-500">17 APIs</span>
              <span className="text-slate-500">185 tests</span>
              <span className="text-slate-500">TimescaleDB</span>
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
  status: 'done' | 'planned' | 'idea';
}) {
  const cfg = {
    done:    { dot: 'bg-emerald-500/30 border-emerald-500/50', text: 'text-emerald-400', icon: 'text-emerald-400/70' },
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
