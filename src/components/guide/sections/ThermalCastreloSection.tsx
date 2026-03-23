/**
 * Guide section: El térmico de Castrelo — unified thermal wind guide.
 * Fuses: ThermalCycle + Zones + Humidity + Propagation + BestConditions
 * into a single, user-friendly section for Embalse sector.
 */
import { useState } from 'react';
import { WeatherIcon } from '../../icons/WeatherIcons';
import type { IconId } from '../../icons/WeatherIcons';

export function ThermalCastreloSection() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h2 className="text-3xl font-extrabold text-white tracking-tight">El térmico de Castrelo de Miño</h2>
        <p className="text-slate-400 text-sm leading-relaxed">
          Todo lo que necesitas saber sobre el viento térmico del embalse:
          qué es, cuándo sopla, y cómo la app te ayuda a decidir si hoy es buen día.
        </p>
      </div>

      {/* ── 1. ¿Qué es? ── */}
      <div className="space-y-3">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <WeatherIcon id="wind" size={18} className="text-emerald-400" />
          ¿Qué es el viento térmico?
        </h3>
        <div className="bg-slate-900/50 rounded-xl p-5 border border-slate-800 space-y-3">
          <p className="text-xs text-slate-400 leading-relaxed">
            El viento térmico es una <strong className="text-slate-300">brisa local</strong> que se genera
            cuando el sol calienta las laderas más rápido que el valle. El aire caliente sube por la montaña,
            y el aire fresco del embalse se desplaza para reemplazarlo.
          </p>
          <p className="text-xs text-slate-400 leading-relaxed">
            En Castrelo de Miño, este efecto produce un <strong className="text-emerald-400">viento
            del W/SW</strong> por las tardes de verano, con rachas de 6-15 kt que permiten navegar a vela
            o hacer windsurf/kite en el embalse.
          </p>
          <p className="text-xs text-slate-400 leading-relaxed">
            No es viento "meteorológico" (frentes, borrascas) — es un fenómeno local, predecible y repetible
            cuando se dan las condiciones adecuadas.
          </p>
        </div>
      </div>

      {/* ── 2. ¿Cuándo sopla? ── */}
      <div className="space-y-3">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <WeatherIcon id="clock" size={18} className="text-amber-400" />
          ¿Cuándo sopla?
        </h3>
        <ThermalTimeline />
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800">
            <div className="text-sm font-bold text-amber-400">Julio y Agosto</div>
            <p className="text-[10px] text-slate-500 mt-1">
              Jul: 29% de días con térmico limpio. Ago: 37%.
              Mayo-junio y septiembre son posibles pero menos frecuentes.
            </p>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800">
            <div className="text-sm font-bold text-emerald-400">14:00 – 18:00</div>
            <p className="text-[10px] text-slate-500 mt-1">
              Pico de viento entre las 14 y 18h. En junio-julio
              puede extenderse hasta las 20-21h con la luz extra.
            </p>
          </div>
        </div>
        <MonthlyChart />
      </div>

      {/* ── 3. Checklist del día perfecto ── */}
      <div className="space-y-3">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <WeatherIcon id="check-circle" size={18} className="text-emerald-400" />
          Checklist del día perfecto
        </h3>
        <p className="text-[10px] text-slate-500">
          Basado en 1.412 registros AEMET (2022-2025). 119 días térmicos confirmados.
        </p>
        <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800 space-y-2">
          {([
            { check: 'Tmax 28-32°C', detail: 'Mejor viento: 31°C → 54% prob. térmico', iconId: 'thermometer' as IconId },
            { check: 'Humedad 40-60%', detail: '38-43% ideal. >60% cae a 18%, >80% = 0%', iconId: 'droplets' as IconId },
            { check: 'ΔT diurno > 16°C', detail: 'Gran amplitud = sol intenso = convección', iconId: 'flame' as IconId },
            { check: 'Cielo despejado (>10h sol)', detail: '35% térmico vs 0% con <4h sol', iconId: 'sun' as IconId },
            { check: 'Sin lluvia 24h previas', detail: 'Suelo seco = más convección', iconId: 'cloud-rain' as IconId },
            { check: 'Julio o Agosto', detail: 'Jul 29% + Ago 37% de días con térmico limpio', iconId: 'sun' as IconId },
          ]).map((item) => (
            <div key={item.check} className="flex items-center gap-3 p-2 rounded-lg bg-slate-800/30">
              <span className="text-base"><WeatherIcon id={item.iconId} size={16} /></span>
              <div className="flex-1">
                <span className="text-xs font-semibold text-slate-300">{item.check}</span>
                <span className="text-[10px] text-slate-500 ml-2">— {item.detail}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 4. ¿Cómo lo detecta la app? ── */}
      <div className="space-y-3">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <WeatherIcon id="gauge" size={18} className="text-blue-400" />
          ¿Cómo lo detecta MeteoMapGal?
        </h3>
        <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800 space-y-3 text-xs text-slate-400 leading-relaxed">
          <p>
            MeteoMapGal cruza datos de <strong className="text-slate-300">todas las estaciones cercanas
            al embalse</strong> con datos atmosféricos (Open-Meteo) para estimar la probabilidad de térmico:
          </p>
          <div className="space-y-2">
            <DetectionRow
              icon="wind"
              title="Consenso de viento"
              desc="Varias estaciones coinciden en dirección W/SW → señal fuerte. Si solo una marca viento, es menos fiable."
              color="#22c55e"
            />
            <DetectionRow
              icon="thermometer"
              title="Amplitud térmica (ΔT)"
              desc="Diferencia entre Tmax y Tmin del día. ΔT > 16°C indica sol fuerte y convección favorable."
              color="#f59e0b"
            />
            <DetectionRow
              icon="sun"
              title="Radiación solar"
              desc="Estaciones con sensor solar confirman cielo despejado. Caída brusca = nube o tormenta."
              color="#eab308"
            />
            <DetectionRow
              icon="droplets"
              title="Humedad"
              desc="40-60% ideal. Si sube de 80% el térmico se apaga. Se cruza con temperatura."
              color="#3b82f6"
            />
            <DetectionRow
              icon="thermal-wind"
              title="Amplificación térmica"
              desc="Cuando el térmico es probable, la app aplica un factor de amplificación (+20-50%) sobre el consenso de viento."
              color="#ef4444"
            />
          </div>
          <p className="text-[10px] text-slate-500 mt-2 border-t border-slate-700/50 pt-2">
            El resultado es un <strong className="text-slate-400">score 0-100</strong> que alimenta
            el veredicto del spot (GO / MARGINAL / NO-GO) y las alertas por Telegram.
          </p>
        </div>
      </div>

      {/* ── 5. Escala de viento ── */}
      <div className="space-y-3">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <WeatherIcon id="sailboat" size={18} className="text-cyan-400" />
          Escala de viento para el embalse
        </h3>
        <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
          <div className="space-y-1.5">
            <WindRow range="< 6 kt" label="CALMA" desc="Sin viento. No se navega." color="#64748b" />
            <WindRow range="6-7 kt" label="FLOJO" desc="Posible con tabla grande. Principiantes con paciencia." color="#93c5fd" />
            <WindRow range="8-11 kt" label="NAVEGABLE" desc="Buen viento para aprender. Rumbos básicos cómodos." color="#22c55e" />
            <WindRow range="12-17 kt" label="BUENO" desc="Condiciones ideales. Planeo con tabla media. Disfrute total." color="#a3e635" />
            <WindRow range="18+ kt" label="FUERTE" desc="Solo expertos. Rachas potentes. Equipo reducido." color="#f59e0b" />
          </div>
        </div>
      </div>

      {/* ── Nota beta ── */}
      <div className="bg-amber-900/10 rounded-lg p-3 border border-amber-700/20">
        <p className="text-[10px] text-amber-400/70">
          <WeatherIcon id="alert-triangle" size={12} className="inline mr-1" />
          <strong>Funcionalidad en Beta</strong> — La detección térmica está calibrada con datos reales AEMET (2022-2025)
          pero puede tener imprecisiones. Úsala como orientación, no como fuente definitiva. Consulta siempre las condiciones reales antes de navegar.
        </p>
      </div>
    </div>
  );
}

