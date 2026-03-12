import { WeatherIcon } from '../../icons/WeatherIcons';
import type { IconId } from '../../icons/WeatherIcons';

export function ReadingMapSection() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Cómo leer el mapa</h2>
      <p className="text-slate-400 text-sm leading-relaxed">
        MeteoMapGal muestra muchas capas de información. Aquí te explicamos
        cómo interpretar cada elemento visual del mapa.
      </p>

      {/* Station markers */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-white">Marcadores de estación</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
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
          <ExplainerCard
            title="Boya marina (Rías)"
            svg={
              <svg viewBox="0 0 60 60" className="w-12 h-12">
                <circle cx="30" cy="30" r="14" fill="#0e7490" stroke="#06b6d4" strokeWidth="2" />
                <g transform="translate(30, 28)" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="0" y1="-5" x2="0" y2="5" />
                  <circle cx="0" cy="-6" r="1.5" fill="none" />
                  <path d="M -5,2 Q -5,6 0,6 Q 5,6 5,2" />
                  <line x1="-2" y1="-2" x2="2" y2="-2" />
                </g>
                <circle r="18" cx="30" cy="30" fill="none" stroke="#06b6d4" strokeWidth="1" strokeDasharray="4,3" opacity="0.3" />
              </svg>
            }
            description="Icono de ancla cyan con badges de oleaje, viento (coloreado) y T agua. Clic para popup con todos los datos. Solo Rías Baixas."
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

      {/* Standalone map buttons */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-white">Botones del mapa</h3>
        <p className="text-[10px] text-slate-400 leading-relaxed">
          Además de las capas, el mapa tiene botones independientes que activan
          funciones sin interferir entre sí.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <MiniExplainer
            iconId="thermometer"
            title="Temperatura (T)"
            text="Pulsa T para mostrar/ocultar el gradiente térmico: círculos con la temperatura de cada estación y líneas que conectan estaciones altas y bajas, mostrando la diferencia ΔT."
          />
          <MiniExplainer
            iconId="zap"
            title="Rayos / Tormentas"
            text="Los impactos de rayos (últimas 24h) se muestran automáticamente en el mapa. Rojo=reciente, amarillo=horas, gris=antiguo. Los clusters agrupan zonas de actividad eléctrica."
          />
        </div>
      </div>

      {/* Layer overlays */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-white">Capas interactivas (tecla W)</h3>
        <p className="text-[10px] text-slate-400 leading-relaxed">
          Cinco capas mutuamente excluyentes. Pulsa W para ciclar entre las 4 primeras.
          Corrientes solo aparece en el sector Rías Baixas.
        </p>
        <div className="space-y-2">
          <LayerCard
            iconId="wind"
            name="Partículas de viento"
            shortcut="W ×1"
            description="Animación de 500 partículas mostrando el flujo del viento interpolado (IDW). Sigue las líneas de flujo para ver la dirección del viento entre estaciones."
            color="#22c55e"
          />
          <LayerCard
            iconId="droplets"
            name="Heatmap de humedad"
            shortcut="W ×2"
            description="Mapa de calor de humedad interpolada. Verde=seco, azul=medio, púrpura=húmedo, rojo=saturado. Identifica zonas favorables para térmicos."
            color="#3b82f6"
          />
          <LayerCard
            iconId="satellite"
            name="Satélite infrarrojo"
            shortcut="W ×3"
            description="Imagen EUMETSAT Meteosat (IR 10.8μm) actualizada cada 15 min. Funciona 24h. Brillante = nubes altas/frías (cumulonimbus), oscuro = cielo despejado."
            color="#8b5cf6"
          />
          <LayerCard
            iconId="radar"
            name="Radar de precipitación"
            shortcut="W ×4"
            description="Radar AEMET de Cuntis (Galicia), radio ~240 km. Actualiza cada 10 min. Colores indican intensidad de precipitación: azul=débil, verde=moderada, amarillo=fuerte, rojo=intensa, magenta=granizo."
            color="#06b6d4"
          />
          <LayerCard
            iconId="waves"
            name="Corrientes superficiales"
            shortcut="Solo Rías"
            description="RADAR ON RAIA (INTECMAR): radar HF costero. Flechas muestran dirección y velocidad de corrientes superficiales en toda la costa gallega. Actualización horaria (~2h retardo). Escala: azul=0, verde=0.2, rojo=0.5+ m/s."
            color="#14b8a6"
          />
        </div>
      </div>

      {/* Other overlays */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-white">Otros indicadores del mapa</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <MiniExplainer
            iconId="cloud"
            title="Sombra de tormenta"
            text="Alerta cruzada: caída de radiación solar + rayos cercanos + anomalía de viento = tormenta acercándose."
          />
          <MiniExplainer
            iconId="sun"
            title="Radiación solar"
            text="W/m² en estaciones equipadas (WU, MeteoGalicia). Caída brusca indica paso de nube o tormenta."
          />
          <MiniExplainer
            iconId="tag"
            title="Alertas térmicas"
            text="Badges sobre zonas del embalse indicando estado del viento térmico. Incluyen propagación detectada."
          />
          <MiniExplainer
            iconId="sailboat"
            title="Banner Go/No-Go"
            text="Indicador en el mapa: verde (GO 6-20kt), ámbar (viento flojo o fuerte), rojo (calma o >25kt)."
          />
          <MiniExplainer
            iconId="drone"
            title="Espacio aéreo UAS"
            text="Zonas restringidas ENAIRE (ZGUAS + NOTAMs) visibles al abrir el tab Dron. Clic en zona → flyTo en mapa."
          />
          <MiniExplainer
            iconId="info"
            title="Estado de fuentes"
            text="Badge en la cabecera indicando cuántas fuentes están activas. Ámbar = alguna fuente retrasada."
          />
          <MiniExplainer
            iconId="download"
            title="Exportar CSV"
            text="Botón en menú de estación → exporta lecturas históricas a CSV. Compatible con Excel/LibreOffice."
          />
          <MiniExplainer
            iconId="thermometer"
            title="Presión y punto de rocío"
            text="Datos de 5 fuentes (AEMET, MG, MC, WU, Netatmo). Spread T−Td para predicción de niebla."
          />
          <MiniExplainer
            iconId="anchor"
            title="Boyas marinas (Rías)"
            text="Marcadores cyan con icono de ancla y badges visuales (oleaje, viento coloreado, T agua). Clic abre popup con oleaje (Hm0, Hmax, periodo, dirección), viento (kt + racha), T agua/aire, presión, corrientes y salinidad. Solo Rías Baixas."
          />
          <MiniExplainer
            iconId="anchor"
            title="Mareas (Rías)"
            text="Panel de mareas IHM con curva SVG, tabla 48h y selector de puerto. Solo visible en sector Rías Baixas."
          />
          <MiniExplainer
            iconId="gauge"
            title="Perfil atmosférico (Embalse)"
            text="Evaluación de estabilidad: BLH, CAPE, CIN, LI. Barra vertical SVG con indicadores. Solo sector Embalse."
          />
          <MiniExplainer
            iconId="sailboat"
            title="Spots de navegación"
            text="Clic en el marcador del spot para ver popup con veredicto, viento (kt), oleaje, T agua, patrón detectado y resumen. Score 0-100 por zona. GO≥50, MARGINAL≥25. En móvil: panel inferior deslizante."
          />
          <MiniExplainer
            iconId="wind"
            title="Estadísticas de viento"
            text="Wind stats por estación: velocidad media, racha máx, dirección dominante. Calculadas sobre lecturas acumuladas."
          />
          <MiniExplainer
            iconId="database"
            title="Historial meteorológico"
            text="Pestaña Historial en el sidebar: gráfica temporal con selector de estación por nombre, métrica (T, viento, HR, presión), rango (24h/7d/30d) y estadísticas. Ver sección dedicada en la guía."
          />
          <MiniExplainer
            iconId="alert-triangle"
            title="Banner PELIGRO"
            text="Banner rojo superior cuando hay alertas críticas (≥85 score). Sonido sutil tipo 'wind chime'. Clic abre panel de alertas. Ambos sectores."
          />
          <MiniExplainer
            iconId="gauge"
            title="Tendencia barométrica"
            text="Detección por consenso de bajadas/subidas rápidas de presión en 3h. Alertas automáticas para aproximación de frentes."
          />
          <MiniExplainer
            iconId="map-pin"
            title="Batimetría (Rías)"
            text="Overlay EMODnet con contornos de profundidad. Toggle independiente de capas de viento. Solo Rías Baixas."
          />
        </div>
      </div>

      {/* Keyboard shortcuts summary */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-white">Atajos de teclado</h3>
        <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
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
  iconId,
  name,
  shortcut,
  description,
  color,
}: {
  iconId: IconId;
  name: string;
  shortcut: string;
  description: string;
  color: string;
}) {
  return (
    <div
      className="flex items-start gap-3 p-3 rounded-lg border"
      style={{ borderColor: `${color}20`, background: `${color}08` }}
    >
      <span className="text-xl shrink-0" style={{ color }}><WeatherIcon id={iconId} size={20} /></span>
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

function MiniExplainer({ iconId, title, text }: { iconId: IconId; title: string; text: string }) {
  return (
    <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm"><WeatherIcon id={iconId} size={14} /></span>
        <span className="text-[10px] font-bold text-slate-300">{title}</span>
      </div>
      <p className="text-[9px] text-slate-500 leading-relaxed">{text}</p>
    </div>
  );
}
