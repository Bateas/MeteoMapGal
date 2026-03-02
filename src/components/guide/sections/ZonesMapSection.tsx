import { useState } from 'react';

const ZONES = [
  {
    id: 'embalse',
    name: 'Embalse',
    altitude: '110m',
    color: '#3b82f6',
    position: { x: 240, y: 160 },
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
    position: { x: 380, y: 120 },
    description:
      'Ciudad de referencia al este. Confirma la propagación: cuando el W del embalse llega a Ourense como W, el térmico está establecido. 63% correlación.',
    keyStats: ['W por propagación 63%', 'Confirmación térmico', 'Tmax referencia'],
    windDir: 270,
  },
  {
    id: 'montana',
    name: 'Montaña Norte',
    altitude: '630m',
    color: '#22c55e',
    position: { x: 200, y: 50 },
    description:
      'Estación alta. El mejor predictor matutino: si detecta E por la mañana, hay 76% de probabilidad de térmico por la tarde. Sensor clave.',
    keyStats: ['E mañana → 76% térmico', 'Mejor predictor', 'ΔT ladera-valle'],
    windDir: 90,
  },
  {
    id: 'valle_sur',
    name: 'Valle Sur',
    altitude: '200m',
    color: '#ec4899',
    position: { x: 280, y: 240 },
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
    position: { x: 100, y: 100 },
    description:
      'Estación interior al oeste. Punto final de la propagación: NW. Confirma que el flujo cubre toda la cuenca. Drenaje N nocturno muy consistente (48%).',
    keyStats: ['NW por propagación', 'Drenaje N 48%', 'Confirmación total'],
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
        MeteoMap divide el área en 5 microzonas con condiciones térmicas distintas.
        Cada zona tiene estaciones asignadas que alimentan el análisis automático.
      </p>

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

          {/* Base terrain silhouette */}
          <path
            d="M 0,280 Q 50,200 100,180 Q 150,100 200,60 Q 250,80 300,120 Q 350,100 400,90 Q 450,120 480,160 L 480,300 L 0,300 Z"
            fill="#1e293b"
            opacity="0.5"
          />

          {/* River / reservoir */}
          <path
            d="M 180,190 Q 220,175 260,170 Q 300,180 320,190"
            fill="none"
            stroke="#3b82f6"
            strokeWidth="6"
            strokeLinecap="round"
            opacity="0.3"
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
        style={{ background: `${zone.color}08`, borderColor: `${zone.color}25` }}
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