/* ─── Sub-components ─── */

function ThermalTimeline() {
  const [phase, setPhase] = useState(2); // default: peak
  const phases = [
    { label: 'Mañana', hours: '8-12h', icon: 'sun' as IconId, desc: 'Calma o brisa suave del E/NE (terral). El embalse se calienta.', color: '#f59e0b' },
    { label: 'Arranque', hours: '12-14h', icon: 'wind' as IconId, desc: 'El térmico empieza. Rotación gradual a W/SW. Primeras rachas.', color: '#22c55e' },
    { label: 'Pico', hours: '14-18h', icon: 'sailboat' as IconId, desc: 'Viento máximo: 8-15 kt del W/SW. Mejor momento para navegar.', color: '#3b82f6' },
    { label: 'Caída', hours: '18-21h', icon: 'sunset' as IconId, desc: 'El viento baja gradualmente. Últimos ratos navegables.', color: '#8b5cf6' },
    { label: 'Noche', hours: '21-8h', icon: 'moon' as IconId, desc: 'Brisa catabática (drenaje nocturno) del N/NE. Sin navegación.', color: '#64748b' },
  ];
  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {phases.map((p, i) => (
          <button
            key={p.label}
            onClick={() => setPhase(i)}
            className={`flex-1 py-2 px-1 rounded-lg text-center transition-all ${
              phase === i
                ? 'bg-slate-800 border border-slate-600'
                : 'bg-slate-900/30 border border-slate-800/50 hover:bg-slate-800/50'
            }`}
          >
            <WeatherIcon id={p.icon} size={16} className={phase === i ? 'text-white' : 'text-slate-600'} />
            <div className={`text-[9px] font-bold mt-1 ${phase === i ? 'text-white' : 'text-slate-600'}`}>{p.label}</div>
            <div className="text-[8px] text-slate-500">{p.hours}</div>
          </button>
        ))}
      </div>
      <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800" style={{ borderColor: `${phases[phase].color}30` }}>
        <p className="text-xs text-slate-400 leading-relaxed">{phases[phase].desc}</p>
      </div>
    </div>
  );
}

