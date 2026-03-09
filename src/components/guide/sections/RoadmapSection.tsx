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

        {/* Últimas actualizaciones */}
        <TimelineGroup label="Últimas actualizaciones" dotColor="bg-emerald-500" textColor="text-emerald-400" />
        <TimelineMilestone
          iconId="sailboat"
          title="Briefing diario de navegación"
          desc="Veredicto con score 0-100, consenso multi-estación y ventana de viento."
          status="done"
        />
        <TimelineMilestone
          iconId="anchor"
          title="Mareas IHM (Rías Baixas)"
          desc="Predicciones de mareas de 5 puertos gallegos con curva visual y tabla 48h."
          status="done"
        />
        <TimelineMilestone
          iconId="gauge"
          title="Perfil atmosférico"
          desc="Panel de estabilidad atmosférica con evaluación combinada para térmicos."
          status="done"
        />
        <TimelineMilestone
          iconId="drone"
          title="Espacio aéreo ENAIRE"
          desc="Zonas UAS y NOTAMs en mapa con veredicto automático para drones."
          status="done"
        />
        <TimelineMilestone
          iconId="leaf"
          title="Panel Campo (fitosanitario + riego)"
          desc="Riesgo mildiu/oídio para viñedo y evapotranspiración con consejo de riego."
          status="done"
        />

        <TimelineMilestone
          iconId="radar"
          title="Viento en estaciones (consenso)"
          desc="Panel siempre visible con consenso multi-estación, tendencia, coherencia entre zonas y estabilidad."
          status="done"
        />

        <TimelineMilestone
          iconId="sprout"
          title="Grados-día de crecimiento (GDD)"
          desc="Acumulación térmica para vid: etapa fenológica, progreso, próximo hito y consejo agrícola."
          status="done"
        />

        <TimelineMilestone
          iconId="moon"
          title="Fases lunares y calendario agrícola"
          desc="Fase lunar actual, iluminación, próxima fase y recomendaciones para cultivos gallegos."
          status="done"
        />

        {/* Minor updates — collapsed */}
        <div className="relative flex items-start gap-3 pb-4 ml-3">
          <div className="absolute left-[-33px] top-1.5 w-[9px] h-[9px] rounded-full border bg-emerald-500/20 border-emerald-500/30" />
          <span className="shrink-0 mt-0.5 text-emerald-400/50">
            <WeatherIcon id="check" size={15} />
          </span>
          <div className="min-w-0">
            <span className="text-[10px] text-slate-500">
              Otras mejoras: estadísticas de viento, caché offline (PWA), satélite IR, radar de precipitación, historial persistente (TimescaleDB).
            </span>
          </div>
        </div>

        {/* Nota beta móvil */}
        <div className="relative flex items-start gap-3 pb-4 ml-3">
          <div className="absolute left-[-33px] top-1.5 w-[9px] h-[9px] rounded-full border bg-amber-500/30 border-amber-500/50" />
          <span className="shrink-0 mt-0.5 text-amber-400/70">
            <WeatherIcon id="alert-triangle" size={15} />
          </span>
          <div className="min-w-0">
            <span className="text-[10px] font-bold text-amber-400">Versión beta en móviles</span>
            <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
              La interfaz móvil está en fase beta. Puede haber elementos visuales sin pulir,
              pequeños bugs de layout o funcionalidades pendientes de optimizar para pantallas pequeñas.
            </p>
          </div>
        </div>

        {/* Próximamente */}
        <TimelineGroup label="Próximamente" dotColor="bg-amber-500" textColor="text-amber-400" />
        <TimelineMilestone
          iconId="waves"
          title="Boyas marinas (Puertos del Estado)"
          desc="Oleaje, temperatura del agua y viento mar adentro para Rías Baixas."
          status="planned"
        />
        <TimelineMilestone
          iconId="database"
          title="Dashboard de tendencias"
          desc="Consultas al historial TimescaleDB: gráficas comparativas, estadísticas y exportación."
          status="planned"
        />

        {/* Futuras funcionalidades */}
        <TimelineGroup label="Futuras funcionalidades" dotColor="bg-slate-500" textColor="text-slate-400" />
        <TimelineMilestone
          iconId="map-pin"
          title="Nuevas zonas de monitorización"
          desc="Expansión a más zonas de Galicia: A Coruña, Lugo, Costa da Morte, Ría de Arousa y más."
          status="idea"
        />
        <TimelineMilestone
          iconId="alert-triangle"
          title="Alertas personalizadas"
          desc="Definir umbrales propios de viento, temperatura o humedad con notificación push."
          status="idea"
        />
        <TimelineMilestone
          iconId="sun"
          title="Predicción avanzada de térmicos"
          desc="Análisis con datos históricos AEMET para probabilidad de térmicos a 2-3 días."
          status="idea"
        />
        <TimelineMilestone
          iconId="cloud"
          title="Calidad del aire"
          desc="Datos de calidad del aire integrados en el panel Campo."
          status="idea"
        />
        <TimelineMilestone
          iconId="info"
          title="Apoya el proyecto"
          desc="Sección de donaciones para contribuir al desarrollo y mantenimiento de MeteoMapGal."
          status="idea"
        />
      </div>

      {/* ── Fuentes de datos ─────────────────────────────── */}
      <div className="border-t border-slate-700/50 pt-6 space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-white">Fuentes de datos</h2>
          <p className="text-[10px] text-slate-500 leading-relaxed">
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
            <SourceRow letter="N" name="Netatmo" desc="Red doméstica IoT — 11 estaciones" color="#a855f7" />
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
            <WeatherIcon id="satellite" size={13} /> Fuentes complementarias
          </h3>
          <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800 space-y-2">
            <SourceRow letter="O" name="Open-Meteo" desc="Modelo numérico (ECMWF/GFS) — previsión horaria" color="#06b6d4" />
            <SourceRow letter="R" name="AEMET Radar" desc="Radar de precipitación de Cuntis" color="#ec4899" />
            <SourceRow letter="S" name="EUMETSAT" desc="Satélite Meteosat — imagen infrarroja" color="#8b5cf6" />
            <SourceRow letter="L" name="MeteoGalicia" desc="Red de detección de rayos" color="#f43f5e" />
            <SourceRow letter="E" name="ENAIRE" desc="Espacio aéreo y NOTAMs para drones" color="#6366f1" />
            <SourceRow letter="T" name="IHM / Puertos del Estado" desc="Predicciones de mareas (5 puertos)" color="#14b8a6" />
          </div>
        </div>

        {/* Tech stack — simplified, no architecture details */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
            <WeatherIcon id="info" size={13} /> Tecnologías
          </h3>
          <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[10px]">
              <TechRow name="React + Vite" license="MIT" />
              <TechRow name="TypeScript" license="Apache-2" />
              <TechRow name="MapLibre GL" license="BSD-3" />
              <TechRow name="Tailwind CSS" license="MIT" />
              <TechRow name="Zustand" license="MIT" />
              <TechRow name="Recharts" license="MIT" />
            </div>
            <div className="flex gap-4 mt-3 pt-2 border-t border-slate-700/50 text-[10px]">
              <span className="text-slate-500">41+ estaciones</span>
              <span className="text-slate-500">11 APIs</span>
              <span className="text-slate-500">159 tests</span>
            </div>
          </div>
        </div>

        {/* Open source note */}
        <div className="bg-slate-900/30 rounded-lg p-3 border border-slate-700/50">
          <p className="text-[10px] text-slate-400">
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
        <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

/* ─── Shared sub-components ─────────────────────── */

function SourceRow({ letter, name, desc, color }: { letter: string; name: string; desc: string; color: string }) {
  return (
    <div className="flex items-start gap-3">
      <div
        className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
        style={{ background: color }}
      >
        {letter}
      </div>
      <div>
        <span className="text-[10px] font-bold text-slate-300">{name}</span>
        <span className="text-[9px] text-slate-500 ml-1">{desc}</span>
      </div>
    </div>
  );
}

function TechRow({ name, license }: { name: string; license: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-300 font-medium">{name}</span>
      <span className="text-slate-600 font-mono text-[9px]">{license}</span>
    </div>
  );
}
