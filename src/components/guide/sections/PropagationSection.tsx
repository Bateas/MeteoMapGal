/**
 * Propagation / Confirmation section for MeteoGuide.
 *
 * IMPORTANT: The thermal wind at Castrelo comes FROM the W.
 * It does NOT "propagate from the reservoir outward".
 * This section explains how to read multiple stations to CONFIRM
 * that the thermal system is active and stable — not propagation.
 *
 * Data source: AEMET daily history 2022-2025, 1412 records.
 * The 63% Embalse-SW → Ourense-W correlation is from real data.
 */

import { WeatherIcon } from '../../icons/WeatherIcons';

export function PropagationSection() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Confirmación multi-estación</h2>
      <p className="text-slate-400 text-sm leading-relaxed">
        El viento térmico del W llega al embalse por el calentamiento diferencial del valle.
        No se &quot;propaga&quot; desde el embalse hacia fuera — al contrario, el aire viene del oeste.
        Lo que sí podemos hacer es <strong className="text-slate-300">confirmar su estabilidad</strong>{' '}
        observando múltiples estaciones simultáneamente.
      </p>

      <div className="bg-slate-800/40 rounded-lg p-3 border border-slate-700/50">
        <p className="text-[10px] text-slate-400 leading-relaxed">
          <strong className="text-slate-300">Panel &quot;Viento en estaciones&quot;:</strong> En el panel lateral,
          la sección de viento muestra consenso actual (dirección + velocidad + nº estaciones),
          tendencia (subiendo/estable/bajando), dispersión direccional y coherencia entre zonas.
          Los <strong className="text-slate-300">datos pasados</strong> de las estaciones se cruzan para
          estimar la estabilidad del patrón — un consenso sostenido 2+ horas es muy fiable.
        </p>
      </div>

      {/* Confirmation diagram */}
      <div className="bg-slate-900/50 rounded-xl p-5 border border-slate-800">
        <ConfirmationDiagram />
      </div>

      {/* How to read it */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-white">¿Cómo leer las estaciones?</h3>
        <div className="grid grid-cols-1 gap-2">
          {[
            {
              level: 'Señal local',
              color: '#3b82f6',
              condition: 'W/SW en el embalse',
              meaning: 'El térmico está soplando localmente. Puedes navegar.',
              data: 'AEMET: W dominante 74% tardes de verano',
            },
            {
              level: 'Confirmación regional',
              color: '#f59e0b',
              condition: '+ W en Ourense',
              meaning: 'El sistema es regional y estable. Más horas de viento probable.',
              data: 'AEMET: 63% correlación Embalse-SW → Ourense-W',
            },
            {
              level: 'Contexto adicional',
              color: '#a78bfa',
              condition: 'NW en Carballiño',
              meaning: 'El flujo cubre toda la cuenca del Miño. Térmico robusto.',
              data: 'Observado en datos, pero estaciones lejanas al embalse',
            },
          ].map((item) => (
            <div
              key={item.level}
              className="p-3 rounded-lg border"
              style={{ background: `${item.color}08`, borderColor: `${item.color}20` }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ background: item.color }} />
                <span className="text-xs font-bold" style={{ color: item.color }}>{item.level}</span>
                <span className="text-[10px] text-slate-500 ml-auto font-mono">{item.condition}</span>
              </div>
              <p className="text-xs text-slate-400 mb-1">{item.meaning}</p>
              <p className="text-[9px] text-slate-600 italic">
                <span className="text-emerald-500/70">Datos:</span> {item.data}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Key insight */}
      <div className="bg-gradient-to-r from-blue-900/20 to-amber-900/20 rounded-lg p-4 border border-slate-700">
        <h4 className="text-xs font-bold text-slate-300 mb-2">¿Qué significa esto para navegar?</h4>
        <ul className="space-y-1.5 text-xs text-slate-400">
          <li className="flex items-start gap-2">
            <span className="text-blue-400 shrink-0">1.</span>
            <span>
              <strong className="text-slate-300">No esperes a que todas marquen:</strong> Si el embalse
              tiene W/SW de 6+ kt, el térmico ya está. Sal a navegar.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-amber-400 shrink-0">2.</span>
            <span>
              <strong className="text-slate-300">Ourense como seguro:</strong> Si Ourense también muestra W,
              puedes confiar en 2-4 horas de viento estable (dato real: 63% correlación).
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-purple-400 shrink-0">3.</span>
            <span>
              <strong className="text-slate-300">Cuidado con sinópticos:</strong> Un W fuerte en TODAS las
              estaciones por igual puede ser viento sinóptico (frente), no térmico. El térmico local
              es más fuerte en el embalse que en zonas altas.
            </span>
          </li>
        </ul>
      </div>

      {/* Caveat */}
      <div className="bg-slate-800/30 rounded-lg p-3 border border-slate-700/50">
        <p className="text-[10px] text-slate-500 italic">
          <span className="text-amber-400/70 inline-flex items-center gap-0.5"><WeatherIcon id="alert-triangle" size={12} /> Nota:</span> Las correlaciones entre estaciones son
          estadísticas, no causales. El viento en Ourense no &quot;causa&quot; viento en el embalse.
          Ambos responden al mismo calentamiento diferencial regional.
          Estaciones lejanas (Carballiño, Montaña Norte) aportan contexto pero no predicción directa.
        </p>
      </div>
    </div>
  );
}

