import { useState } from 'react';

/*
 * Positions reflect real geography (top = North):
 *   Castrelo (embalse): center-south (-8.10, 42.20)
 *   Ourense:            NE of embalse (-7.86, 42.34)
 *   O Carballiño:       N of embalse  (-8.08, 42.43)
 *   Montaña Norte:      further N     (~-8.1, 42.5)
 *   Valle Sur (Miño):   S of embalse  (~-8.1, 42.10)
 */
const ZONES = [
  {
    id: 'embalse',
    name: 'Embalse',
    altitude: '110m',
    color: '#3b82f6',
    position: { x: 220, y: 195 },
    description:
      'Centro de actividad. Aquí navegamos. Viento dominante: W (74% tardes de verano). Térmico de 7-12 kt. Drenaje N nocturno (37%).',
    keyStats: ['W dominante 74%', 'Térmico pico 15:48h', 'Drenaje N 37%'],
    windDir: 270,
  },
  {
    id: 'ourense',
    name: 'Ourense',
    altitude: '140m',
    color: '#f59e0b',
    position: { x: 370, y: 140 },
    description:
      'Ciudad de referencia al NE. Si Ourense también muestra W cuando el embalse tiene W/SW, el sistema térmico es regional y estable. Correlación real del 63% (AEMET 2022-2025). Tmax de referencia.',
    keyStats: ['W correlación 63%', 'Confirmación regional', 'Tmax referencia'],
    windDir: 270,
  },
  {
    id: 'montana',
    name: 'Montaña Norte',
    altitude: '630m',
    color: '#22c55e',
    position: { x: 190, y: 45 },
    description:
      'Zona de montaña al norte. Hipótesis: si detecta E por la mañana, podría indicar térmico vespertino. ⚠ Estaciones lejanas al embalse — dato sin confirmar con instrumentación local. Basado en modelo Open-Meteo, no en estaciones AEMET reales.',
    keyStats: ['E mañana → térmico?', 'Hipótesis', 'Estaciones lejanas'],
    windDir: 90,
  },
  {
    id: 'valle_sur',
    name: 'Valle Sur',
    altitude: '200m',
    color: '#ec4899',
    position: { x: 210, y: 265 },
    description:
      'Valle al sur del embalse. Recibe el térmico como SW. Útil para detectar la extensión geográfica del flujo convectivo.',
    keyStats: ['SW cuando térmico activo', 'Extensión flujo', 'Precursor SE mañana'],
    windDir: 225,
  },
  {
    id: 'carballino',
    name: 'O Carballiño',
    altitude: '450m',
    color: '#a78bfa',
    position: { x: 230, y: 95 },
    description:
      'Estación interior al norte del embalse. No es la montaña de referencia para Castrelo. Su principal valor: drenaje N nocturno muy consistente (48% noches de verano), que enfría el valle y genera el ΔT para el térmico del día siguiente.',
    keyStats: ['Drenaje N 48%', 'Contexto nocturno', 'Lejos del embalse'],
    windDir: 315,
  },
];

