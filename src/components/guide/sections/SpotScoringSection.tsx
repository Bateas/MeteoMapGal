/**
 * Guide section: Spots de navegación — explains the unified spot scoring system.
 * Generic section (both sectors).
 */
import { WeatherIcon } from '../../icons/WeatherIcons';

export function SpotScoringSection() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Spots de navegación</h2>
      <p className="text-slate-400 text-sm leading-relaxed">
        Cada sector tiene <strong className="text-slate-300">spots</strong>: zonas concretas
        de navegación con su propio veredicto GO / MARGINAL / NO GO basado en estaciones
        cercanas, boyas y patrones de viento conocidos.
      </p>

      {/* What is a spot */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">
          <WeatherIcon id="sailboat" size={14} className="inline-block mr-1.5 text-emerald-400" />
          ¿Qué es un spot?
        </h3>
        <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800 text-[10px] text-slate-400 space-y-2 leading-relaxed">
          <p>
            Un spot es una micro-zona de navegación con radio definido (6-15 km). El sistema
            selecciona automáticamente las estaciones meteorológicas y boyas más cercanas
            para calcular un scoring específico.
          </p>
          <p>
            Puedes seleccionar el spot activo en el panel lateral. El marcador del spot
            aparece en el mapa con el icono y color de su veredicto.
          </p>
        </div>
      </div>

      {/* Spots by sector */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">Spots disponibles</h3>

        {/* Embalse */}
        <div className="bg-slate-900/50 rounded-lg p-3 border border-amber-500/20 space-y-1.5">
          <div className="text-[11px] font-bold text-amber-400">Embalse de Castrelo</div>
          <SpotRow name="Castrelo" desc="Centro del embalse. Viento térmico WSW dominante." thermal />
          <p className="text-[9px] text-slate-500 italic pt-1">
            Próximamente: más spots (viñedos, valles colindantes).
          </p>
        </div>

        {/* Rías */}
        <div className="bg-slate-900/50 rounded-lg p-3 border border-blue-500/20 space-y-1.5">
          <div className="text-[11px] font-bold text-blue-400">Rías Baixas</div>
          <SpotRow name="Cesantes" desc="Interior Ría de Vigo. Agua plana, térmica WSW." thermal />
          <SpotRow name="Bocana" desc="Estrecho de Rande → Vigo. Catabático matutino E/ENE." />
          <SpotRow name="Centro Ría" desc="Zona media. Virazón SW tardes, oleaje moderado." />
          <SpotRow name="Cíes-Ría" desc="Zona exterior. Nortada, swell oceánico." />
        </div>
      </div>

      {/* Scoring */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">Scoring del spot (0-100)</h3>
        <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800 space-y-2 text-[10px]">
          <p className="text-slate-400 leading-relaxed">
            El score combina <strong className="text-slate-300">viento real</strong> (estaciones
            cercanas) + <strong className="text-slate-300">olas</strong> (boyas) +
            <strong className="text-slate-300"> patrones reconocidos</strong> (térmica, nortada,
            bocana).
          </p>
          <div className="space-y-1 pt-1">
            <VerdictRow color="#10b981" label="GO" range="≥ 50" desc="Buenas condiciones confirmadas por estaciones." />
            <VerdictRow color="#f59e0b" label="MARGINAL" range="25 – 49" desc="Algo de viento pero no sostenido, o patrón incipiente." />
            <VerdictRow color="#ef4444" label="NO GO" range="< 25" desc="Calma o condiciones desfavorables." />
          </div>
        </div>
      </div>

      {/* Thermal detail */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">
          <WeatherIcon id="thermometer" size={14} className="inline-block mr-1.5 text-orange-400" />
          Detalle térmico
        </h3>
        <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800 text-[10px] text-slate-400 space-y-2 leading-relaxed">
          <p>
            Los spots con <strong className="text-slate-300">detección térmica</strong> (Castrelo,
            Cesantes) muestran filas adicionales al expandir la tarjeta:
          </p>
          <ul className="space-y-1 pl-3">
            <li><strong className="text-orange-400">ΔT diurno</strong> — diferencia entre Tmax y Tmin previstas. ≥16°C favorece térmicas.</li>
            <li><strong className="text-yellow-400">Prob. térmicas</strong> — estimación combinando ΔT + atmósfera + tendencia.</li>
            <li><strong className="text-sky-400">Ventana viento</strong> — horas previstas con viento ≥3kt (10h-20h).</li>
            <li><strong className="text-slate-300">Nubes / CAPE</strong> — cobertura nubosa + energía convectiva.</li>
            <li><strong className="text-amber-400">Tendencia</strong> — señales precursoras (activas, probables, en formación).</li>
          </ul>
          <p className="text-[9px] text-slate-500 italic">
            Estos datos proceden de Open-Meteo (previsión) y del análisis térmico en tiempo real.
          </p>
        </div>
      </div>

      {/* Mobile */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">En móvil</h3>
        <p className="text-[10px] text-slate-400 leading-relaxed">
          Una pastilla flotante sobre el mapa muestra el veredicto del spot activo.
          Al tocarla se abre el panel lateral completo.
        </p>
      </div>
    </div>
  );
}

/* ─── Sub-components ─────────────────────────── */

function SpotRow({ name, desc, thermal }: { name: string; desc: string; thermal?: boolean }) {
  return (
    <div className="flex items-start gap-2 text-[10px]">
      <WeatherIcon id="sailboat" size={11} className="text-slate-500 mt-0.5 flex-shrink-0" />
      <div>
        <span className="font-bold text-slate-300">{name}</span>
        {thermal && <span className="text-orange-400/70 ml-1 text-[9px]">térmico</span>}
        <span className="text-slate-500 ml-1">— {desc}</span>
      </div>
    </div>
  );
}

function VerdictRow({ color, label, range, desc }: { color: string; label: string; range: string; desc: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
      <span className="font-bold w-16" style={{ color }}>{label}</span>
      <span className="text-slate-500 font-mono w-12">{range}</span>
      <span className="text-slate-400 flex-1">{desc}</span>
    </div>
  );
}
