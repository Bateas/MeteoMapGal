/**
 * Guide section: Panel Alertas — explains the tabbed alert drawer with 4 context tabs.
 */
export function CampoPanelSection() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Panel de Alertas</h2>
      <p className="text-slate-400 text-sm leading-relaxed">
        El panel de alertas (tecla <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-mono">C</kbd>)
        es un cajón lateral derecho con 4 pestañas temáticas. Cada pestaña filtra las alertas
        según el contexto de uso: navegación, agricultura, drones o vista completa.
      </p>

      {/* Tab overview */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">Pestañas</h3>
        <p className="text-[10px] text-slate-400">
          Pulsa las teclas <kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-mono">1</kbd> –{' '}
          <kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-mono">4</kbd>{' '}
          con el panel abierto para cambiar de pestaña.
        </p>
        <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800 space-y-2">
          <TabRow
            num="1"
            icon="⛵"
            name="Navegación"
            modules="Propagación viento + Niebla/Rocío"
            desc="Para navegantes: viento entrante y visibilidad."
          />
          <TabRow
            num="2"
            icon="🌾"
            name="Campo"
            modules="Helada + Lluvia/Granizo + Niebla"
            desc="Para agricultura: riesgos de cultivo y campo."
          />
          <TabRow
            num="3"
            icon="🛩️"
            name="Dron"
            modules="Vuelo Dron + Propagación viento + Lluvia"
            desc="Para pilotos de dron: aptitud y restricciones."
          />
          <TabRow
            num="4"
            icon="📊"
            name="Meteo"
            modules="Todos los módulos"
            desc="Vista completa de todas las alertas meteorológicas."
          />
        </div>
      </div>

      {/* Alert modules */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-white">Módulos de alerta</h3>

        <AlertModule
          icon="❄️"
          title="Helada"
          color="#3b82f6"
          items={[
            { label: 'Temp mínima', desc: 'Temperatura mínima prevista en las próximas 48h' },
            { label: 'Ventana riesgo', desc: 'Horario con mayor probabilidad de helada (madrugada)' },
            { label: 'Nubes', desc: 'Cobertura nubosa — cielos despejados = más riesgo de helada' },
            { label: 'Viento', desc: 'Viento bajo + cielo despejado = helada radiativa más probable' },
          ]}
          levels={[
            { level: 'Riesgo', condition: 'Tmin < 3°C' },
            { level: 'Alto', condition: 'Tmin < 0°C' },
            { level: 'Crítico', condition: 'Tmin < -3°C' },
          ]}
        />

        <AlertModule
          icon="🌧️"
          title="Lluvia / Granizo"
          color="#60a5fa"
          items={[
            { label: 'Precip máx/h', desc: 'Máxima precipitación horaria prevista' },
            { label: 'Probabilidad', desc: 'Probabilidad de precipitación en las próximas horas' },
            { label: 'Acum. 6h', desc: 'Acumulación total prevista en 6 horas' },
            { label: 'Granizo', desc: 'CAPE alto + precipitación fuerte = riesgo de granizo' },
          ]}
          levels={[
            { level: 'Riesgo', condition: '> 2 mm/h' },
            { level: 'Alto', condition: '> 10 mm/h' },
            { level: 'Crítico', condition: '> 30 mm/h o granizo' },
          ]}
        />

        <AlertModule
          icon="🌫️"
          title="Niebla / Rocío"
          color="#06b6d4"
          items={[
            { label: 'Punto de rocío', desc: 'Temperatura a la que se condensa la humedad' },
            { label: 'Spread (T - Td)', desc: 'Diferencia entre temperatura actual y punto de rocío. < 2°C = niebla inminente' },
            { label: 'Tendencia', desc: 'Evolución del spread por hora. Negativo = convergiendo hacia niebla' },
            { label: 'ETA niebla', desc: 'Hora estimada de formación de niebla si la tendencia continúa' },
            { label: 'Confianza', desc: 'Barra de fiabilidad de la predicción (basada en consistencia de datos)' },
          ]}
          levels={[
            { level: 'Riesgo', condition: 'Spread < 4°C' },
            { level: 'Alto', condition: 'Spread < 2°C' },
            { level: 'Crítico', condition: 'Spread < 1°C, niebla formándose' },
          ]}
        />

        <AlertModule
          icon="💨"
          title="Propagación Viento"
          color="#f59e0b"
          items={[
            { label: 'Estaciones a barlovento', desc: 'Estaciones aguas arriba del viento detectadas' },
            { label: 'Incremento medio', desc: 'Aumento de velocidad promedio (kt/10min)' },
            { label: 'Velocidad frente', desc: 'Velocidad estimada de avance del frente de viento' },
            { label: 'ETA llegada', desc: 'Hora estimada de llegada al embalse' },
          ]}
          levels={[
            { level: 'Riesgo', condition: 'Viento incrementando en estaciones próximas' },
            { level: 'Alto', condition: 'Frente de viento detectado acercándose' },
            { level: 'Crítico', condition: 'Rachas fuertes inminentes' },
          ]}
        />

        <AlertModule
          icon="🚁"
          title="Vuelo Dron"
          color="#a855f7"
          items={[
            { label: 'Estado', desc: 'Badge Apto / No apto con razón principal' },
            { label: 'Viento', desc: 'Velocidad y rachas actuales. > 10 m/s = no apto' },
            { label: 'Precipitación', desc: 'Lluvia activa o prevista = no apto' },
            { label: 'Visibilidad', desc: 'Niebla o nubes bajas = restricción' },
          ]}
          levels={[
            { level: 'Apto', condition: 'Viento < 7 m/s, sin lluvia, buena visibilidad' },
            { level: 'Precaución', condition: 'Viento 7-10 m/s o condiciones cambiantes' },
            { level: 'No apto', condition: 'Viento > 10 m/s, lluvia o visibilidad reducida' },
          ]}
        />
      </div>

      {/* 48h timeline */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">Timeline 48h</h3>
        <p className="text-[10px] text-slate-400 leading-relaxed">
          En la parte inferior de todas las pestañas, un mapa de calor de 3 filas muestra la evolución
          de riesgos en intervalos de 3 horas para las próximas 48h:
        </p>
        <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800 space-y-1.5">
          <TimelineRow icon="❄️" label="Helada" />
          <TimelineRow icon="🌧️" label="Lluvia" />
          <TimelineRow icon="⚡" label="Tormenta" />
        </div>
        <p className="text-[9px] text-slate-500 italic">
          Colores: gris = sin riesgo, azul = riesgo, naranja = alto, rojo = crítico.
        </p>
      </div>
    </div>
  );
}

/* ─── Sub-components ─────────────────────────── */

function TabRow({
  num,
  icon,
  name,
  modules,
  desc,
}: {
  num: string;
  icon: string;
  name: string;
  modules: string;
  desc: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <kbd className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-[9px] font-mono font-bold bg-slate-800 border border-slate-700 text-slate-300">
        {num}
      </kbd>
      <div className="flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs">{icon}</span>
          <span className="text-[10px] font-bold text-slate-200">{name}</span>
          <span className="text-[9px] text-slate-500 ml-auto">{modules}</span>
        </div>
        <p className="text-[9px] text-slate-500 mt-0.5">{desc}</p>
      </div>
    </div>
  );
}

function AlertModule({
  icon,
  title,
  color,
  items,
  levels,
}: {
  icon: string;
  title: string;
  color: string;
  items: { label: string; desc: string }[];
  levels: { level: string; condition: string }[];
}) {
  return (
    <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: `${color}25`, background: `${color}06` }}>
      <div className="flex items-center gap-2">
        <span className="text-base">{icon}</span>
        <span className="text-xs font-bold" style={{ color }}>{title}</span>
      </div>
      <div className="space-y-1">
        {items.map((item) => (
          <div key={item.label} className="flex gap-2 text-[10px]">
            <span className="text-slate-300 font-semibold shrink-0 w-28">{item.label}</span>
            <span className="text-slate-500">{item.desc}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-700/30 pt-1.5 mt-1.5">
        <span className="text-[8px] text-slate-600 uppercase tracking-wider">Niveles de alerta</span>
        <div className="flex gap-3 mt-1">
          {levels.map((l) => (
            <div key={l.level} className="text-[9px]">
              <span className="font-bold" style={{ color }}>{l.level}: </span>
              <span className="text-slate-500">{l.condition}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TimelineRow({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] w-4">{icon}</span>
      <span className="text-[9px] text-slate-400 w-14">{label}</span>
      <div className="flex-1 flex gap-px">
        {Array.from({ length: 16 }, (_, i) => (
          <div
            key={i}
            className="flex-1 h-3 rounded-sm"
            style={{
              background: i < 3 ? '#1e293b' : i < 5 ? '#1e3a5f' : i < 7 ? '#1e293b' : '#1e293b',
            }}
          />
        ))}
      </div>
    </div>
  );
}
