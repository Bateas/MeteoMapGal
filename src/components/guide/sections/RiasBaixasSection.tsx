/**
 * Guide section: Vientos de las Rías Baixas — coastal wind patterns.
 * Equivalent to ThermalCastreloSection but for Rías sector.
 * Scalable pattern: each zone gets its own section with local knowledge.
 */
import { WeatherIcon } from '../../icons/WeatherIcons';
import type { IconId } from '../../icons/WeatherIcons';

export function RiasBaixasSection() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h2 className="text-3xl font-extrabold text-white tracking-tight">Vientos de las Rías Baixas</h2>
        <p className="text-slate-400 text-sm leading-relaxed">
          Patrones de viento costero, cómo funcionan las rías y qué esperar en cada spot según la época del año.
        </p>
      </div>

      {/* ── 1. Patrones principales ── */}
      <div className="space-y-3">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <WeatherIcon id="wind" size={18} className="text-cyan-400" />
          Tres vientos, tres personalidades
        </h3>
        <div className="space-y-2">
          <PatternCard
            name="Nortada (NW)"
            direction="295°–330°"
            season="Verano (Jun–Sep)"
            speed="12–20 kt"
            color="#3b82f6"
            description="El viento dominante del verano gallego. Asociado al anticiclón de las Azores. Constante, predecible, ideal para navegar en spots exteriores (Cíes-Ría). Produce afloramiento (agua fría) y puede generar niebla en las bocas."
          />
          <PatternCard
            name="Virazón / Térmica (SW/WSW)"
            direction="200°–250°"
            season="Primavera–Otoño (tardes)"
            speed="10–18 kt"
            color="#22c55e"
            description="Brisa de mar que entra por las tardes cuando el sol calienta la tierra. Similar al térmico de valle pero más suave. Funciona mejor en días claros con diferencia tierra-mar. Las estaciones en tierra subestiman el viento real en el agua (hasta 50%)."
          />
          <PatternCard
            name="Suroeste atlántico (SW)"
            direction="200°–240°"
            season="Otoño–Invierno"
            speed="15–30+ kt"
            color="#ef4444"
            description="Temporales atlánticos con frentes de lluvia. Olas de 2-4m en zonas exteriores. Solo para expertos con equipo adecuado. Las rías interiores (Cesantes, Bocana) quedan más protegidas."
          />
        </div>
      </div>

      {/* ── 2. El ciclo diario ── */}
      <div className="space-y-3">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <WeatherIcon id="clock" size={18} className="text-amber-400" />
          Ciclo diario típico (verano)
        </h3>
        <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
          <div className="space-y-2">
            <CycleRow hours="00–07h" icon="moon" label="Terral (E/NE)" desc="Aire frío drena de tierra al mar por las rías. Más fuerte en el eje central (Rande). 2-8 kt." color="#64748b" />
            <CycleRow hours="07–11h" icon="sun" label="Calma transitoria" desc="El terral se debilita. El sol empieza a calentar la tierra. Transición." color="#f59e0b" />
            <CycleRow hours="11–14h" icon="wind" label="Entrada de brisa" desc="Rotación a W/SW. La brisa de mar empieza a entrar por las bocas de las rías." color="#22c55e" />
            <CycleRow hours="14–18h" icon="sailboat" label="Pico de viento" desc="Brisa establecida. Mejor momento para navegar. 10-18 kt en spots favorables." color="#3b82f6" />
            <CycleRow hours="18–21h" icon="sunset" label="Caída gradual" desc="El viento baja al perder calentamiento solar. Últimos ratos navegables." color="#8b5cf6" />
          </div>
        </div>
      </div>

      {/* ── 3. El efecto ría ── */}
      <div className="space-y-3">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <WeatherIcon id="waves" size={18} className="text-teal-400" />
          El efecto ría: canalización y protección
        </h3>
        <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800 text-xs text-slate-400 space-y-3 leading-relaxed">
          <p>
            Las rías son <strong className="text-slate-300">estuarios en forma de embudo</strong> que
            modifican el viento de formas muy diferentes según dónde estés:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <ZoneCard
              title="Exterior (Cíes, Ons)"
              icon="anchor"
              traits={['Exposición oceánica total', 'Olas de fondo (swell)', 'Nortada directa 12-20kt', 'Mar cruzado posible']}
              color="#ef4444"
              level="Avanzado"
            />
            <ZoneCard
              title="Media ría (C. Ría, Lourido)"
              icon="sailboat"
              traits={['Protección parcial del swell', 'Virazón SW bien canalizada', 'Olas cortas de viento local', 'Condiciones versátiles']}
              color="#f59e0b"
              level="Intermedio"
            />
            <ZoneCard
              title="Interior (Cesantes, Bocana)"
              icon="map-pin"
              traits={['Agua plana, sin swell', 'Térmica WSW de tarde', 'N canalizado por Rande', 'Ideal para empezar']}
              color="#22c55e"
              level="Principiante"
            />
          </div>
        </div>
      </div>

      {/* ── 4. Fenómenos costeros ── */}
      <div className="space-y-3">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <WeatherIcon id="alert-triangle" size={18} className="text-red-400" />
          Fenómenos a tener en cuenta
        </h3>
        <div className="space-y-2">
          <PhenomenonCard
            icon="thermometer"
            title="Afloramiento (upwelling)"
            desc="Viento N/NW sostenido ≥12kt durante 6+ horas empuja el agua superficial mar adentro. Sube agua fría del fondo (caída de 3-5°C). Típico de julio-agosto. MeteoMapGal lo detecta y alerta."
            color="#06b6d4"
          />
          <PhenomenonCard
            icon="cloud"
            title="Niebla de advección"
            desc="Tras un episodio de afloramiento, si llega aire cálido del S/SW sobre el agua fría → niebla densa en las bocas. Las rías interiores suelen estar despejadas. Más frecuente al atardecer."
            color="#8b5cf6"
          />
          <PhenomenonCard
            icon="waves"
            title="Mar cruzado (cross-sea)"
            desc="Cuando el viento cambia de dirección pero el oleaje antiguo persiste → olas cruzadas, mar confuso. Peligroso en spots exteriores con swell oceánico (periodo ≥8s). MeteoMapGal alerta cuando la divergencia supera 45°."
            color="#ef4444"
          />
          <PhenomenonCard
            icon="anchor"
            title="Corrientes de marea"
            desc="En estrechos (Rande, bocanas) las corrientes de marea pueden alcanzar 2+ nudos. Combinadas con viento en contra crean mar corto e incómodo. Consulta las mareas antes de salir."
            color="#0ea5e9"
          />
        </div>
      </div>

      {/* ── 5. Estacionalidad ── */}
      <div className="space-y-3">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <WeatherIcon id="sun" size={18} className="text-amber-400" />
          ¿Cuándo es mejor?
        </h3>
        <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
          <div className="space-y-1.5">
            <SeasonRow season="Primavera (Mar–May)" pattern="Virazón SW + días variables" quality="Irregular" dotColor="bg-amber-400" />
            <SeasonRow season="Verano (Jun–Sep)" pattern="Nortada NW estable + térmicas SW" quality="Mejor época" dotColor="bg-emerald-400" />
            <SeasonRow season="Otoño (Oct–Nov)" pattern="SW frontal + terral matutino" quality="Días sueltos" dotColor="bg-amber-400" />
            <SeasonRow season="Invierno (Dic–Feb)" pattern="Temporales SW, días de N" quality="Solo expertos" dotColor="bg-red-400" />
          </div>
        </div>
      </div>

      {/* ── Nota ── */}
      <div className="bg-blue-900/10 rounded-lg p-3 border border-blue-700/20">
        <p className="text-[10px] text-blue-400/70">
          <WeatherIcon id="info" size={12} className="inline mr-1" />
          Las rías canalizan y modifican el viento — una estación a 2km de distancia puede marcar
          condiciones muy diferentes. Por eso MeteoMapGal cruza datos de múltiples estaciones cercanas
          a cada spot, ponderando por calidad de fuente, distancia y frescura del dato.
        </p>
      </div>
    </div>
  );
}

