import { useState } from 'react';

const CYCLE_PHASES = [
  {
    id: 'morning',
    label: 'Mañana (8-12h)',
    icon: '🌅',
    color: '#f59e0b',
    wind: 'NE / Calma',
    speed: '0-3 kt',
    description:
      'El sol comienza a calentar las laderas orientales. Vientos débiles del NE o calma. Es la fase precursora: si detectamos NE en el embalse o E en montaña, es señal de que el térmico vendrá por la tarde.',
    indicator: 'NE embalse → 38% probabilidad de W por la tarde',
    indicatorAlt: 'E en montaña → 76% probabilidad (¡el mejor predictor!)',
    svgPhase: 'morning' as const,
  },
  {
    id: 'buildup',
    label: 'Desarrollo (12-14h)',
    icon: '☀️',
    color: '#eab308',
    wind: 'Rotación SW',
    speed: '3-6 kt',
    description:
      'La temperatura alcanza 28-31°C. El gradiente térmico se activa: el aire del valle empieza a fluir hacia las laderas. El viento rota del NE al SW, ganando intensidad gradualmente.',
    indicator: 'Rotación NE → SW = confirmación del térmico',
    indicatorAlt: 'ΔT (Tmax-Tmin) > 20°C → 42% probabilidad',
    svgPhase: 'buildup' as const,
  },
  {
    id: 'peak',
    label: 'Pico (14-18h)',
    icon: '💨',
    color: '#22c55e',
    wind: 'W dominante',
    speed: '7-12 kt',
    description:
      'Máxima intensidad del térmico. Viento del W estable a 7-12 nudos en el embalse. Rachas posibles de hasta 15-18 kt. Condiciones óptimas para navegar. El viento se propaga: Ribadavia SW → Ourense W → Carballiño NW.',
    indicator: 'W 74% frecuencia en embalse (datos de 4 años)',
    indicatorAlt: 'Racha máxima media: 9.7 m/s (19 kt) a las 15:48h',
    svgPhase: 'peak' as const,
  },
  {
    id: 'evening',
    label: 'Atardecer (18-21h)',
    icon: '🌇',
    color: '#f97316',
    wind: 'SW débil → calma',
    speed: '3-5 kt',
    description:
      'El sol baja, la convección se debilita. En junio/julio, con días más largos, el térmico puede extenderse hasta las 20-21h. El viento rota gradualmente al SW y pierde fuerza.',
    indicator: 'Jun/Jul: extensión hasta 21h por luz solar',
    indicatorAlt: 'Señal de fin: viento cae bajo 5 kt',
    svgPhase: 'evening' as const,
  },
  {
    id: 'night',
    label: 'Noche (21-8h)',
    icon: '🌙',
    color: '#6366f1',
    wind: 'N drenaje',
    speed: '2-4 kt',
    description:
      'Las laderas se enfrían. El aire denso y frío desciende al valle creando un flujo de drenaje del N. Constante y predecible: 37% frecuencia en embalse, 48% en Carballiño. Enfría el valle para el ciclo siguiente.',
    indicator: 'N drenaje: 3.8 m/s avg, enfría el valle 5-8°C',
    indicatorAlt: 'Carballiño N: 48% frecuencia (muy consistente)',
    svgPhase: 'night' as const,
  },
];

export function ThermalCycleSection() {
  const [activePhase, setActivePhase] = useState(0);
  const phase = CYCLE_PHASES[activePhase];

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">El ciclo diario del viento térmico</h2>
      <p className="text-slate-400 text-sm leading-relaxed">
        Cada día soleado de verano repite un patrón predecible. Entender este ciclo
        te permite anticipar las condiciones horas antes de llegar al embalse.
      </p>

      {/* Animated clock/timeline */}
      <div className="bg-slate-900/50 rounded-xl p-5 border border-slate-800">
        <CycleClock activePhase={activePhase} />
      </div>

      {/* Phase selector */}
      <div className="flex gap-1">
        {CYCLE_PHASES.map((p, i) => (
          <button
            key={p.id}
            onClick={() => setActivePhase(i)}
            className={`flex-1 py-2.5 px-2 rounded text-[10px] font-medium transition-all ${
              i === activePhase
                ? 'text-white shadow-lg'
                : 'text-slate-500 hover:text-slate-300 bg-slate-900/30 hover:bg-slate-800/50'
            }`}
            style={
              i === activePhase
                ? { background: `${p.color}20`, border: `1px solid ${p.color}40`, color: p.color }
                : { border: '1px solid transparent' }
            }
          >
            <span className="block text-base mb-0.5">{p.icon}</span>
            {p.label.split(' ')[0]}
          </button>
        ))}
      </div>

      {/* Phase detail */}
      <div
        className="rounded-xl p-5 border transition-all"
        style={{
          background: `${phase.color}08`,
          borderColor: `${phase.color}25`,
        }}
      >
        <div className="flex items-start gap-4">
          <div className="shrink-0">
            <span className="text-3xl">{phase.icon}</span>
          </div>
          <div className="space-y-3 flex-1">
            <div>
              <h3 className="text-base font-bold" style={{ color: phase.color }}>{phase.label}</h3>
              <div className="flex gap-4 mt-1">
                <span className="text-xs text-slate-500">
                  Dirección: <strong className="text-slate-300">{phase.wind}</strong>
                </span>
                <span className="text-xs text-slate-500">
                  Fuerza: <strong className="text-slate-300">{phase.speed}</strong>
                </span>
              </div>
            </div>
            <p className="text-sm text-slate-400 leading-relaxed">{phase.description}</p>
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: phase.color }} />
                <span className="text-slate-400">{phase.indicator}</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: phase.color }} />
                <span className="text-slate-400">{phase.indicatorAlt}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Animated 24h clock SVG ────────────────────────────────── */
