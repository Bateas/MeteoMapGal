/**
 * Guide section: Panel Alertas — explains the tabbed alert drawer with 4 context tabs.
 */
import { WeatherIcon } from '../../icons/WeatherIcons';
import type { IconId } from '../../icons/WeatherIcons';

export function CampoPanelSection() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Panel de Condiciones</h2>
      <p className="text-slate-400 text-sm leading-relaxed">
        El panel de condiciones (tecla <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[11px] font-mono">C</kbd>)
        es un cajón lateral derecho con pestañas temáticas: condiciones de navegación,
        alertas de campo (agricultura), drones y datos meteo. Incluye alertas clasificadas por severidad.
      </p>

      {/* Tab overview */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">Pestañas</h3>
        <p className="text-[11px] text-slate-400">
          Pulsa las teclas <kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-[11px] font-mono">1</kbd> –{' '}
          <kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-[11px] font-mono">3</kbd>{' '}
          con el panel abierto para cambiar de pestaña.
        </p>
        <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800 space-y-2">
          <TabRow
            num="1"
            iconId="activity"
            name="Condiciones"
            modules="Mareas (Rías) &middot; Perfil atm. (Embalse) &middot; Alertas &middot; Niebla &middot; Timeline 48h"
            desc="Navegación, alertas activas, mareas IHM, perfil atmosférico, propagación de viento."
          />
          <TabRow
            num="2"
            iconId="leaf"
            name="Campo"
            modules="Helada + Lluvia + Niebla + ET₀ + Fitosanitario + GDD + Lunar"
            desc="Agricultura y viticultura: riesgos de cultivo, riego, enfermedades, fenología (GDD) y calendario lunar."
          />
          <TabRow
            num="3"
            iconId="drone"
            name="Dron"
            modules="Vuelo Dron + Espacio aéreo + Viento + Lluvia + Niebla"
            desc="Para pilotos de dron: aptitud meteorológica y restricciones ENAIRE."
          />
        </div>
      </div>

      {/* Alert modules */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-white">Módulos de alerta</h3>

        <AlertModule
          iconId="snowflake"
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
          iconId="cloud-rain"
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
          iconId="fog"
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
          iconId="wind"
          title="Propagación Viento"
          color="#f59e0b"
          items={[
            { label: 'Estaciones a barlovento', desc: 'Estaciones aguas arriba del viento detectadas' },
            { label: 'Incremento medio', desc: 'Aumento de velocidad promedio (kt/10min)' },
            { label: 'Velocidad frente', desc: 'Velocidad estimada de avance del frente de viento' },
            { label: 'ETA llegada', desc: 'Badge ámbar en la barra superior con tiempo estimado de llegada' },
          ]}
          levels={[
            { level: 'Riesgo', condition: 'Viento incrementando en estaciones próximas' },
            { level: 'Alto', condition: 'Frente de viento detectado acercándose' },
          ]}
        />

        <AlertModule
          iconId="zap"
          title="Tormenta Cercana"
          color="#ef4444"
          items={[
            { label: 'Radiación solar', desc: 'Caída brusca de W/m² indica paso de nube densa o tormenta' },
            { label: 'Rayos cercanos', desc: 'Actividad eléctrica detectada en radio de 50km' },
            { label: 'Anomalía viento', desc: 'Rachas súbitas o cambios bruscos de dirección coordinados entre estaciones' },
            { label: 'Cross-reference', desc: 'La alerta se activa solo cuando coinciden 2+ de los 3 indicadores' },
          ]}
          levels={[
            { level: 'Vigilancia', condition: '1 indicador activo' },
            { level: 'Alerta', condition: '2 indicadores cruzados' },
            { level: 'Crítico', condition: '3 indicadores + rayos < 15km' },
          ]}
        />

        <AlertModule
          iconId="drone"
          title="Vuelo Dron"
          color="#a855f7"
          items={[
            { label: 'Estado', desc: 'Badge Apto / Precaución con razón principal' },
            { label: 'Viento', desc: 'Velocidad y rachas actuales. > 15 kt = precaución' },
            { label: 'Precipitación', desc: 'Lluvia activa o prevista = precaución' },
            { label: 'Espacio aéreo', desc: 'Zonas UAS + NOTAMs de ENAIRE. Restricciones automáticas.' },
          ]}
          levels={[
            { level: 'Apto', condition: 'Viento < 15 kt, sin lluvia, sin restricciones' },
            { level: 'Precaución', condition: 'Viento > 15 kt, lluvia, o zona con autorización requerida' },
          ]}
        />

        <AlertModule
          iconId="thermometer"
          title="ET₀ Evapotranspiración"
          color="#10b981"
          items={[
            { label: 'ET₀ diaria', desc: 'Estimación de pérdida de agua del suelo (mm/día) por Hargreaves-Samani' },
            { label: 'Correcciones', desc: 'Ajustada por viento (>2 m/s sube ET₀) y humedad (>60% la baja)' },
            { label: 'Consejo riego', desc: 'Recomendación automática basada en la demanda hídrica calculada' },
          ]}
          levels={[
            { level: 'Riesgo', condition: 'ET₀ > 2 mm/día' },
            { level: 'Alto', condition: 'ET₀ > 4 mm/día' },
            { level: 'Crítico', condition: 'ET₀ > 6 mm/día' },
          ]}
        />

        <AlertModule
          iconId="leaf"
          title="Riesgo Fitosanitario"
          color="#84cc16"
          items={[
            { label: 'Mildiu', desc: 'T > 10°C + HR > 90% + lluvia = condiciones favorables (viñedo Ribeiro)' },
            { label: 'Oídio', desc: 'T 15-25°C + HR > 70% sin lluvia = condiciones favorables' },
            { label: 'Horas favorables', desc: 'Conteo de horas con condiciones propicias en las próximas 24h' },
          ]}
          levels={[
            { level: 'Riesgo', condition: '2-3h favorables' },
            { level: 'Alto', condition: '4-5h favorables' },
            { level: 'Crítico', condition: '6+h favorables' },
          ]}
        />

        <AlertModule
          iconId="sprout"
          title="Grados-Día (GDD)"
          color="#22c55e"
          items={[
            { label: 'GDD acumulados', desc: 'Suma de grados-día desde 1 de marzo (base 10°C, Vitis vinifera)' },
            { label: 'GDD hoy', desc: 'Contribución del día actual calculada desde previsión Tmax/Tmin' },
            { label: 'Fase fenológica', desc: 'Etapa de crecimiento actual: Latencia → Desborre → Floración → Envero → Vendimia' },
            { label: 'Barra progreso', desc: 'Avance dentro de la fase actual (0-100%)' },
            { label: 'Próximo hito', desc: 'Siguiente fase fenológica y °C·d restantes para alcanzarla' },
            { label: 'Consejo cultivo', desc: 'Recomendaciones vitícolas según la fase de crecimiento actual' },
          ]}
          levels={[
            { level: 'Normal', condition: 'Fases vegetativas sin evento crítico' },
            { level: 'Riesgo', condition: 'Envero o vendimia — fases sensibles' },
            { level: 'Alto', condition: 'Floración — fase crítica para cuajado' },
          ]}
        />

        <AlertModule
          iconId="moon"
          title="Fase Lunar"
          color="#7c5dfa"
          items={[
            { label: 'Fase actual', desc: 'Nombre y emoji de la fase lunar actual (8 fases en español)' },
            { label: 'Iluminación', desc: 'Porcentaje de iluminación lunar (0-100%)' },
            { label: 'Próxima fase', desc: 'Próxima fase significativa (nueva/llena/cuarto) con días restantes' },
            { label: 'Siembra', desc: 'Consejo de siembra según la fase: creciente = aéreos, menguante = raíz' },
            { label: 'Poda', desc: 'Momento óptimo de poda: cuarto menguante = mejor cicatrización' },
            { label: 'Tratamientos', desc: 'Aplicaciones foliares/suelo recomendadas según fase lunar' },
          ]}
          levels={[
            { level: 'Creciente', condition: 'Savia sube → siembra aérea, injertos' },
            { level: 'Menguante', condition: 'Savia baja → poda, cosecha, tratamientos' },
          ]}
        />

        <AlertModule
          iconId="drone"
          title="Espacio Aéreo ENAIRE"
          color="#6366f1"
          items={[
            { label: 'Zonas UAS (ZGUAS)', desc: 'Zonas de restricción UAS: prohibidas o con autorización requerida' },
            { label: 'NOTAMs', desc: 'Avisos temporales de restricciones de vuelo (filtro ≤120m AGL)' },
            { label: 'Interacción', desc: 'Clic en zona/NOTAM en el drawer → zoom al centroide en el mapa' },
          ]}
          levels={[
            { level: 'Sin restricción', condition: 'Ninguna zona UAS ni NOTAM activo' },
            { level: 'Precaución', condition: 'Zona con autorización requerida o NOTAM informativo' },
            { level: 'Prohibido', condition: 'Zona prohibida o NOTAM de restricción activa' },
          ]}
        />

        <AlertModule
          iconId="anchor"
          title="Mareas (solo Rías Baixas)"
          color="#0ea5e9"
          items={[
            { label: 'Próxima marea', desc: 'Indicador de la siguiente pleamar/bajamar con cuenta atrás' },
            { label: 'Estado actual', desc: 'Subiendo o bajando + barra de progreso visual' },
            { label: 'Curva SVG', desc: 'Gráfico de mareas con interpolación coseno. Línea roja = hora actual' },
            { label: 'Tabla 48h', desc: 'Hoy + mañana con horas y alturas (metros sobre datum de carta)' },
            { label: 'Selector puerto', desc: 'Vigo, Marín, Vilagarcía, Baiona, Sanxenxo (datos IHM)' },
          ]}
          levels={[
            { level: 'Pleamar', condition: 'Nivel máximo alcanzado' },
            { level: 'Bajamar', condition: 'Nivel mínimo alcanzado' },
          ]}
        />

        <AlertModule
          iconId="thermometer"
          title="Perfil Atmosférico (solo Embalse)"
          color="#8b5cf6"
          items={[
            { label: 'Estabilidad', desc: 'Evaluación combinada: Convección / Excelente / Buena / Marginal / Estable' },
            { label: 'BLH (PBL)', desc: 'Altura de la capa límite: > 1500m = térmicos potentes' },
            { label: 'CAPE', desc: 'Energía convectiva disponible (J/kg). > 500 = convección activa' },
            { label: 'CIN', desc: 'Inhibición convectiva. < 50 J/kg = barrera mínima' },
            { label: 'LI', desc: 'Lifted Index. Negativo = inestable, bueno para térmicos' },
            { label: 'Perfil vertical', desc: 'SVG con barra BLH, cap CIN y coloreado CAPE' },
          ]}
          levels={[
            { level: 'Excelente', condition: 'BLH > 1500m, CAPE > 200, CIN < 50' },
            { level: 'Buena', condition: 'BLH > 1000m, CIN < 100' },
            { level: 'Marginal', condition: 'BLH > 500m o CAPE > 100' },
            { level: 'Estable', condition: 'BLH bajo, CIN alta, sin convección' },
          ]}
        />
      </div>

      {/* 48h timeline */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">Timeline 48h</h3>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          En la parte inferior de todas las pestañas, un mapa de calor de 3 filas muestra la evolución
          de riesgos en intervalos de 3 horas para las próximas 48h:
        </p>
        <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800 space-y-1.5">
          <TimelineRow iconId="snowflake" label="Helada" />
          <TimelineRow iconId="cloud-rain" label="Lluvia" />
          <TimelineRow iconId="zap" label="Tormenta" />
        </div>
        <p className="text-[11px] text-slate-500 italic">
          Colores: gris = sin riesgo, azul = riesgo, naranja = alto, rojo = crítico.
        </p>
      </div>
    </div>
  );
}

/* ─── Sub-components ─────────────────────────── */

function TabRow({
  num,
  iconId,
  name,
  modules,
  desc,
}: {
  num: string;
  iconId: IconId;
  name: string;
  modules: string;
  desc: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <kbd className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-[11px] font-mono font-bold bg-slate-800 border border-slate-700 text-slate-300">
        {num}
      </kbd>
      <div className="flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs"><WeatherIcon id={iconId} size={14} /></span>
          <span className="text-[11px] font-bold text-slate-200">{name}</span>
          <span className="text-[11px] text-slate-500 ml-auto">{modules}</span>
        </div>
        <p className="text-[11px] text-slate-500 mt-0.5">{desc}</p>
      </div>
    </div>
  );
}

function AlertModule({
  iconId,
  title,
  color,
  items,
  levels,
}: {
  iconId: IconId;
  title: string;
  color: string;
  items: { label: string; desc: string }[];
  levels: { level: string; condition: string }[];
}) {
  return (
    <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: `${color}20`, background: `${color}08` }}>
      <div className="flex items-center gap-2">
        <span className="text-base" style={{ color }}><WeatherIcon id={iconId} size={18} /></span>
        <span className="text-xs font-bold" style={{ color }}>{title}</span>
      </div>
      <div className="space-y-1">
        {items.map((item) => (
          <div key={item.label} className="flex gap-2 text-[11px]">
            <span className="text-slate-300 font-semibold shrink-0 w-28">{item.label}</span>
            <span className="text-slate-500">{item.desc}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-700/30 pt-1.5 mt-1.5">
        <span className="text-[11px] text-slate-600 uppercase tracking-wider">Niveles de alerta</span>
        <div className="flex gap-3 mt-1">
          {levels.map((l) => (
            <div key={l.level} className="text-[11px]">
              <span className="font-bold" style={{ color }}>{l.level}: </span>
              <span className="text-slate-500">{l.condition}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TimelineRow({ iconId, label }: { iconId: IconId; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] w-4"><WeatherIcon id={iconId} size={12} /></span>
      <span className="text-[11px] text-slate-400 w-14">{label}</span>
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
