export function BestConditionsSection() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Mejores condiciones para navegar</h2>
      <p className="text-slate-400 text-sm leading-relaxed">
        Basado en 1.412 registros diarios de AEMET (2022-2025), estas son las condiciones
        estadísticas que producen los mejores días de navegación en el embalse.
      </p>

      {/* Best conditions checklist */}
      <div className="bg-slate-900/50 rounded-xl p-5 border border-slate-800 space-y-3">
        <h3 className="text-sm font-bold text-emerald-400">✅ Checklist del día perfecto</h3>
        <div className="space-y-2">
          {[
            { check: 'Tmax > 31°C', detail: '54% probabilidad térmica', icon: '🌡️' },
            { check: 'HR 45-65%', detail: 'Sweet spot de humedad', icon: '💧' },
            { check: 'ΔT > 20°C', detail: 'Fuerte gradiente térmico', icon: '📈' },
            { check: 'E mañana en montaña', detail: '76% predictor de térmico tarde', icon: '🏔️' },
            { check: 'Cielo despejado', detail: 'Radiación solar máxima', icon: '☀️' },
            { check: 'Sin lluvia 24h previas', detail: 'Suelo seco = más convección', icon: '🌂' },
            { check: 'Julio o Agosto', detail: '40-50% días buenos', icon: '📅' },
          ].map((item) => (
            <div key={item.check} className="flex items-center gap-3 p-2 rounded-lg bg-slate-800/30">
              <span className="text-base">{item.icon}</span>
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
            <div className="text-2xl font-black text-emerald-400">13-18h</div>
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

      {/* Beaufort reference */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-white">Escala de viento para navegación</h3>
        <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
          <div className="grid grid-cols-4 gap-2">
            {[
              { range: '0-3 kt', label: 'Calma', color: '#64748b', emoji: '😴' },
              { range: '4-6 kt', label: 'Flojo', color: '#22d3ee', emoji: '🙂' },
              { range: '7-10 kt', label: 'Bonancible', color: '#22c55e', emoji: '⛵' },
              { range: '11-16 kt', label: 'Fresquito', color: '#f59e0b', emoji: '💪' },
              { range: '17-21 kt', label: 'Fresco', color: '#f97316', emoji: '⚡' },
              { range: '22-27 kt', label: 'Fuerte', color: '#ef4444', emoji: '⚠️' },
              { range: '28-33 kt', label: 'Muy fuerte', color: '#dc2626', emoji: '🚫' },
              { range: '>34 kt', label: 'Temporal', color: '#991b1b', emoji: '☠️' },
            ].map((b) => (
              <div
                key={b.range}
                className="text-center p-2 rounded border"
                style={{ borderColor: `${b.color}20`, background: `${b.color}08` }}
              >
                <div className="text-base">{b.emoji}</div>
                <div className="text-[10px] font-mono font-bold" style={{ color: b.color }}>{b.range}</div>
                <div className="text-[8px] text-slate-500">{b.label}</div>
              </div>
            ))}
          </div>
          <p className="text-[9px] text-slate-600 text-center mt-3">
            Para el embalse de Castrelo: ideal 7-16 kt. Los colores del mapa usan esta escala.
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
    { name: 'Temperatura', points: 25, color: '#ef4444', desc: 'Tmax, radiación solar' },
    { name: 'Hora del día', points: 20, color: '#f59e0b', desc: '13-18h máximo' },
    { name: 'Mes/estación', points: 15, color: '#22c55e', desc: 'Jul-Ago mejores' },
    { name: 'Dirección viento', points: 15, color: '#3b82f6', desc: 'W/SW favorable' },
    { name: 'Velocidad viento', points: 15, color: '#8b5cf6', desc: 'Rampa 0→12kt' },
    { name: 'Humedad', points: 10, color: '#06b6d4', desc: '45-65% sweet spot' },
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
          <span className="text-[9px] text-slate-400">+ bonuses (racha, entorno)</span>
        </div>
      </div>
    </div>
  );
}
