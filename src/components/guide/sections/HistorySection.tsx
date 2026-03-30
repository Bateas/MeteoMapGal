/**
 * Guide section: Historial meteorológico — explains the History dashboard tab.
 * User-friendly, no technical jargon (no "TimescaleDB", "API", etc.)
 */
import { WeatherIcon } from '../../icons/WeatherIcons';

export function HistorySection() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <WeatherIcon id="database" size={22} /> Historial meteorológico
        </h2>
        <p className="text-slate-400 text-sm leading-relaxed">
          La pestaña <strong className="text-amber-400">Historial</strong> del panel lateral
          permite explorar el registro de todas las estaciones. Visualiza tendencias de
          temperatura, viento, humedad y presión a lo largo de horas, días o semanas.
        </p>
      </div>

      {/* How to use */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-white">Cómo usar el historial</h3>
        <div className="space-y-2">
          <StepCard
            num={1}
            title="Selecciona una estación"
            desc="Elige por nombre (ej: Ribadavia, Ourense, Vigo) en el desplegable. La estación se resaltará en el mapa."
          />
          <StepCard
            num={2}
            title="Elige un rango temporal"
            desc="24 horas (datos cada 5 min), 7 días o 30 días (promedios por hora). Más rango = más perspectiva."
          />
          <StepCard
            num={3}
            title="Cambia la métrica"
            desc="Temperatura (°C), viento (kt), humedad relativa (%) o presión (hPa). La gráfica y las estadísticas se actualizan al instante."
          />
          <StepCard
            num={4}
            title="Rosa de vientos"
            desc="Pulsa el botón Rosa para ver un diagrama polar con la frecuencia del viento por dirección y velocidad. Usa datos de alta resolución (5 min)."
          />
          <StepCard
            num={5}
            title="Compara estaciones"
            desc="Activa Comparar estaciones, elige una segunda estación y verás ambas series superpuestas en colores distintos."
          />
        </div>
      </div>

      {/* What you see */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-white">Qué muestra cada parte</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FeatureCard
            iconId="database"
            title="Gráfica temporal"
            desc="Curva de evolución con el rango y métrica seleccionados. Pasa el cursor para ver valores exactos."
            color="text-amber-400"
          />
          <FeatureCard
            iconId="gauge"
            title="Resumen estadístico"
            desc="8 celdas con lecturas totales, temperatura media y rango, racha máxima, humedad, viento medio, presión y precipitación."
            color="text-blue-400"
          />
          <FeatureCard
            iconId="radar"
            title="Selector por nombre"
            desc="Las estaciones aparecen con su nombre real (Ribadavia, Baiona, etc.) agrupadas por fuente (AEMET, MeteoGalicia...)."
            color="text-emerald-400"
          />
          <FeatureCard
            iconId="map-pin"
            title="Selección en mapa"
            desc="Al elegir una estación, se selecciona automáticamente en el mapa 3D para que la localices al instante."
            color="text-purple-400"
          />
          <FeatureCard
            iconId="wind"
            title="Rosa de vientos"
            desc="Diagrama polar con 16 direcciones y 5 rangos de velocidad. Muestra de dónde sopla el viento con más frecuencia."
            color="text-cyan-400"
          />
          <FeatureCard
            iconId="gauge"
            title="Comparar estaciones"
            desc="Superpón dos estaciones en la misma gráfica para ver diferencias de temperatura, viento o presión."
            color="text-amber-400"
          />
        </div>
      </div>

      {/* Tips */}
      <div className="bg-gradient-to-r from-amber-900/20 to-slate-900/20 rounded-lg p-4 border border-slate-700 space-y-2">
        <h3 className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
          <WeatherIcon id="info" size={14} /> Consejos
        </h3>
        <ul className="text-[11px] text-slate-400 space-y-1 leading-relaxed list-disc list-inside">
          <li>Usa <strong className="text-slate-300">24h</strong> para ver el ciclo diario (térmicos, bajada nocturna).</li>
          <li>Usa <strong className="text-slate-300">7d</strong> para comparar días y detectar tendencias.</li>
          <li>Usa <strong className="text-slate-300">30d</strong> para visión mensual: olas de calor, temporales, sequías.</li>
          <li>El número entre paréntesis indica cuántas lecturas tiene cada estación.</li>
          <li>Los datos se guardan cada 5 minutos desde todas las fuentes de forma automática.</li>
        </ul>
      </div>
    </div>
  );
}

/* ─── Sub-components ───────────────────────────────── */

function StepCard({ num, title, desc }: { num: number; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 bg-slate-900/50 rounded-lg p-3 border border-slate-800">
      <div className="shrink-0 w-6 h-6 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-[11px] font-bold text-amber-400">
        {num}
      </div>
      <div className="min-w-0">
        <span className="text-xs font-bold text-white">{title}</span>
        <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

function FeatureCard({
  iconId,
  title,
  desc,
  color,
}: {
  iconId: string;
  title: string;
  desc: string;
  color: string;
}) {
  return (
    <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800">
      <h4 className={`text-xs font-bold ${color} mb-1 flex items-center gap-1.5`}>
        <WeatherIcon id={iconId as any} size={14} /> {title}
      </h4>
      <p className="text-[11px] text-slate-500 leading-relaxed">{desc}</p>
    </div>
  );
}