/* ─── Sub-components ─── */

function PatternCard({ name, direction, season, speed, color, description }: {
  name: string; direction: string; season: string; speed: string; color: string; description: string;
}) {
  return (
    <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-800" style={{ borderColor: `${color}25` }}>
      <div className="flex items-center gap-3 mb-2">
        <div className="w-3 h-3 rounded-full shrink-0" style={{ background: color }} />
        <span className="text-sm font-bold" style={{ color }}>{name}</span>
        <span className="text-[9px] text-slate-500 font-mono ml-auto">{direction}</span>
      </div>
      <div className="flex gap-4 mb-2">
        <span className="text-[10px] text-slate-500"><strong className="text-slate-400">{season}</strong></span>
        <span className="text-[10px] text-slate-500"><strong className="text-slate-400">{speed}</strong></span>
      </div>
      <p className="text-[10px] text-slate-500 leading-relaxed">{description}</p>
    </div>
  );
}

function CycleRow({ hours, icon, label, desc, color }: {
  hours: string; icon: IconId; label: string; desc: string; color: string;
}) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className="text-xs font-mono text-slate-500 w-14 shrink-0">{hours}</span>
      <span style={{ color }}><WeatherIcon id={icon} size={14} /></span>
      <div>
        <span className="text-[11px] font-bold" style={{ color }}>{label}</span>
        <p className="text-[10px] text-slate-500 mt-0.5">{desc}</p>
      </div>
    </div>
  );
}

function ZoneCard({ title, icon, traits, color, level }: {
  title: string; icon: IconId; traits: string[]; color: string; level: string;
}) {
  return (
    <div className="bg-slate-800/30 rounded-lg p-3 border border-slate-700/50">
      <div className="flex items-center gap-1.5 mb-2">
        <WeatherIcon id={icon} size={13} />
        <span className="text-[10px] font-bold text-slate-300">{title}</span>
      </div>
      <ul className="space-y-1 mb-2">
        {traits.map((t) => (
          <li key={t} className="text-[9px] text-slate-500 flex items-start gap-1">
            <span style={{ color }}>•</span> {t}
          </li>
        ))}
      </ul>
      <span className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={{ color, background: `${color}15` }}>
        {level}
      </span>
    </div>
  );
}

function PhenomenonCard({ icon, title, desc, color }: {
  icon: IconId; title: string; desc: string; color: string;
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-900/50 border border-slate-800">
      <span className="shrink-0 mt-0.5" style={{ color }}><WeatherIcon id={icon} size={16} /></span>
      <div>
        <span className="text-xs font-bold" style={{ color }}>{title}</span>
        <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

function SeasonRow({ season, pattern, quality, dotColor }: {
  season: string; pattern: string; quality: string; dotColor: string;
}) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="text-[10px] font-bold text-slate-300 w-36 shrink-0">{season}</span>
      <span className="text-[10px] text-slate-500 flex-1">{pattern}</span>
      <span className="text-[10px] font-bold shrink-0 flex items-center gap-1">
        <span className={`inline-block w-2 h-2 rounded-full ${dotColor}`} />
        {quality}
      </span>
    </div>
  );
}
