import { useState, useEffect } from 'react';

const PROPAGATION_STEPS = [
  {
    from: 'Ribadavia',
    fromPos: { x: 240, y: 170 },
    dir: 'SW',
    color: '#3b82f6',
  },
  {
    from: 'Ourense',
    fromPos: { x: 380, y: 130 },
    dir: 'W',
    color: '#f59e0b',
  },
  {
    from: 'O Carballiño',
    fromPos: { x: 110, y: 110 },
    dir: 'NW',
    color: '#a78bfa',
  },
];

export function PropagationSection() {
  const [step, setStep] = useState(0);

  // Auto-advance animation
  useEffect(() => {
    const timer = setInterval(() => {
      setStep((s) => (s + 1) % 4); // 0,1,2,3 (3 = all lit)
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Propagación del viento térmico</h2>
      <p className="text-slate-400 text-sm leading-relaxed">
        El térmico no aparece simultáneamente en toda la cuenca. Se propaga
        desde el embalse hacia el interior, cambiando de dirección según la orografía.
        Reconocer esta cadena permite confirmar la estabilidad del flujo.
      </p>

      {/* Animated propagation map */}
      <div className="bg-slate-900/50 rounded-xl p-5 border border-slate-800">
        <svg viewBox="0 0 500 280" className="w-full">
          {/* Terrain background */}
          <path
            d="M 0,260 Q 60,200 110,180 Q 170,100 200,70 Q 260,90 300,130 Q 360,100 400,90 Q 460,120 500,170 L 500,280 L 0,280 Z"
            fill="#1e293b"
            opacity="0.4"
          />

          {/* River line */}
          <path
            d="M 180,190 Q 240,175 300,180 Q 340,190 380,180"
            fill="none"
            stroke="#3b82f6"
            strokeWidth="3"
            opacity="0.2"
          />

          {/* Propagation arrows between stations */}
          {step >= 1 && (
            <g opacity={step >= 1 ? 0.7 : 0}>
              <path
                d="M 260,165 Q 310,140 360,135"
                fill="none"
                stroke="#f59e0b"
                strokeWidth="2"
                strokeDasharray="6,3"
              >
                <animate attributeName="stroke-dashoffset" values="0;-27" dur="1.5s" repeatCount="indefinite" />
              </path>
              <text x="310" y="130" textAnchor="middle" className="text-[8px] fill-amber-500/70">63% correlación</text>
            </g>
          )}
          {step >= 2 && (
            <g opacity={step >= 2 ? 0.7 : 0}>
              <path
                d="M 225,160 Q 170,130 130,115"
                fill="none"
                stroke="#a78bfa"
                strokeWidth="2"
                strokeDasharray="6,3"
              >
                <animate attributeName="stroke-dashoffset" values="0;-27" dur="1.5s" repeatCount="indefinite" />
              </path>
            </g>
          )}

          {/* Station nodes */}
          {PROPAGATION_STEPS.map((s, i) => {
            const active = step > i || step === 3;
            return (
              <g key={s.from}>
                {active && (
                  <circle cx={s.fromPos.x} cy={s.fromPos.y} r="18" fill="none" stroke={s.color} strokeWidth="1" opacity="0.3">
                    <animate attributeName="r" values="14;22;14" dur="2s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.4;0;0.4" dur="2s" repeatCount="indefinite" />
                  </circle>
                )}
                <circle
                  cx={s.fromPos.x}
                  cy={s.fromPos.y}
                  r="10"
                  fill={active ? s.color : '#334155'}
                  className="transition-all duration-500"
                />
                <text
                  x={s.fromPos.x}
                  y={s.fromPos.y + 4}
                  textAnchor="middle"
                  className="text-[8px] fill-white font-bold"
                >
                  {s.dir}
                </text>
                <text
                  x={s.fromPos.x}
                  y={s.fromPos.y + 26}
                  textAnchor="middle"
                  className="text-[9px] font-semibold"
                  fill={active ? s.color : '#475569'}
                >
                  {s.from}
                </text>
              </g>
            );
          })}

          {/* Step indicator */}
          <g>
            {[0, 1, 2].map((i) => (
              <circle
                key={i}
                cx={220 + i * 30}
                cy={260}
                r="5"
                fill={step > i || step === 3 ? PROPAGATION_STEPS[i].color : '#334155'}
                className="transition-all duration-300"
              />
            ))}
            <text x="310" y="263" className="text-[8px] fill-slate-600">
              {step === 0 ? 'Inicio: SW en embalse' : step === 1 ? '→ W llega a Ourense' : step === 2 ? '→ NW en Carballiño' : '✓ Propagación completa'}
            </text>
          </g>
        </svg>
      </div>

      {/* Propagation chain detail */}
      <div className="flex items-center gap-2">
        {PROPAGATION_STEPS.map((s, i) => (
          <div key={s.from} className="flex items-center gap-2">
            <div
              className="px-3 py-2 rounded-lg border text-center"
              style={{ borderColor: `${s.color}30`, background: `${s.color}08` }}
            >
              <div className="text-xs font-bold" style={{ color: s.color }}>{s.from}</div>
              <div className="text-[10px] text-slate-500 font-mono">{s.dir}</div>
            </div>
            {i < PROPAGATION_STEPS.length - 1 && (
              <span className="text-slate-600 text-lg">→</span>
            )}
          </div>
        ))}
      </div>

      <div className="bg-gradient-to-r from-blue-900/20 to-purple-900/20 rounded-lg p-4 border border-slate-700">
        <h4 className="text-xs font-bold text-slate-300 mb-2">¿Qué significa esto para navegar?</h4>
        <ul className="space-y-1.5 text-xs text-slate-400">
          <li className="flex items-start gap-2">
            <span className="text-blue-400 shrink-0">1.</span>
            Si ves SW en el embalse, el térmico está comenzando localmente.
          </li>
          <li className="flex items-start gap-2">
            <span className="text-amber-400 shrink-0">2.</span>
            Si Ourense también muestra W, el flujo es regional y estable (63% correlación).
          </li>
          <li className="flex items-start gap-2">
            <span className="text-purple-400 shrink-0">3.</span>
            Si Carballiño muestra NW, la propagación es completa: térmico robusto de 2-4 horas.
          </li>
        </ul>
      </div>
    </div>
  );
}