export function ZonesMapSection() {
  const [selectedZone, setSelectedZone] = useState(0);
  const zone = ZONES[selectedZone];

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Las 5 zonas térmicas</h2>
      <p className="text-slate-400 text-sm leading-relaxed">
        MeteoMapGal divide el área en 5 microzonas con condiciones térmicas distintas.
        Cada zona tiene estaciones asignadas que alimentan el análisis automático.
      </p>
      <div className="bg-slate-800/30 rounded-lg p-2.5 border border-slate-700/40">
        <p className="text-[10px] text-slate-500">
          <span className="text-emerald-400">●</span> Embalse y Ourense: datos reales AEMET (1.412 registros 2022-2025).{' '}
          <span className="text-amber-400">●</span> Montaña Norte: modelo Open-Meteo, sin estaciones AEMET reales en la zona.{' '}
          <span className="text-purple-400">●</span> Carballiño: dato AEMET real pero estación lejana del embalse.
        </p>
      </div>

      {/* Interactive zone map */}
      <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
        <svg viewBox="0 0 480 300" className="w-full">
          {/* Terrain background */}
          <defs>
            <radialGradient id="zoneGlow">
              <stop offset="0%" stopColor={zone.color} stopOpacity="0.15" />
              <stop offset="100%" stopColor={zone.color} stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Base terrain — elevated north (mountains), lower south (valley) */}
          <path
            d="M 0,280 Q 40,240 80,200 Q 140,100 200,50 Q 260,70 320,110 Q 370,80 420,90 Q 460,130 480,180 L 480,300 L 0,300 Z"
            fill="#1e293b"
            opacity="0.5"
          />

          {/* Compass rose (top-right) */}
          <g>
            <text x="440" y="30" textAnchor="middle" className="text-[10px] fill-slate-400 font-bold">N</text>
            <line x1="440" y1="34" x2="440" y2="50" stroke="#64748b" strokeWidth="1.5" />
            <polygon points="440,30 436,40 444,40" fill="#64748b" />
          </g>

          {/* River / reservoir — runs W-E through center-south */}
          <path
            d="M 140,210 Q 190,195 240,200 Q 290,208 340,195"
            fill="none"
            stroke="#3b82f6"
            strokeWidth="5"
            strokeLinecap="round"
            opacity="0.25"
          />

          {/* Active zone glow */}
          <circle cx={zone.position.x} cy={zone.position.y} r="60" fill="url(#zoneGlow)">
            <animate attributeName="r" values="50;65;50" dur="3s" repeatCount="indefinite" />
          </circle>

          {/* Zone dots */}
          {ZONES.map((z, i) => (
            <g
              key={z.id}
              onClick={() => setSelectedZone(i)}
              className="cursor-pointer"
            >
              {/* Pulse ring for active */}
              {i === selectedZone && (
                <circle cx={z.position.x} cy={z.position.y} r="18" fill="none" stroke={z.color} strokeWidth="1.5" opacity="0.4">
                  <animate attributeName="r" values="14;22;14" dur="2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.5;0;0.5" dur="2s" repeatCount="indefinite" />
                </circle>
              )}
              {/* Main dot */}
              <circle
                cx={z.position.x}
                cy={z.position.y}
                r={i === selectedZone ? 10 : 7}
                fill={z.color}
                opacity={i === selectedZone ? 1 : 0.5}
                className="transition-all duration-300"
              />
              {/* Wind direction arrow */}
              <g
                transform={`rotate(${(z.windDir + 180) % 360} ${z.position.x} ${z.position.y})`}
                opacity={i === selectedZone ? 0.8 : 0.3}
              >
                <line
                  x1={z.position.x}
                  y1={z.position.y + 16}
                  x2={z.position.x}
                  y2={z.position.y - 20}
                  stroke={z.color}
                  strokeWidth="1.5"
                />
                <polygon
                  points={`${z.position.x},${z.position.y - 23} ${z.position.x - 4},${z.position.y - 15} ${z.position.x + 4},${z.position.y - 15}`}
                  fill={z.color}
                />
              </g>
              {/* Label */}
              <text
                x={z.position.x}
                y={z.position.y + 25}
                textAnchor="middle"
                className="text-[9px] font-semibold"
                fill={i === selectedZone ? z.color : '#64748b'}
              >
                {z.name}
              </text>
              <text
                x={z.position.x}
                y={z.position.y + 35}
                textAnchor="middle"
                className="text-[7px]"
                fill="#475569"
              >
                {z.altitude}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {/* Zone detail card */}
      <div
        className="rounded-xl p-5 border transition-all"
        style={{ background: `${zone.color}08`, borderColor: `${zone.color}20` }}
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-base font-bold" style={{ color: zone.color }}>{zone.name}</h3>
            <span className="text-[10px] text-slate-600 font-mono">{zone.altitude}</span>
          </div>
          <div className="flex gap-1">
            {zone.keyStats.map((stat, i) => (
              <span
                key={i}
                className="text-[9px] px-2 py-0.5 rounded-full border"
                style={{
                  color: zone.color,
                  borderColor: `${zone.color}30`,
                  background: `${zone.color}10`,
                }}
              >
                {stat}
              </span>
            ))}
          </div>
        </div>
        <p className="text-sm text-slate-400 leading-relaxed">{zone.description}</p>
      </div>
    </div>
  );
}