function CycleClock({ activePhase }: { activePhase: number }) {
  const phaseAngles = [
    { start: -60, end: 0, color: '#f59e0b' },    // morning 8-12
    { start: 0, end: 30, color: '#eab308' },       // buildup 12-14
    { start: 30, end: 90, color: '#22c55e' },       // peak 14-18
    { start: 90, end: 135, color: '#f97316' },      // evening 18-21
    { start: 135, end: 300, color: '#6366f1' },     // night 21-8
  ];

  const cx = 200, cy = 120, r = 90;

  return (
    <svg viewBox="0 0 400 240" className="w-full max-w-md mx-auto">
      {/* Background circle */}
      <circle cx={cx} cy={cy} r={r + 10} fill="none" stroke="#1e293b" strokeWidth="20" />

      {/* Phase arcs */}
      {phaseAngles.map((arc, i) => {
        const startRad = ((arc.start - 90) * Math.PI) / 180;
        const endRad = ((arc.end - 90) * Math.PI) / 180;
        const x1 = cx + r * Math.cos(startRad);
        const y1 = cy + r * Math.sin(startRad);
        const x2 = cx + r * Math.cos(endRad);
        const y2 = cy + r * Math.sin(endRad);
        const largeArc = arc.end - arc.start > 180 ? 1 : 0;

        return (
          <path
            key={i}
            d={`M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`}
            fill="none"
            stroke={arc.color}
            strokeWidth={i === activePhase ? 14 : 8}
            strokeLinecap="round"
            opacity={i === activePhase ? 1 : 0.3}
            className="transition-all duration-300"
          />
        );
      })}

      {/* Hour labels */}
      {[6, 8, 10, 12, 14, 16, 18, 20, 22, 0].map((hour) => {
        const angle = ((hour / 24) * 360 - 90) * (Math.PI / 180);
        const lx = cx + (r + 28) * Math.cos(angle);
        const ly = cy + (r + 28) * Math.sin(angle);
        return (
          <text
            key={hour}
            x={lx}
            y={ly}
            textAnchor="middle"
            dominantBaseline="central"
            className="text-[9px] fill-slate-600 font-mono"
          >
            {hour}h
          </text>
        );
      })}

      {/* Center info */}
      <text x={cx} y={cy - 8} textAnchor="middle" className="text-[11px] fill-slate-300 font-bold">
        {CYCLE_PHASES[activePhase].wind}
      </text>
      <text x={cx} y={cy + 8} textAnchor="middle" className="text-[10px] fill-slate-500">
        {CYCLE_PHASES[activePhase].speed}
      </text>

      {/* Wind direction arrow in center */}
      <WindArrowIndicator phase={activePhase} cx={cx} cy={cy + 30} />
    </svg>
  );
}

function WindArrowIndicator({ phase, cx, cy }: { phase: number; cx: number; cy: number }) {
  // Rotation angles for each phase's dominant wind direction (meteorological "from")
  const rotations = [45, 225, 270, 225, 0]; // NE, SW, W, SW, N
  const rot = rotations[phase];

  return (
    <g transform={`rotate(${(rot + 180) % 360} ${cx} ${cy})`}>
      <line x1={cx} y1={cy + 12} x2={cx} y2={cy - 12} stroke={CYCLE_PHASES[phase].color} strokeWidth="2" strokeLinecap="round" />
      <polygon points={`${cx},${cy - 15} ${cx - 5},${cy - 5} ${cx + 5},${cy - 5}`} fill={CYCLE_PHASES[phase].color} />
    </g>
  );
}
