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

        <TimelineMilestone
          iconId="database"
          title="Historial meteorológico"
          desc="Pestaña Historial con gráficas de tendencias, selector de estación por nombre y estadísticas."
          status="done"
        />

        <TimelineMilestone
          iconId="waves"
          title="Boyas marinas (Puertos del Estado)"
          desc="Oleaje, viento, T agua, corrientes y salinidad de 12 boyas en Rías Baixas. Marcadores con datos visuales y popup detallado al clic."
          status="done"
        />

        <TimelineMilestone
          iconId="wind"
          title="Rosa de vientos histórica"
          desc="Diagrama polar de frecuencia de viento por dirección y velocidad. Disponible en Historial."
          status="done"
        />

        <TimelineMilestone
          iconId="radar"
          title="Comparación de estaciones"
          desc="Superponer gráficas de 2 estaciones para comparar tendencias históricas lado a lado."
          status="done"
        />

        <TimelineMilestone
          iconId="map-pin"
          title="Filtrado inteligente de estaciones"
          desc="Exclusión automática de estaciones de interior irrelevantes en Rías Baixas y deduplicación por proximidad entre fuentes para eliminar clustering."
          status="done"
        />

        <TimelineMilestone
          iconId="sailboat"
          title="Spots de navegación unificados"
          desc="Scoring multi-spot con detalle térmico integrado. 4 spots en Rías + 1 en Embalse. GO/MARGINAL/NOGO con veredicto 0-100."
          status="done"
        />

        <TimelineMilestone
          iconId="droplets"
          title="Observatorio Costeiro da Xunta"
          desc="Fuente suplementaria de boyas: humedad, punto de rocío, resolución 10min. Merge dual con PORTUS. Estación nueva: Muros (Ría Muros-Noia)."
          status="done"
        />

        <TimelineMilestone
          iconId="waves"
          title="Corrientes superficiales (RADAR ON RAIA)"
          desc="Overlay WMS de radar HF costero (INTECMAR). Corrientes superficiales en tiempo real para toda la costa gallega. Solo en sector Rías Baixas."
          status="done"
        />

        <TimelineMilestone
          iconId="gauge"
          title="Tendencia barométrica (alertas 3h)"
          desc="Detección por consenso multi-estación de subidas/bajadas rápidas de presión con alertas automáticas."
          status="done"
        />

        <TimelineMilestone
          iconId="cloud"
          title="Predictor de niebla marítima"
          desc="Detección de advección y niebla marina para Rías Baixas con alertas por spread T-Td, viento y humedad."
          status="done"
        />

        <TimelineMilestone
          iconId="alert-triangle"
          title="Alertas de mar cruzado"
          desc="Detección de oleaje cruzado (diferencia >45° entre viento y olas) con alertas de seguridad para navegación."
          status="done"
        />

        <TimelineMilestone
          iconId="map-pin"
          title="Overlay de batimetría"
          desc="Capa visual de profundidades en Rías Baixas basada en datos EMODnet con escala de color."
          status="done"
        />

        <TimelineMilestone
          iconId="alert-triangle"
          title="Sistema de alertas coherente"
          desc="PELIGRO reservado para condiciones peligrosas reales (≥85 score). Banner rojo superior con sonido sutil. Sonido desactivado por defecto para avisos menores."
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
              Otras mejoras: estadísticas de viento, caché offline (PWA), satélite IR, radar de precipitación, historial meteorológico (TimescaleDB), micro-animaciones CSS, auditoría de rendimiento.
            </span>
          </div>
        </div>

        {/* Nota funcionalidades en beta */}
        <div className="relative flex items-start gap-3 pb-4 ml-3">
          <div className="absolute left-[-33px] top-1.5 w-[9px] h-[9px] rounded-full border bg-amber-500/30 border-amber-500/50" />
          <span className="shrink-0 mt-0.5 text-amber-400/70">
            <WeatherIcon id="alert-triangle" size={15} />
          </span>
          <div className="min-w-0">
            <span className="text-[10px] font-bold text-amber-400">Funcionalidades en <span className="badge-beta" style={{ borderColor: 'rgba(245,158,11,0.3)', color: '#f59e0b', background: 'rgba(245,158,11,0.1)' }}>Beta</span></span>
            <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
              Algunas funcionalidades están marcadas con <span className="badge-beta">Beta</span> en la interfaz.
              Esto incluye: spots de navegación, alertas meteorológicas, niebla marítima, viento por consenso,
              perfil atmosférico, alertas dron, riesgo fitosanitario y evapotranspiración.
              Pueden tener imprecisiones o falsos positivos — úsalas como orientación, no como fuente definitiva.
            </p>
          </div>
        </div>

        <TimelineMilestone
          iconId="sailboat"
          title="Mejor ventana de navegación"
          desc="'¿Cuándo salgo?' — 48h forecast por spot, ventanas contiguas con scoring dual (térmico/viento). Timeline en popup + resumen en selector."
          status="done"
        />
        <TimelineMilestone
          iconId="thermometer"
          title="Detector de afloramiento"
          desc="Upwelling costero gallego: bajada SST + viento N/NW persistente ≥12kt × 6h = alerta Ekman. Datos de boyas en tiempo real."
          status="done"
        />
        <TimelineMilestone
          iconId="gauge"
          title="Verificación de previsión"
          desc="'¿Acertó?' — compara forecasts pasados (Open-Meteo Previous Runs) con observaciones reales (TimescaleDB). MAE, bias, accuracy."
          status="done"
        />
        <TimelineMilestone
          iconId="radar"
          title="Delta forecast vs observación"
          desc="Badges Δ en cada estación: diferencia en tiempo real entre previsión y lectura actual (viento kt, temperatura °C)."
          status="done"
        />
        <TimelineMilestone
          iconId="thermal-wind"
          title="Alerta térmica temprana"
          desc="6 señales precursoras (terral, ΔT agua-aire, solar, humedad, divergencia, forecast) → probabilidad 0-100% con ETA."
          status="done"
        />
        <TimelineMilestone
          iconId="thermal-wind"
          title="Amplificación térmica en spots"
          desc="Detección de térmicas donde las estaciones en tierra subestiman el viento en el agua (hasta +50%)."
          status="done"
        />
        <TimelineMilestone
          iconId="wind"
          title="Ticker de condiciones"
          desc="Banner animado con condiciones actuales: veredictos de spots, racha máxima, oleaje, rango de temperaturas."
          status="done"
        />
        <TimelineMilestone
          iconId="map-pin"
          title="Spot favorito"
          desc="Marca tu spot preferido con ★ para acceso rápido. Se muestra primero en el ticker y en la barra de navegación."
          status="done"
        />
        <TimelineMilestone
          iconId="thermometer"
          title="Índice de calor"
          desc="Sensación térmica real cuando T>27°C y HR>40% (fórmula NWS). Alerta visual en popup del spot."
          status="done"
        />
        <TimelineMilestone
          iconId="wind"
          title="Factor de racha"
          desc="Indicador de turbulencia: ratio racha/viento sostenido (×N.N) en popup de estaciones."
          status="done"
        />
        <TimelineMilestone
          iconId="database"
          title="Rankings de estaciones"
          desc="Pestaña Rankings: top estaciones por viento, temperatura, humedad y presión en tiempo real."
          status="done"
        />
        <TimelineMilestone
          iconId="alert-triangle"
          title="Alertas por Telegram"
          desc="Notificaciones push vía bot de Telegram para alertas moderadas, altas y críticas. Silencio nocturno 23:00-07:00."
          status="done"
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
            <SourceRow letter="R" name="AEMET Radar" desc="Radar de precipitación de Cuntis" color="#ec4899" />
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
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[10px]">
              <TechRow name="React + Vite" license="MIT" />
              <TechRow name="TypeScript" license="Apache-2" />
              <TechRow name="MapLibre GL" license="BSD-3" />
              <TechRow name="Tailwind CSS" license="MIT" />
              <TechRow name="Zustand" license="MIT" />
              <TechRow name="Recharts" license="MIT" />
            </div>
            <div className="flex gap-4 mt-3 pt-2 border-t border-slate-700/50 text-[10px]">
              <span className="text-slate-500">100+ estaciones</span>
              <span className="text-slate-500">17 APIs</span>
              <span className="text-slate-500">163 tests</span>
              <span className="text-slate-500">TimescaleDB</span>
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
