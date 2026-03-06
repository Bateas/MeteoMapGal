/**
 * Guide section: Roadmap — future development milestones and ideas.
 */
import { WeatherIcon } from '../../icons/WeatherIcons';
import type { IconId } from '../../icons/WeatherIcons';

export function RoadmapSection() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Roadmap de desarrollo</h2>
      <p className="text-slate-400 text-sm leading-relaxed">
        MeteoMap está en desarrollo activo. Aquí puedes ver las funcionalidades
        completadas recientemente y las que están en el horizonte.
      </p>

      {/* Recently completed */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-emerald-400 flex items-center gap-1.5">
          <WeatherIcon id="check" size={14} /> Completado recientemente
        </h3>
        <div className="space-y-1.5">
          <MilestoneRow
            iconId="sailboat"
            title="Briefing diario de navegación"
            desc="Veredicto GO/Marginal/No-Go con score 0-100, ventana de viento, ΔT y probabilidad de térmicas."
            status="done"
          />
          <MilestoneRow
            iconId="anchor"
            title="Mareas IHM (Rías Baixas)"
            desc="Predicciones de mareas de 5 puertos gallegos con curva SVG y tabla 48h."
            status="done"
          />
          <MilestoneRow
            iconId="gauge"
            title="Perfil atmosférico (Embalse)"
            desc="Panel de estabilidad: BLH, CAPE, CIN, LI con barra vertical y evaluación combinada."
            status="done"
          />
          <MilestoneRow
            iconId="wind"
            title="Estadísticas de viento por estación"
            desc="Media, racha máx, dirección dominante. Visible en StationCard como badge expandible."
            status="done"
          />
          <MilestoneRow
            iconId="download"
            title="Caché PWA offline"
            desc="Service worker con caché inteligente: lecturas y estaciones disponibles sin conexión."
            status="done"
          />
          <MilestoneRow
            iconId="drone"
            title="Espacio aéreo ENAIRE"
            desc="Zonas UAS (ZGUAS) + NOTAMs en mapa y panel Dron con veredicto automático."
            status="done"
          />
          <MilestoneRow
            iconId="leaf"
            title="Riesgo fitosanitario"
            desc="Mildiu y oídio: conteo de horas favorables en próximas 24h para viñedo Ribeiro."
            status="done"
          />
          <MilestoneRow
            iconId="thermometer"
            title="ET₀ Evapotranspiración"
            desc="Hargreaves-Samani con corrección viento/humedad. Consejo de riego automático."
            status="done"
          />
        </div>
      </div>

      {/* Planned */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-amber-400 flex items-center gap-1.5">
          <WeatherIcon id="clock" size={14} /> En el horizonte
        </h3>
        <div className="space-y-1.5">
          <MilestoneRow
            iconId="database"
            title="TimescaleDB — historial persistente"
            desc="Base de datos de series temporales para almacenar lecturas, alertas y estadísticas a largo plazo."
            status="planned"
          />
          <MilestoneRow
            iconId="waves"
            title="Boyas marinas (Puertos del Estado)"
            desc="Datos de oleaje, temperatura del agua y viento mar adentro para Rías Baixas."
            status="planned"
          />
          <MilestoneRow
            iconId="alert-triangle"
            title="Constructor de alertas personalizadas"
            desc="Interfaz para definir umbrales propios: viento, temperatura, humedad → notificación push."
            status="idea"
          />
          <MilestoneRow
            iconId="sun"
            title="Predictor ML de térmicos"
            desc="Red neuronal entrenada con datos AEMET 2022-2025 para probabilidad de térmicos a 2-3 días."
            status="idea"
          />
          <MilestoneRow
            iconId="cloud"
            title="Calidad del aire"
            desc="Integración de API de calidad del aire para el panel Campo."
            status="idea"
          />
        </div>
      </div>

      {/* Version info */}
      <div className="bg-gradient-to-r from-slate-800/50 to-slate-900/50 rounded-lg p-4 border border-slate-700">
        <div className="flex items-center gap-2 mb-2">
          <WeatherIcon id="info" size={14} />
          <span className="text-xs font-bold text-slate-300">Sobre MeteoMap</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div>
            <span className="text-slate-500">Fuentes de datos</span>
            <p className="text-slate-300 font-medium">AEMET · MeteoGalicia · Meteoclimatic · WU · Netatmo</p>
          </div>
          <div>
            <span className="text-slate-500">Suplementarias</span>
            <p className="text-slate-300 font-medium">Open-Meteo · Lightning · EUMETSAT · Radar · ENAIRE · IHM</p>
          </div>
          <div>
            <span className="text-slate-500">Estaciones</span>
            <p className="text-slate-300 font-medium">41+ (multi-sector)</p>
          </div>
          <div>
            <span className="text-slate-500">Tests</span>
            <p className="text-slate-300 font-medium">159 (Vitest)</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Sub-components ─────────────────────────── */

function MilestoneRow({
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
  const statusConfig = {
    done:    { label: '✓',  bg: 'bg-emerald-500/15', border: 'border-emerald-500/30', text: 'text-emerald-400' },
    planned: { label: '→', bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   text: 'text-amber-400' },
    idea:    { label: '?',  bg: 'bg-slate-500/10',   border: 'border-slate-500/30',   text: 'text-slate-400' },
  };
  const s = statusConfig[status];

  return (
    <div className={`flex items-start gap-2.5 p-2.5 rounded-lg border ${s.border} ${s.bg}`}>
      <span className={`text-xs shrink-0 mt-0.5 ${s.text}`}>
        <WeatherIcon id={iconId} size={14} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] font-bold ${s.text}`}>{title}</span>
          <span className={`text-[8px] font-bold ${s.text} opacity-60`}>{s.label}</span>
        </div>
        <p className="text-[9px] text-slate-500 mt-0.5 leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}