function MonthlyChart() {
  const months = [
    { m: 'May', pct: 8 }, { m: 'Jun', pct: 18 }, { m: 'Jul', pct: 29 },
    { m: 'Ago', pct: 37 }, { m: 'Sep', pct: 12 }, { m: 'Oct', pct: 3 },
  ];
  const max = 37;
  return (
    <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
      <div className="text-[10px] text-slate-500 mb-2 font-bold">Probabilidad de térmico por mes</div>
      <div className="flex items-end gap-2 h-20">
        {months.map((m) => (
          <div key={m.m} className="flex-1 flex flex-col items-center gap-1">
            <span className="text-[9px] text-slate-400 font-bold">{m.pct}%</span>
            <div
              className="w-full rounded-t bg-gradient-to-t from-emerald-600/50 to-emerald-400/80"
              style={{ height: `${(m.pct / max) * 100}%`, minHeight: '4px' }}
            />
            <span className="text-[8px] text-slate-600">{m.m}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetectionRow({ icon, title, desc, color }: { icon: IconId; title: string; desc: string; color: string }) {
  return (
    <div className="flex items-start gap-2 p-2 rounded-lg bg-slate-800/20">
      <span className="shrink-0 mt-0.5" style={{ color }}><WeatherIcon id={icon} size={14} /></span>
      <div>
        <span className="text-[11px] font-bold" style={{ color }}>{title}</span>
        <p className="text-[10px] text-slate-500 mt-0.5">{desc}</p>
      </div>
    </div>
  );
}

function WindRow({ range, label, desc, color }: { range: string; label: string; desc: string; color: string }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="w-3 h-3 rounded-full shrink-0" style={{ background: color }} />
      <span className="text-xs font-mono font-bold text-slate-300 w-16">{range}</span>
      <span className="text-[10px] font-bold w-20" style={{ color }}>{label}</span>
      <span className="text-[10px] text-slate-500 flex-1">{desc}</span>
    </div>
  );
}
