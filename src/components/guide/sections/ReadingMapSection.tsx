export function ReadingMapSection() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Cómo leer el mapa</h2>
      <p className="text-slate-400 text-sm leading-relaxed">
        MeteoMap muestra muchas capas de información. Aquí te explicamos
        cómo interpretar cada elemento visual del mapa.
      </p>

      {/* Station markers */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-white">Marcadores de estación</h3>
        <div className="grid grid-cols-2 gap-3">
          <ExplainerCard
            title="Estación de viento"
            svg={
              <svg viewBox="0 0 60 60" className="w-12 h-12">
                <circle cx="30" cy="30" r="14" fill="#1e293b" stroke="#22c55e" strokeWidth="2" />
                <line x1="30" y1="30" x2="30" y2="14" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" />
                <polygon points="30,10 26,18 34,18" fill="#22c55e" />
                <text x="30" y="34" textAnchor="middle" className="text-[8px] fill-emerald-400 font-bold">7</text>
              </svg>
            }
            description="Círculo con flecha de dirección. Color = velocidad (escala Beaufort). Número = nudos."
          />
          <ExplainerCard
            title="Solo temperatura"
            svg={
              <svg viewBox="0 0 60 60" className="w-12 h-12">
                <circle cx="30" cy="30" r="6" fill="#f59e0b" opacity="0.6" />
                <text x="30" y="48" textAnchor="middle" className="text-[7px] fill-amber-500">22°C</text>
              </svg>
            }
            description="Punto pequeño. Estaciones sin anemómetro. Contribuyen al gradiente térmico."
          />
        </div>
      </div>

      {/* Color scale */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-white">Colores de velocidad</h3>
        <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
          <svg viewBox="0 0 400 50" className="w-full">
            <defs>
              <linearGradient id="windColorScale" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#64748b" />
                <stop offset="8%" stopColor="#93c5fd" />
                <stop offset="20%" stopColor="#22d3ee" />
                <stop offset="35%" stopColor="#22c55e" />
                <stop offset="50%" stopColor="#a3e635" />
                <stop offset="65%" stopColor="#eab308" />
                <stop offset="80%" stopColor="#f97316" />
                <stop offset="100%" stopColor="#ef4444" />
              </linearGradient>
            </defs>
            <rect x="20" y="5" width="360" height="16" rx="8" fill="url(#windColorScale)" />
            {[
              { x: 20, label: '0' }, { x: 57, label: '1' }, { x: 91, label: '3' },
              { x: 143, label: '6' }, { x: 200, label: '9' }, { x: 254, label: '13' },
              { x: 308, label: '17' }, { x: 380, label: '23+' },
            ].map((t) => (
              <text key={t.label} x={t.x} y={38} textAnchor="middle" className="text-[7px] fill-slate-500 font-mono">{t.label} kt</text>
            ))}
          </svg>
        </div>
      </div>

      {/* Layer overlays */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-white">Capas interactivas (tecla W)</h3>
        <div className="space-y-2">
          <LayerCard
            icon="💨"
            name="Partículas de viento"
            shortcut="W ×1"
            description="Animación de 500 partículas mostrando el flujo del viento interpolado (IDW). Sigue las líneas de flujo para ver la dirección del viento entre estaciones."
            color="#22c55e"
          />
          <LayerCard
            icon="💧"
            name="Heatmap de humedad"
            shortcut="W ×2"
            description="Mapa de calor de humedad interpolada. Verde=seco, azul=medio, púrpura=húmedo, rojo=saturado. Identifica zonas favorables para térmicos."
            color="#3b82f6"
          />
          <LayerCard
            icon="🌧️"
            name="Modelo WRF"
            shortcut="W ×3"
            description="Datos del modelo numérico WRF de MeteoGalicia (4km resolución). Precipitación, nubosidad, viento, humedad, CAPE, visibilidad. Con timeline de 96h."
            color="#8b5cf6"
          />
        </div>
      </div>

      {/* Other overlays */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-white">Otros indicadores</h3>
        <div className="grid grid-cols-2 gap-3">
          <MiniExplainer
            icon="🔴"
            title="Gradiente térmico (T)"
            text="Círculos de temperatura con líneas de gradiente. Muestra la diferencia entre estaciones altas y bajas."
          />
          <MiniExplainer
            icon="⚡"
            title="Rayos"
            text="Puntos de impactos de rayo (últimas 24h). Color por antigüedad. Alertas de proximidad al embalse."
          />
          <MiniExplainer
            icon="🏷️"
            title="Alertas térmicas"
            text="Badges sobre zonas indicando estado del viento térmico. Incluyen propagación detectada."
          />
          <MiniExplainer
            icon="⛵"
            title="Banner Go/No-Go"
            text="Indicador rápido en el mapa: verde (buenas condiciones), ámbar (marginal), rojo (no navegar)."
          />
        </div>
      </div>

      {/* Keyboard shortcuts summary */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-white">Atajos de teclado</h3>
        <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
          <div className="grid grid-cols-3 gap-2">
            {[
              { key: 'C', desc: 'Panel Campo' },
              { key: 'R', desc: 'Refrescar datos' },
              { key: 'T', desc: 'Gradiente temp.' },
              { key: 'A', desc: 'Panel alertas' },
              { key: 'W', desc: 'Ciclar capas' },
              { key: 'B', desc: 'Números grandes' },
              { key: 'G', desc: 'Esta guía' },
              { key: '?', desc: 'Ayuda atajos' },
            ].map((s) => (
              <div key={s.key} className="flex items-center gap-2">
                <kbd className="inline-flex items-center justify-center w-7 h-7 rounded bg-slate-800 border border-slate-700 text-[10px] font-mono font-bold text-slate-300">
                  {s.key}
                </kbd>
                <span className="text-[10px] text-slate-500">{s.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ExplainerCard({
  title,
  svg,
  description,
}: {
  title: string;
  svg: React.ReactNode;
  description: string;
}) {
  return (
    <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-800 flex items-start gap-3">
      <div className="shrink-0">{svg}</div>
      <div>
        <h4 className="text-xs font-bold text-slate-300">{title}</h4>
        <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

function LayerCard({
  icon,
  name,
  shortcut,
  description,
  color,
}: {
  icon: string;
  name: string;
  shortcut: string;
  description: string;
  color: string;
}) {
  return (
    <div
      className="flex items-start gap-3 p-3 rounded-lg border"
      style={{ borderColor: `${color}20`, background: `${color}06` }}
    >
      <span className="text-xl shrink-0">{icon}</span>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold" style={{ color }}>{name}</span>
          <kbd className="text-[8px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 font-mono">{shortcut}</kbd>
        </div>
        <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

function MiniExplainer({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm">{icon}</span>
        <span className="text-[10px] font-bold text-slate-300">{title}</span>
      </div>
      <p className="text-[9px] text-slate-500 leading-relaxed">{text}</p>
    </div>
  );
}
