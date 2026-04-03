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

      {/* Interface overview */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-white">Elementos de la interfaz</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <MiniExplainer
            iconId="layers"
            title="Panel lateral (izquierda)"
            text="Panel fijo con pestañas: Estaciones (lista completa), Gráfica (series temporales), Comparar (spots lado a lado), Previsión (48h), Rankings (top por métrica) e Historial (datos almacenados). Colapsable con el botón ◀."
          />
          <MiniExplainer
            iconId="gauge"
            title="Panel desplegable (derecha)"
            text="Botón 'Panel' en la cabecera. Abre el drawer con 4 tabs: Navegación (veredicto viento), Campo (helada, riego, fitosanitario), Dron (espacio aéreo, NOTAMs), Meteo (alertas activas, presión, teleconexiones)."
          />
          <MiniExplainer
            iconId="wind"
            title="Barra inferior — capas de datos"
            text="Botones en la parte inferior del mapa para activar/desactivar capas: Viento (partículas), Humedad, Radar precipitación, Corrientes. Solo una activa a la vez. Tecla W para ciclar."
          />
          <MiniExplainer
            iconId="map"
            title="Selector de mapa base"
            text="Botón en la esquina del mapa. 6 estilos: OSM, Positron, Dark Matter, Voyager (default), IGN Topográfico, IGN Base Gris. También toggles para overlays náuticos (OpenSeaMap, IHM) e IGN (ortofotos, sombreado, curvas)."
          />
          <MiniExplainer
            iconId="sailboat"
            title="Marcadores de spot"
            text="Hex&aacute;gonos semi-transparentes con arco de viento (gauge) e icono de actividad. Cada spot tiene un badge con el veredicto (CALMA, FLOJO, NAVEG., BUENO, FUERTE) y nudos. Clic abre popup con detalles."
          />
          <MiniExplainer
            iconId="wind"
            title="Ticker de condiciones"
            text="Banner horizontal animado con bot&oacute;n de pausa. Colores por categor&iacute;a: verde (spots con viento), &aacute;mbar (alertas/t&eacute;rmicos), cyan (mareas/olas), azul (previsi&oacute;n)."
          />
        </div>
      </div>

      {/* Station markers */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-white">Marcadores de estaci&oacute;n</h3>
        <p className="text-xs text-slate-400">C&iacute;rculos con la letra de la fuente (A, MG, MC, WU, NT, SX) y anillo de color. El c&iacute;rculo cambia de color seg&uacute;n temperatura. Las boyas son diamantes con &quot;B&quot;.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <ExplainerCard
            title="Estaci&oacute;n de viento"
            svg={
              <svg viewBox="0 0 60 60" className="w-12 h-12">
                {/* Source ring */}
                <circle cx="30" cy="30" r="16" fill="none" stroke="#8b5cf6" strokeWidth="1.5" opacity="0.6" />
                {/* Temperature circle */}
                <circle cx="30" cy="30" r="13" fill="#22c55e" opacity="0.75" />
                {/* Source letter */}
                <text x="30" y="35" textAnchor="middle" className="text-[11px] fill-white font-bold">MG</text>
              </svg>
            }
            description="C&iacute;rculo con letra de fuente (A, MG, MC, WU, NT, SX) + anillo de color de la red. Color = temperatura. Flechas afiladas alrededor = viento."
          />
          <ExplainerCard
            title="Solo temperatura"
            svg={
              <svg viewBox="0 0 60 60" className="w-12 h-12">
                <circle cx="30" cy="30" r="6" fill="#f59e0b" opacity="0.6" />
                <text x="30" y="48" textAnchor="middle" className="text-[11px] fill-amber-500">22°C</text>
              </svg>
            }
            description="Punto pequeño. Estaciones sin anemómetro. Contribuyen al gradiente térmico."
          />
          <ExplainerCard
            title="Boya marina (R&iacute;as)"
            svg={
              <svg viewBox="0 0 60 60" className="w-12 h-12">
                {/* Diamond shape */}
                <polygon points="30,14 44,30 30,46 16,30" fill="#0e7490" stroke="#06b6d4" strokeWidth="2" opacity="0.75" />
                {/* B letter */}
                <text x="30" y="35" textAnchor="middle" className="text-[11px] fill-white font-bold">B</text>
              </svg>
            }
            description="Diamante con &quot;B&quot; central. Color = temperatura del agua. Muestra oleaje encima. Clic para popup con todos los datos. Solo R&iacute;as Baixas."
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
                <stop offset="25%" stopColor="#38bdf8" />
                <stop offset="40%" stopColor="#22c55e" />
                <stop offset="55%" stopColor="#a3e635" />
                <stop offset="70%" stopColor="#eab308" />
                <stop offset="85%" stopColor="#f97316" />
                <stop offset="100%" stopColor="#ef4444" />
              </linearGradient>
            </defs>
            <rect x="20" y="5" width="360" height="16" rx="8" fill="url(#windColorScale)" />
            {[
              { x: 20, label: '0' },
              { x: 110, label: '6' }, { x: 170, label: '9' },
              { x: 230, label: '13' }, { x: 290, label: '17' },
              { x: 380, label: '23+' },
            ].map((t) => (
              <text key={t.label} x={t.x} y={38} textAnchor="middle" className="text-[11px] fill-slate-500 font-mono">{t.label} kt</text>
            ))}
          </svg>
        </div>
      </div>

      {/* Standalone map buttons */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-white">Botones del mapa</h3>
        <p className="text-[11px] text-slate-400 leading-relaxed">
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
        <p className="text-[11px] text-slate-400 leading-relaxed">
          Cinco capas mutuamente excluyentes. Pulsa W para ciclar entre las 4 primeras.
          Corrientes solo aparece en el sector Rías Baixas.
        </p>
        <div className="space-y-2">
          <LayerCard
            iconId="wind"
            name="Partículas de viento"
            shortcut="W ×1"
            description="Animaci&oacute;n de 250 part&iacute;culas mostrando el flujo del viento interpolado (IDW). Brillo pulsante en rachas fuertes (&ge;15kt). Sigue las l&iacute;neas de flujo para ver la direcci&oacute;n."
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
            iconId="radar"
            name="Radar de precipitación"
            shortcut="W ×4"
            description="RainViewer: radar animado (2h de historial). Colores indican intensidad: azul=d&eacute;bil, verde=moderada, amarillo=fuerte, rojo=intensa, magenta=granizo."
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
            text="Marcadores en forma de diamante con &quot;B&quot; central. Color = temperatura del agua. Muestran altura de ola encima. Clic abre popup con oleaje, viento, T agua/aire, presi&oacute;n, corrientes y salinidad. Solo R&iacute;as Baixas."
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
            text="Clic en el hex&aacute;gono del spot para ver popup con veredicto, viento (kt), oleaje, T agua, patr&oacute;n detectado y resumen. Score 0-100 por zona. El arco exterior indica la intensidad del viento. En m&oacute;vil: panel inferior deslizable."
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
          <MiniExplainer
            iconId="thermometer"
            title="SST — Temperatura del mar (Rías)"
            text="Overlay CMEMS/Copernicus Marine con mosaico WMTS de temperatura superficial del mar. Escala azul-rojo (10-22°C). Toggle independiente. Solo Rías Baixas."
          />
          <MiniExplainer
            iconId="map"
            title="Selector de mapa base"
            text="6 estilos de mapa: OSM, Positron (claro), Dark Matter (oscuro), Voyager, IGN Topográfico e IGN Base Gris. Selector en esquina del mapa, sin claves API."
          />
          <MiniExplainer
            iconId="anchor"
            title="Señalización marítima — OpenSeaMap (Rías)"
            text="Overlay con balizas, faros y señales marítimas del catálogo OpenSeaMap. Toggle en selector de mapa. Solo Rías Baixas."
          />
          <MiniExplainer
            iconId="compass"
            title="Carta náutica IHM (Rías)"
            text="Overlay WMS de cartas electrónicas oficiales del Instituto Hidrográfico de la Marina. Toggle en selector de mapa. Solo Rías Baixas."
          />
          <MiniExplainer
            iconId="layers"
            title="Overlays IGN"
            text="Tres capas opcionales del IGN: ortofotos PNOA (vista aérea), sombreado MDT (relieve 3D) y curvas de nivel. Toggle en selector de mapa. Ambos sectores."
          />
          <MiniExplainer
            iconId="thumbs-up"
            title="Validación de alertas"
            text="Botones ✓/✗ en cada alerta del panel expandido. Tu feedback ayuda a mejorar la precisión del sistema de alertas. Las validaciones se almacenan 30 días."
          />
          <MiniExplainer
            iconId="camera"
            title="Webcams en spots"
            text="Algunos spots incluyen imagen o enlace a webcam en vivo directamente en el popup del spot. Permite verificar condiciones reales antes de navegar."
          />
          <MiniExplainer
            iconId="wind"
            title="Ticker de condiciones"
            text="Banner animado en la cabecera con resumen en tiempo real: veredictos de spots, racha máxima, oleaje, rango de temperaturas. Se desplaza automáticamente."
          />
          <MiniExplainer
            iconId="database"
            title="Rankings de estaciones"
            text="Pestaña Rankings: top estaciones por viento, temperatura, humedad y presión en tiempo real. Actualización automática."
          />
          <MiniExplainer
            iconId="wind"
            title="Factor de racha"
            text="Ratio racha/viento sostenido (×N.N) en popup de estaciones. Valores altos (>2.0) indican turbulencia e inestabilidad del flujo."
          />
          <MiniExplainer
            iconId="thermometer"
            title="Índice de calor"
            text="Sensación térmica real cuando T>27°C y HR>40% (fórmula NWS). Se muestra en el popup del spot con código de color: amarillo >27°C, naranja >32°C, rojo >35°C."
          />
          <MiniExplainer
            iconId="map-pin"
            title="Spot favorito ★"
            text="Marca tu spot preferido con ★ en el popup. Se muestra primero en el ticker y en selectores. Persiste entre sesiones (localStorage)."
          />
          <MiniExplainer
            iconId="alert-triangle"
            title="Alertas por Telegram"
            text="MeteoMapGal envía alertas moderadas, altas y críticas a un bot de Telegram en tiempo real. Silencio nocturno 23:00-07:00 (solo pasan críticas)."
          />
          <MiniExplainer
            iconId="gauge"
            title="Estación SkyX"
            text="Estación personal portátil con GPS. Se auto-descubre en el sector correspondiente. Mueves la estación → MeteoMapGal la detecta automáticamente."
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
                <kbd className="inline-flex items-center justify-center w-7 h-7 rounded bg-slate-800 border border-slate-700 text-[11px] font-mono font-bold text-slate-300">
                  {s.key}
                </kbd>
                <span className="text-[11px] text-slate-500">{s.desc}</span>
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
        <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{description}</p>
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
          <kbd className="text-[11px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 font-mono">{shortcut}</kbd>
        </div>
        <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

function MiniExplainer({ iconId, title, text }: { iconId: IconId; title: string; text: string }) {
  return (
    <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm"><WeatherIcon id={iconId} size={14} /></span>
        <span className="text-[11px] font-bold text-slate-300">{title}</span>
      </div>
      <p className="text-[11px] text-slate-500 leading-relaxed">{text}</p>
    </div>
  );
}
