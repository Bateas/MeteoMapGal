import { WeatherIcon } from '../../icons/WeatherIcons';
import type { IconId } from '../../icons/WeatherIcons';

export function BestConditionsSection() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Mejores condiciones para navegar</h2>
      <p className="text-slate-400 text-sm leading-relaxed">
        Basado en 1.412 registros diarios de AEMET (2022-2025), filtrados para separar
        térmico real de viento frontal. 119 días térmicos confirmados de 478 veranos analizados.
      </p>

      {/* Best conditions checklist */}
      <div className="bg-slate-900/50 rounded-xl p-5 border border-slate-800 space-y-3">
        <h3 className="text-sm font-bold text-emerald-400 flex items-center gap-1.5"><WeatherIcon id="check-circle" size={16} /> Checklist del día perfecto</h3>
        <div className="space-y-2">
          {([
            { check: 'Tmax 28-32°C', detail: 'Mejor viento: vel 2.0 m/s. >36°C = sofocante', iconId: 'thermometer' as IconId },
            { check: 'HR 40-60%', detail: '38-43% térmico. >60% cae a 18%, >80% = 0%', iconId: 'droplets' as IconId },
            { check: 'ΔT > 16°C', detail: 'Validado con sol Ourense: ΔT>16 = sol>10h', iconId: 'flame' as IconId },
            { check: 'E mañana en montaña', detail: '76% predictor de térmico tarde', iconId: 'mountain' as IconId },
            { check: 'Cielo despejado (>10h sol)', detail: '35% térmico vs 0% con <4h sol', iconId: 'sun' as IconId },
            { check: 'PBL > 1500m, LI < -2°C', detail: 'Capa de mezcla profunda + aire inestable', iconId: 'thermal-wind' as IconId },
            { check: 'Sin lluvia 24h previas', detail: 'Suelo seco = más convección', iconId: 'cloud-rain' as IconId },
            { check: 'Julio o Agosto', detail: 'Jul 29% + Ago 37% térmico limpio', iconId: 'sun' as IconId },
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

      {/* Monthly statistics */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-white">Probabilidad por mes</h3>
        <div className="bg-slate-900/50 rounded-xl p-5 border border-slate-800">
          <MonthlyChart />
        </div>
      </div>

      {/* Time window */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-white">Ventana horaria óptima</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-800">
            <div className="text-2xl font-black text-emerald-400">13-21h</div>
            <div className="text-xs text-slate-500 mt-1">Ventana principal</div>
            <div className="text-[10px] text-slate-600">7-12 kt estables del W</div>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-800">
            <div className="text-2xl font-black text-amber-400">15:48h</div>
            <div className="text-xs text-slate-500 mt-1">Hora pico de rachas</div>
            <div className="text-[10px] text-slate-600">Media racha: 9.7 m/s (19 kt)</div>
          </div>
        </div>
      </div>

      {/* What the scoring system looks at */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-white">¿Cómo funciona el scoring de MeteoMap?</h3>
        <p className="text-slate-400 text-xs leading-relaxed">
          MeteoMap calcula una puntuación de 0-100 puntos basada en las condiciones actuales
          y la previsión. Cada factor contribuye con un peso específico derivado del análisis estadístico.
        </p>
        <div className="bg-slate-900/50 rounded-xl border border-slate-800 overflow-hidden">
          <ScoringBreakdown />
        </div>
      </div>

      {/* Wind scale reference — tuned for inland reservoir */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-white">Escala de viento para el embalse</h3>
        <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
          <div className="grid grid-cols-4 gap-2">
            {([
              { range: '0-1 kt', label: 'Calma', color: '#64748b', iconId: 'sleep' as IconId },
              { range: '1-3 kt', label: 'Ventolina', color: '#93c5fd', iconId: 'wind' as IconId },
              { range: '3-6 kt', label: 'Flojito', color: '#22d3ee', iconId: 'waves' as IconId },
              { range: '6-9 kt', label: 'Flojo', color: '#22c55e', iconId: 'sailboat' as IconId },
              { range: '9-13 kt', label: 'Bonancible', color: '#a3e635', iconId: 'sailboat' as IconId },
              { range: '13-17 kt', label: 'Fresquito', color: '#eab308', iconId: 'sailboat' as IconId },
              { range: '17-23 kt', label: 'Fresco', color: '#f97316', iconId: 'zap' as IconId },
              { range: '>23 kt', label: 'Fuerte+', color: '#ef4444', iconId: 'alert-triangle' as IconId },
            ]).map((b) => (
              <div
                key={b.range}
                className="text-center p-2 rounded border"
                style={{ borderColor: `${b.color}20`, background: `${b.color}08` }}
              >
                <div className="text-base" style={{ color: b.color }}><WeatherIcon id={b.iconId} size={18} /></div>
                <div className="text-[10px] font-mono font-bold" style={{ color: b.color }}>{b.range}</div>
                <div className="text-[8px] text-slate-500">{b.label}</div>
              </div>
            ))}
          </div>
          <p className="text-[9px] text-slate-600 text-center mt-3">
            Interior de Galicia: lo habitual es 3-13 kt. Días excepcionales pueden llegar a 20+ kt.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─── Monthly probability chart ──────────────────── */
function MonthlyChart() {
  const months = [
    { name: 'Ene', prob: 2 }, { name: 'Feb', prob: 3 }, { name: 'Mar', prob: 5 },
    { name: 'Abr', prob: 10 }, { name: 'May', prob: 15 }, { name: 'Jun', prob: 22 },
    { name: 'Jul', prob: 42 }, { name: 'Ago', prob: 49 }, { name: 'Sep', prob: 20 },
    { name: 'Oct', prob: 8 }, { name: 'Nov', prob: 3 }, { name: 'Dic', prob: 2 },
  ];

  const maxProb = 55;
  const barWidth = 30;
  const gap = 6;
  const totalWidth = months.length * (barWidth + gap);
  const chartHeight = 120;

  return (
    <svg viewBox={`0 0 ${totalWidth + 40} ${chartHeight + 30}`} className="w-full">
      {/* Grid lines */}
      {[0, 20, 40].map((pct) => {
        const y = chartHeight - (pct / maxProb) * chartHeight + 5;
        return (
          <g key={pct}>
            <line x1={30} y1={y} x2={totalWidth + 30} y2={y} stroke="#1e293b" strokeWidth="1" />
            <text x={25} y={y + 3} textAnchor="end" className="text-[7px] fill-slate-600 font-mono">{pct}%</text>
          </g>
        );
      })}

      {/* Bars */}
      {months.map((m, i) => {
        const x = 30 + i * (barWidth + gap);
        const barH = (m.prob / maxProb) * chartHeight;
        const y = chartHeight - barH + 5;
        const isHigh = m.prob >= 40;
        const isMed = m.prob >= 15 && m.prob < 40;
        const color = isHigh ? '#22c55e' : isMed ? '#f59e0b' : '#475569';

        return (
          <g key={m.name}>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={barH}
              rx={3}
              fill={color}
              opacity={0.7}
            />
            {m.prob > 5 && (
              <text x={x + barWidth / 2} y={y - 4} textAnchor="middle" className="text-[8px] font-bold" fill={color}>
                {m.prob}%
              </text>
            )}
            <text x={x + barWidth / 2} y={chartHeight + 18} textAnchor="middle" className="text-[8px] fill-slate-500">
              {m.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ─── Scoring breakdown ──────────────────────────── */
function ScoringBreakdown() {
  const factors = [
    { name: 'Humedad', points: 20, color: '#06b6d4', desc: '40-60% = 38-43% térmico. >60% cae a 18%' },
    { name: 'Temperatura', points: 20, color: '#ef4444', desc: '28-32°C mejor viento. <28°C = frontal, >36°C = parado' },
    { name: 'Hora del día', points: 15, color: '#f59e0b', desc: '13-21h ventana. Racha media a las 16:06h' },
    { name: 'Mes/estación', points: 15, color: '#22c55e', desc: 'Ago 37% > Jul 29% > Sep 25% (térmico limpio)' },
    { name: 'Dir. viento', points: 10, color: '#3b82f6', desc: 'SW Ribadavia→W Ourense→NW Carballiño' },
    { name: 'Vel. viento', points: 10, color: '#8b5cf6', desc: 'Confirma, no predice. Rampa 0→12kt' },
    { name: 'ΔT (Tmax-Tmin)', points: 10, color: '#f97316', desc: '>16°C = sol>10h → 33%. <14°C = 0% térmico' },
  ];

  return (
    <div className="divide-y divide-slate-800">
      {factors.map((f) => (
        <div key={f.name} className="flex items-center gap-3 px-4 py-2.5">
          <div className="w-24">
            <span className="text-xs font-semibold text-slate-300">{f.name}</span>
          </div>
          <div className="flex-1">
            <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${f.points}%`, background: f.color }}
              />
            </div>
          </div>
          <div className="w-10 text-right">
            <span className="text-xs font-mono font-bold" style={{ color: f.color }}>{f.points}</span>
          </div>
          <div className="w-32">
            <span className="text-[9px] text-slate-500">{f.desc}</span>
          </div>
        </div>
      ))}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-800/30">
        <div className="w-24">
          <span className="text-xs font-bold text-white">TOTAL</span>
        </div>
        <div className="flex-1" />
        <div className="w-10 text-right">
          <span className="text-sm font-mono font-black text-white">100</span>
        </div>
        <div className="w-32">
          <span className="text-[9px] text-slate-400">+ bonus: racha (5) + atmosférico (5)</span>
        </div>
      </div>
    </div>
  );
}