/* ─── Confirmation diagram ──────────────────────────────── */
function ConfirmationDiagram() {
  /*
   * Positions reflect real geography (top = North):
   *   Embalse:     center-south
   *   Ourense:     NE of embalse
   *   Carballiño:  N of embalse (slightly NW)
   */
  const stations = [
    { name: 'Embalse', dir: 'W/SW', x: 210, y: 165, color: '#3b82f6', size: 12, confirmed: true },
    { name: 'Ourense', dir: 'W', x: 380, y: 105, color: '#f59e0b', size: 9, confirmed: true },
    { name: 'Carballiño', dir: 'NW', x: 200, y: 70, color: '#a78bfa', size: 7, confirmed: false },
  ];

  return (
    <svg viewBox="0 0 500 240" className="w-full">
      {/* Terrain background — elevated north */}
      <path
        d="M 0,220 Q 60,180 120,140 Q 180,80 250,90 Q 320,80 400,100 Q 460,130 500,160 L 500,240 L 0,240 Z"
        fill="#1e293b"
        opacity="0.4"
      />

      {/* Compass indicator */}
      <g>
        <text x="460" y="30" textAnchor="middle" className="text-[9px] fill-slate-500 font-bold">N</text>
        <line x1="460" y1="34" x2="460" y2="46" stroke="#475569" strokeWidth="1" />
        <polygon points="460,30 457,38 463,38" fill="#475569" />
      </g>

      {/* River — runs W to E through center-south */}
      <path
        d="M 120,185 Q 180,170 240,175 Q 300,182 360,170"
        fill="none"
        stroke="#3b82f6"
        strokeWidth="3"
        opacity="0.2"
      />

      {/* Big W arrow showing thermal direction FROM the west */}
      <defs>
        <marker id="confArrow" viewBox="0 0 10 6" refX="10" refY="3" markerWidth="10" markerHeight="8" orient="auto">
          <polygon points="0,0 10,3 0,6" fill="#22c55e" />
        </marker>
      </defs>
      <path
        d="M 30,165 Q 90,155 170,162"
        fill="none"
        stroke="#22c55e"
        strokeWidth="3"
        strokeDasharray="10,5"
        markerEnd="url(#confArrow)"
        opacity="0.5"
      >
        <animate attributeName="stroke-dashoffset" values="0;-45" dur="2s" repeatCount="indefinite" />
      </path>
      <text x="60" y="145" className="text-[10px] fill-emerald-400/70 font-bold">Térmico W →</text>

      {/* Station dots */}
      {stations.map((s) => (
        <g key={s.name}>
          {s.confirmed && (
            <circle cx={s.x} cy={s.y} r={s.size + 8} fill="none" stroke={s.color} strokeWidth="1" opacity="0.3">
              <animate attributeName="r" values={`${s.size + 4};${s.size + 12};${s.size + 4}`} dur="2.5s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.4;0;0.4" dur="2.5s" repeatCount="indefinite" />
            </circle>
          )}
          <circle cx={s.x} cy={s.y} r={s.size} fill={s.color} opacity={s.confirmed ? 0.9 : 0.4} />
          <text x={s.x} y={s.y + 4} textAnchor="middle" className="text-[8px] fill-white font-bold">{s.dir}</text>
          <text x={s.x} y={s.y + s.size + 14} textAnchor="middle" className="text-[9px] font-semibold" fill={s.color}>{s.name}</text>
        </g>
      ))}

      {/* Correlation line Embalse→Ourense (NE direction) */}
      <path
        d="M 225,158 Q 300,125 370,110"
        fill="none"
        stroke="#f59e0b"
        strokeWidth="1"
        strokeDasharray="4,3"
        opacity="0.5"
      />
      <text x="310" y="120" textAnchor="middle" className="text-[8px] fill-amber-500/60">63% correlación</text>

      {/* Legend */}
      <g>
        <circle cx={380} cy={205} r="5" fill="#3b82f6" />
        <text x={390} y={208} className="text-[8px] fill-slate-500">= dato real AEMET</text>
        <circle cx={380} cy={220} r="5" fill="#a78bfa" opacity="0.4" />
        <text x={390} y={223} className="text-[8px] fill-slate-500">= contexto (estación lejana)</text>
      </g>
    </svg>
  );
}
