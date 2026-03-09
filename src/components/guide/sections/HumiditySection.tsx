import { WeatherIcon } from '../../icons/WeatherIcons';

export function HumiditySection() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Humedad e indicadores clave</h2>
      <p className="text-slate-400 text-sm leading-relaxed">
        La humedad relativa (HR) es uno de los factores que más influye en la convección,
        la visibilidad y el confort térmico. Comprender su impacto es clave para interpretar
        las condiciones meteorológicas.
      </p>

      {/* Humidity gauge visualization */}
      <div className="bg-slate-900/50 rounded-xl p-6 border border-slate-800">
        <HumidityGauge />
      </div>

      {/* Key thresholds */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">Umbrales de humedad</h3>
        <div className="grid grid-cols-1 gap-2">
          {[
            { range: '< 45%', impact: 'Convección posible', color: '#f59e0b', label: 'Seco — térmicos posibles pero aire inestable', icon: '⬆' },
            { range: '45-65%', impact: 'Óptimo', color: '#22c55e', label: 'SWEET SPOT — máxima probabilidad de convección', icon: '✓' },
            { range: '65-75%', impact: 'Reducido', color: '#3b82f6', label: 'Húmedo — térmicos debilitados', icon: '⬇' },
            { range: '75-85%', impact: 'Muy bajo', color: '#f97316', label: 'Muy húmedo — térmicos casi imposibles', icon: '⬇' },
            { range: '> 85%', impact: 'Nulo', color: '#ef4444', label: 'Saturado — SIN térmicos, niebla probable', icon: '✕' },
          ].map((t) => (
            <div
              key={t.range}
              className="flex items-center gap-3 p-3 rounded-lg border"
              style={{ background: `${t.color}08`, borderColor: `${t.color}20` }}
            >
              <div className="w-20 shrink-0">
                <span className="text-xs font-mono font-bold" style={{ color: t.color }}>{t.range}</span>
              </div>
              <div className="flex-1">
                <span className="text-[10px] text-slate-500">{t.label}</span>
              </div>
              <span className="text-xs font-semibold shrink-0" style={{ color: t.color }}>{t.impact}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Temperature section */}
      <div className="space-y-3 mt-8">
        <h3 className="text-sm font-bold text-white">Temperatura y gradiente térmico</h3>
        <p className="text-slate-400 text-xs leading-relaxed">
          El rango diurno de temperatura (ΔT = Tmax − Tmin) es el indicador más potente
          para predecir la fuerza del térmico. A mayor ΔT, mayor convección.
        </p>

        <div className="bg-slate-900/50 rounded-xl p-5 border border-slate-800">
          <TemperatureScale />
        </div>

        <div className="bg-slate-800/30 rounded-lg p-3 border border-slate-700/50">
          <p className="text-[10px] text-slate-400 leading-relaxed">
            <WeatherIcon id="info" size={12} className="inline-block mr-1 text-blue-400" />
            Los valores óptimos de Tmax y ΔT varían según la geografía local: la profundidad
            del valle, la orientación de las laderas y la presencia de masas de agua influyen
            significativamente. MeteoMapGal incluye datos calibrados para cada sector.
          </p>
        </div>
      </div>

      {/* Wind speed */}
      <div className="space-y-3 mt-8">
        <h3 className="text-sm font-bold text-white">Firma del viento térmico</h3>
        <p className="text-slate-400 text-xs leading-relaxed">
          En teoría, el térmico tiene una «firma» reconocible: empieza en calma, sube
          a 7-12 kt, y se apaga al atardecer.
        </p>

        <div className="bg-slate-900/50 rounded-xl p-5 border border-slate-800">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[9px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/25 font-semibold">
              TEORÍA GENERAL
            </span>
            <span className="text-[9px] text-slate-600">Perfil idealizado de viento térmico</span>
          </div>
          <WindRampDiagram />
          <div className="mt-3 p-2.5 rounded-lg bg-slate-800/30 border border-slate-700/30">
            <p className="text-[10px] text-slate-500">
              En la práctica, el perfil real del viento varía según la geografía: en valles
              estrechos el térmico puede llegar de forma abrupta, mientras que en zonas costeras
              la transición suele ser más gradual.
            </p>
          </div>
        </div>
      </div>

      {/* Breadcrumb to Castrelo section */}
      <div className="bg-gradient-to-r from-emerald-900/15 to-slate-900/30 rounded-lg p-3 border border-emerald-800/20">
        <p className="text-[10px] text-slate-400">
          <WeatherIcon id="chart" size={12} className="inline-block mr-1 text-emerald-400" />
          <strong className="text-emerald-400/80">Datos calibrados:</strong> Los umbrales exactos
          y probabilidades basadas en registros AEMET para el sector Embalse de Castrelo están
          en la sección «Mejores condiciones».
        </p>
      </div>
    </div>
  );
}

/* ─── Humidity gauge SVG ─────────────────────────────────── */
function HumidityGauge() {
  return (
    <svg viewBox="0 0 500 100" className="w-full">
      <defs>
        <linearGradient id="humGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#f59e0b" />
          <stop offset="35%" stopColor="#22c55e" />
          <stop offset="55%" stopColor="#22c55e" />
          <stop offset="70%" stopColor="#3b82f6" />
          <stop offset="85%" stopColor="#f97316" />
          <stop offset="100%" stopColor="#ef4444" />
        </linearGradient>
      </defs>

      {/* Main gradient bar */}
      <rect x="40" y="30" width="420" height="24" rx="12" fill="url(#humGrad)" opacity="0.8" />

      {/* Sweet spot highlight */}
      <rect x="229" y="26" width="84" height="32" rx="4" fill="none" stroke="#22c55e" strokeWidth="2" strokeDasharray="4,2">
        <animate attributeName="stroke-dashoffset" values="0;-18" dur="2s" repeatCount="indefinite" />
      </rect>

      {/* Percentage labels */}
      {[0, 20, 45, 65, 75, 85, 100].map((pct) => {
        const x = 40 + (420 * pct) / 100;
        return (
          <g key={pct}>
            <line x1={x} y1={58} x2={x} y2={68} stroke="#475569" strokeWidth="1" />
            <text x={x} y={82} textAnchor="middle" className="text-[9px] fill-slate-500 font-mono">{pct}%</text>
          </g>
        );
      })}

      {/* Top labels */}
      <text x="160" y="20" textAnchor="middle" className="text-[8px] fill-amber-500">Seco</text>
      <text x="270" y="16" textAnchor="middle" className="text-[10px] fill-emerald-400 font-bold">
        Sweet Spot
      </text>
      <text x="370" y="20" textAnchor="middle" className="text-[8px] fill-blue-400">Húmedo</text>
      <text x="440" y="20" textAnchor="middle" className="text-[8px] fill-red-400">Saturado</text>

      {/* Qualitative impact labels at bottom */}
      <text x="140" y="96" textAnchor="middle" className="text-[8px] fill-slate-600">Alta convección</text>
      <text x="270" y="96" textAnchor="middle" className="text-[9px] fill-emerald-500 font-semibold">Óptima</text>
      <text x="370" y="96" textAnchor="middle" className="text-[8px] fill-slate-600">Reducida</text>
      <text x="440" y="96" textAnchor="middle" className="text-[8px] fill-red-500/60">Nula</text>
    </svg>
  );
}

/* ─── Temperature scale ──────────────────────────────── */
function TemperatureScale() {
  return (
    <svg viewBox="0 0 500 90" className="w-full">
      <defs>
        <linearGradient id="tempGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="40%" stopColor="#f59e0b" />
          <stop offset="70%" stopColor="#ef4444" />
          <stop offset="100%" stopColor="#dc2626" />
        </linearGradient>
      </defs>

      <rect x="40" y="25" width="420" height="16" rx="8" fill="url(#tempGrad)" opacity="0.7" />

      {/* Temperature labels */}
      {[18, 22, 26, 28, 31, 34, 36, 40].map((temp) => {
        const pct = ((temp - 18) / 22) * 100;
        const x = 40 + (420 * Math.min(pct, 100)) / 100;
        return (
          <g key={temp}>
            <line x1={x} y1={44} x2={x} y2={52} stroke="#475569" strokeWidth="1" />
            <text x={x} y={64} textAnchor="middle" className="text-[8px] fill-slate-500 font-mono">{temp}°C</text>
          </g>
        );
      })}

      {/* Key markers — generic zone */}
      <g>
        <line x1={40} y1={22} x2={40} y2={45} stroke="#6366f1" strokeWidth="2" />
        <text x={40} y={14} textAnchor="middle" className="text-[8px] fill-indigo-400 font-bold">Umbral</text>
      </g>

      {/* Favorable zone bracket (28-34°C) */}
      <rect x={231} y={18} width={114} height={30} rx="4" fill="none" stroke="#22c55e" strokeWidth="1.5" strokeDasharray="3,2" opacity="0.6" />
      <text x={288} y={14} textAnchor="middle" className="text-[9px] fill-emerald-400 font-bold">Zona favorable</text>

      <text x="250" y="82" textAnchor="middle" className="text-[8px] fill-slate-600">Tmax diaria</text>
    </svg>
  );
}

/* ─── Wind ramp diagram ──────────────────────────────── */
function WindRampDiagram() {
  const points = [
    { h: 8, kt: 0 }, { h: 10, kt: 1 }, { h: 12, kt: 3 },
    { h: 13, kt: 5 }, { h: 14, kt: 8 }, { h: 15, kt: 10 },
    { h: 15.8, kt: 12 }, { h: 16, kt: 11 }, { h: 17, kt: 10 },
    { h: 18, kt: 7 }, { h: 19, kt: 4 }, { h: 20, kt: 2 }, { h: 21, kt: 0 },
  ];

  const xScale = (h: number) => 40 + ((h - 8) / 13) * 420;
  const yScale = (kt: number) => 100 - (kt / 14) * 80;

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.h)} ${yScale(p.kt)}`)
    .join(' ');

  const areaD = pathD + ` L ${xScale(21)} ${yScale(0)} L ${xScale(8)} ${yScale(0)} Z`;

  return (
    <svg viewBox="0 0 500 130" className="w-full">
      {/* Grid */}
      {[0, 4, 8, 12].map((kt) => (
        <g key={kt}>
          <line x1={40} y1={yScale(kt)} x2={460} y2={yScale(kt)} stroke="#1e293b" strokeWidth="1" />
          <text x={30} y={yScale(kt) + 3} textAnchor="end" className="text-[8px] fill-slate-600 font-mono">{kt}</text>
        </g>
      ))}

      {/* Fill area */}
      <path d={areaD} fill="#22c55e" opacity="0.08" />

      {/* Line */}
      <path d={pathD} fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

      {/* Animated dot at peak */}
      <circle cx={xScale(15.8)} cy={yScale(12)} r="4" fill="#22c55e">
        <animate attributeName="r" values="3;5;3" dur="2s" repeatCount="indefinite" />
      </circle>
      <text x={xScale(15.8)} y={yScale(12) - 10} textAnchor="middle" className="text-[9px] fill-emerald-400 font-bold">12 kt pico</text>

      {/* Hour labels */}
      {[8, 10, 12, 14, 16, 18, 20].map((h) => (
        <text key={h} x={xScale(h)} y={118} textAnchor="middle" className="text-[8px] fill-slate-600 font-mono">{h}h</text>
      ))}

      {/* Axis labels */}
      <text x={10} y={60} className="text-[7px] fill-slate-600" transform="rotate(-90, 10, 60)">nudos</text>

      {/* Ramp annotation */}
      <path d={`M ${xScale(10)} ${yScale(1)} Q ${xScale(12)} ${yScale(5)} ${xScale(14)} ${yScale(8)}`} fill="none" stroke="#f59e0b" strokeWidth="1" strokeDasharray="3,2" opacity="0.5" />
      <text x={xScale(11.5)} y={yScale(5)} className="text-[7px] fill-amber-500/70" transform="rotate(-35, ${xScale(11.5)}, ${yScale(5)})">rampa</text>
    </svg>
  );
}
