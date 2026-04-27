/**
 * Guide section: Roadmap — vertical timeline + data sources.
 * Concise, user-friendly. No architecture details exposed.
 */
import { WeatherIcon } from '../../icons/WeatherIcons';
import type { IconId } from '../../icons/WeatherIcons';
import { useUIStore } from '../../../store/uiStore';

export function RoadmapSection() {
  const alphaMode = useUIStore((s) => s.alphaMode);
  const toggleAlphaMode = useUIStore((s) => s.toggleAlphaMode);
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h2 className="text-3xl font-extrabold text-white tracking-tight">Roadmap</h2>
        <p className="text-slate-400 text-sm leading-relaxed">
          Progreso del proyecto, próximas funcionalidades y fuentes de datos.
        </p>
      </div>

      {/* ── Timeline ─────────────────────────────────────── */}
      <div className="relative pl-8">
        {/* Vertical line */}
        <div className="absolute left-[11px] top-0 bottom-0 w-px bg-slate-700" />

        {/* ── Ultimas novedades ── */}
        <TimelineGroup label="Últimas novedades" dotColor="bg-emerald-500" textColor="text-emerald-400" />
        <TimelineMilestone iconId="sailboat" title="13 spots con veredicto automático" desc="10 de vela + 3 de surf. Scoring basado en 100+ estaciones y 13 boyas marinas." status="done" />
        <TimelineMilestone iconId="waves" title="Previsión de olas 24h" desc="Altura, período, tendencia y veredicto de surf (FLAT/PEQUE/SURF OK/CLÁSICO/GRANDE)." status="done" />
        <TimelineMilestone iconId="camera" title="22 webcams con visión IA" desc="19 cámaras MeteoGalicia + 2 cámaras DGT (Ribadavia, Fea-Arrabaldo) + webcam propia ESP32-CAM en Castrelo. Análisis automático: Beaufort, niebla, visibilidad." status="done" />
        <TimelineMilestone iconId="bell" title="Alertas inteligentes por Telegram" desc="Avisos de cambio de condiciones: viento, niebla, tormentas, olas. Silencio nocturno." status="done" />
        <TimelineMilestone iconId="sailboat" title="Modo Evento para regatas" desc="Zona de agua, panel de seguridad, balizas, mareas, aviación, previsión 6h." status="done" />
        <TimelineMilestone iconId="compass" title="Previsión horaria por spot" desc="Ventana de navegación 48h + mini-timeline 12h directamente en el popup." status="done" />
        <TimelineMilestone iconId="map-pin" title="Compartir, favoritos y comparador" desc="Comparte condiciones por WhatsApp/Telegram. Compara todos los spots en una tabla." status="done" />
        <TimelineMilestone iconId="layers" title="Radar, corrientes y cartas náuticas" desc="Capas de datos: radar precipitación, batimetría, corrientes HF, señalización marítima, carta IHM." status="done" />
        <TimelineMilestone iconId="zap" title="Predictor de tormentas con 8 senales" desc="Cruza CAPE, CIN, lluvia, nubosidad, rayos, avance, sombra solar, rachas y avisos oficiales MeteoGalicia. Probabilidad 0-100% con ETA y accion recomendada." status="done" />
        <TimelineMilestone iconId="zap" title="Clusters inteligentes y etiquetas on-map" desc="Nucleos tormentosos con subdivision automatica, etiquetas (rayos, distancia, velocidad, ETA), flechas de avance, proyeccion 30min. Radar auto sutil cuando hay tormentas." status="done" />
        <TimelineMilestone iconId="bell" title="Avisos oficiales MeteoGalicia" desc="RSS de avisos adversos: tormentas, oleaje, viento, lluvia. Niveles amarillo/naranja/rojo. Integrado en predictor + ticker + panel condiciones." status="done" />

        <TimelineMilestone iconId="thermometer" title="MeteoSIX v5 — WRF 1km por spot" desc="Prevision atmosferica a 1km de resolucion de MeteoGalicia. Cada spot consulta su celda exacta. USWAN para oleaje nearshore, MOHID para temperatura del mar." status="done" />
        <TimelineMilestone iconId="cloud" title="Niebla localizada multi-evidencia" desc="Overlay que se activa por detector (radio 4km). Cruza: webcams con IA de vision, firma solar (HR>85% + radiacion bloqueada), visibilidad oficial AEMET de 8 aeropuertos/estaciones costeras (<1km = niebla confirmada). Fade asimetrico 2s aparicion / 5s disipacion que mimica niebla real." status="done" />
        <TimelineMilestone iconId="compass" title="Panel de prevision Windguru-style" desc="Vista fullscreen (tecla P) con tabla de colores por intensidad, dots de calidad, dimming nocturno, conclusion inteligente y meteograma SVG." status="done" />
        <TimelineMilestone iconId="camera" title="Webcams DGT" desc="Camaras de trafico en Ribadavia y Fea-Arrabaldo para validar niebla en valles interiores." status="done" />
        <TimelineMilestone iconId="wind" title="Predictor de canalizacion en Cesantes" desc="Cesantes tiene una ensenada abrigada donde las estaciones cercanas subestiman el viento real. Modelo que detecta (1) canalizacion sinoptica del SW y (2) brisa termica tarde → estima viento local cuando supera medicion en +4kt." status="done" />
        <TimelineMilestone iconId="cloud" title="Detector de calima/Saharan dust" desc="Overlay que se activa solo cuando Open-Meteo reporta polvo del Sáhara. Tinte marrón-ocre sutil con 3 niveles (leve / moderada / fuerte) según concentración de polvo y opacidad atmosférica (AOD). Fade asimétrico 2s/5s." status="done" />
        <TimelineMilestone iconId="info" title="Aviso cuando el modelo SWAN cae" desc="El servidor académico CESGA falla a menudo. Ahora se muestra una nota clara cuando el overlay no puede cargar — los datos por spot siguen vía Open-Meteo Marine en los popups." status="done" />
        <TimelineMilestone iconId="zap" title="Incendios activos en tiempo real" desc="Detección de focos de incendio vía satélite NASA FIRMS (VIIRS 375m, latencia ≤1h). Cobertura Galicia + Asturias W + Norte Portugal. Puntos rojos pulsantes en el mapa, tamaño según intensidad calorífica (FRP). Aviso en ticker cuando hay focos activos." status="done" />
        <TimelineMilestone iconId="info" title="Calidad del aire oficial Xunta" desc="Datos de la Rede Galega de Calidade do Aire (MeteoGalicia ICA). Cuando alguna estación marca calidad deficiente o peor, el ticker la nombra junto con el contaminante responsable (O3, PM10, NO2, etc). Sustituye a Open-Meteo en Galicia." status="done" />
        <TimelineMilestone iconId="cloud" title="Penachos de humo direccionales" desc="Cuando hay fuegos activos, se dibuja un cono marrón corriente abajo del foco con la dirección y velocidad del viento real de la estación más cercana. La longitud crece con la intensidad del foco (FRP). Físicamente coherente: si el viento es flojo no aparece, si cambia el viento el penacho rota." status="done" />
        <TimelineMilestone iconId="cloud" title="Halo de niebla en estaciones AEMET" desc="Cuando un aeropuerto o estación oficial AEMET reporta visibilidad &lt;2km, aparece un halo blanco-azulado a su alrededor. Constreñido a la cota baja de la propia estación: nunca pinta cumbres. Sólo se ve cuando hay datos oficiales que lo confirman." status="done" />
        <TimelineMilestone iconId="zap" title="Ondas concéntricas en cada rayo nuevo" desc="Cada rayo recién registrado emite una onda animada que se expande durante 3 segundos. Llamada visual urgente: si está cayendo AHORA cerca, se ve sin necesidad de leer ningún texto. Anillo amarillo brillante para los rayos a tierra (más peligrosos), tono más suave para los intra-nube." status="done" />
        <TimelineMilestone iconId="zap" title="Tracker de tormentas más fiable" desc="Auditoría a fondo del cálculo de centroide y dirección. ID estable por núcleo (mismo ID entre polls = mismo storm físico), matching greedy-global sin doble asignación, mediana multi-snapshot de velocidad para suprimir el ruido en clusters pequeños, umbral de match adaptativo. La flecha de avance y el ETA son ahora mucho más estables." status="done" />
        <TimelineMilestone iconId="zap" title="Histórico de rayos en TimescaleDB" desc="Cada rayo registrado por la red MeteoGalicia se persiste 24/7 en base de datos propia. Primera fase de un dataset histórico riguroso para detectar patrones reales: zonas de mayor incidencia, correlación con dirección de viento, paso de frentes, hora del día. A medida que se acumulen meses se podrán extraer patrones que ningún modelo genérico captura para Galicia." status="done" />
        <TimelineMilestone iconId="info" title="Histórico sinóptico — viento en altura" desc="Datos horarios de viento, temperatura y altura geopotencial a 850, 700 y 500 hPa por sector — la base de toda la dinámica que mueve las tormentas. Sin esto solo veríamos el resultado en superficie; con esto podemos correlacionar lo que pasa abajo con lo que está pasando arriba." status="done" />
        <TimelineMilestone iconId="zap" title="Histórico de inestabilidad atmosférica" desc="CAPE, CIN, índice de levantamiento y agua precipitable persistidos por hora y sector. Permitirá calibrar el predictor de tormentas con casos reales de Galicia: ¿qué umbrales de CAPE producen actividad eléctrica aquí, no en el genérico continental?" status="done" />

        {/* ── Proximamente ── */}
        <TimelineGroup label="Próximamente" dotColor="bg-sky-500" textColor="text-sky-400" />
        <TimelineMilestone iconId="anchor" title="Seguimiento de embarcaciones" desc="Posición de barcos en tiempo real y alertas marítimas inteligentes." status="idea" />
        <TimelineMilestone iconId="bell" title="Alertas a medida" desc="Define tus umbrales de viento, olas o temperatura y recibe avisos automáticos." status="idea" />
        <TimelineMilestone iconId="map-pin" title="Más zonas y actividades" desc="A Coruña, Costa da Morte, nuevos spots. Scoring por actividad: surf, vela, kite, SUP." status="idea" />
        <TimelineMilestone iconId="eye" title="Correlaciones históricas" desc={'Patrones basados en datos reales acumulados: "Cuando Silleiro marca X, Patos tiene Y."'} status="idea" />
      </div>

      {/* ── Fuentes de datos ─────────────────────────────── */}
      <div className="border-t border-slate-700/50 pt-6 space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-white">Fuentes de datos</h2>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Todos los datos provienen de <strong className="text-slate-400">fuentes abiertas y públicas</strong>:
            organismos oficiales, redes ciudadanas y proyectos de ciencia abierta.
          </p>
        </div>

        <div className="space-y-3">
          <h3 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
            <WeatherIcon id="database" size={13} /> Estaciones en tiempo real
          </h3>
          <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800 space-y-2">
            <SourceRow letter="A" name="AEMET" desc="Agencia Estatal de Meteorologia — 20 estaciones" color="#ef4444" />
            <SourceRow letter="M" name="MeteoGalicia" desc="Xunta de Galicia — 48 estaciones" color="#3b82f6" />
            <SourceRow letter="C" name="Meteoclimatic" desc="Red ciudadana — 23 estaciones" color="#22c55e" />
            <SourceRow letter="W" name="Weather Underground" desc="Estaciones personales — ~80 estaciones" color="#f59e0b" />
            <SourceRow letter="N" name="Netatmo" desc="Red doméstica IoT — 31+ estaciones" color="#a855f7" />
            <SourceRow letter="S" name="SkyX" desc="Estación personal portátil — auto-descubrimiento por GPS" color="#64748b" />
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
            <WeatherIcon id="satellite" size={13} /> Fuentes complementarias
          </h3>
          <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800 space-y-2">
            <SourceRow letter="M" name="MeteoSIX v5 (MeteoGalicia)" desc="WRF 1km (atmosferico), USWAN (oleaje nearshore), MOHID (temp. mar) — modelo principal" color="#3b82f6" />
            <SourceRow letter="O" name="Open-Meteo" desc="CAPE, CIN, LI, rachas, visibilidad — datos de conveccion background" color="#06b6d4" />
            <SourceRow letter="R" name="AEMET Radar" desc="Radar nacional (Cerceda/A Coruña)" color="#ec4899" />
            <SourceRow letter="L" name="MeteoGalicia" desc="Red de detección de rayos" color="#f43f5e" />
            <SourceRow letter="E" name="ENAIRE" desc="Espacio aéreo y NOTAMs para drones" color="#6366f1" />
            <SourceRow letter="T" name="IHM / Puertos del Estado" desc="Predicciones de mareas (5 puertos)" color="#14b8a6" />
            <SourceRow letter="B" name="Puertos del Estado (PORTUS) + Obs. Costeiro" desc="13 boyas marinas — oleaje, viento, corrientes, mareas" color="#06b6d4" />
            <SourceRow letter="X" name="Observatorio Costeiro (Xunta)" desc="Boyas suplementarias — humedad, punto de rocío, 10min (6 plataformas)" color="#14b8a6" />
            <SourceRow letter="H" name="RADAR ON RAIA (INTECMAR)" desc="Corrientes superficiales — radar HF costero, actualización horaria" color="#0ea5e9" />
            <SourceRow letter="C" name="CMEMS / Copernicus Marine" desc="Temperatura superficial del mar (SST) — WMTS tiles" color="#0d9488" />
            <SourceRow letter="D" name="EMODnet" desc="Batimetría — profundidades marinas WMS" color="#475569" />
            <SourceRow letter="N" name="NOAA" desc="Índices NAO/AO — teleconexiones atlánticas" color="#059669" />
            <SourceRow letter="I" name="IGN" desc="Cartografía: ortofotos PNOA, sombreado MDT, curvas de nivel" color="#7c3aed" />
            <SourceRow letter="W" name="MeteoGalicia Webcams" desc="19 camaras costeras publicas (imagenes cada 5 min) + 2 DGT" color="#3b82f6" />
            <SourceRow letter="D" name="DGT Webcams" desc="Camaras de trafico (Ribadavia, Fea-Arrabaldo) — validacion de niebla interior" color="#64748b" />
            <SourceRow letter="O" name="Open-Meteo Marine" desc="Previsión horaria de oleaje y swell (48h)" color="#06b6d4" />
            <SourceRow letter="V" name="MeteoGalicia Avisos" desc="Avisos adversos oficiales — tormentas, oleaje, viento, lluvia (RSS)" color="#eab308" />
            <SourceRow letter="P" name="RainViewer" desc="Radar precipitación animado (2h pasadas, tiles libres)" color="#3b82f6" />
            <SourceRow letter="F" name="NASA FIRMS" desc="Focos de incendio activos vía satélite VIIRS (375m, ≤1h latencia)" color="#dc2626" />
            <SourceRow letter="A" name="MeteoGalicia ICA (Xunta)" desc="Calidad del aire oficial — Rede Galega de Calidade do Aire" color="#10b981" />
          </div>
        </div>

        {/* Tech stack — simplified, no architecture details */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
            <WeatherIcon id="info" size={13} /> Tecnologías
          </h3>
          <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
              <TechRow name="React + Vite" license="MIT" />
              <TechRow name="TypeScript" license="Apache-2" />
              <TechRow name="MapLibre GL" license="BSD-3" />
              <TechRow name="Tailwind CSS" license="MIT" />
              <TechRow name="Zustand" license="MIT" />
              <TechRow name="Recharts" license="MIT" />
            </div>
            <div className="flex gap-4 mt-3 pt-2 border-t border-slate-700/50 text-[11px]">
              <span className="text-slate-500">100+ estaciones</span>
              <span className="text-slate-500">22 webcams + IA</span>
              <span className="text-slate-500">812 tests</span>
              <span className="text-slate-500">TimescaleDB 24/7</span>
            </div>
          </div>
        </div>

        {/* Atribuciones obligatorias + nota de uso */}
        <div className="bg-slate-900/30 rounded-lg p-3 border border-slate-700/50 space-y-2">
          <p className="text-[11px] text-slate-400">
            <strong className="text-slate-300">Atribuciones:</strong>{' '}
            © AEMET (CC BY 4.0) · © MeteoGalicia – Xunta de Galicia (CC BY 4.0) ·{' '}
            Datos de Puertos del Estado · © Instituto Hidrográfico de la Marina ·{' '}
            E.U. Copernicus Marine Service (CMEMS) · © EMODnet Bathymetry (CC BY 4.0) ·{' '}
            Modelo SWAN — CESGA · INTECMAR / RADAR ON RAIA · ENAIRE / AESA ·{' '}
            © Meteoclimatic · Powered by Weather Underground® · Powered by Netatmo ·{' '}
            Open-Meteo.com (CC BY 4.0) · RainViewer.com · meteo2api ·{' '}
            © OpenStreetMap contributors · © CARTO · © IGN España (CC BY 4.0) ·{' '}
            AWS Open Data (Mapzen Terrarium) · Noto Sans © Google (OFL).
          </p>
          <p className="text-[11px] text-amber-400/90">
            <strong>NO APTO PARA NAVEGACIÓN MARÍTIMA NI AÉREA.</strong>{' '}
            Cartas náuticas, mareas, boyas y zonas aéreas son visualización ilustrativa.
            Use siempre datos oficiales para decisiones operativas.
          </p>
          <p className="text-[11px] text-slate-400">
            <strong className="text-slate-300">Licencia software:</strong>{' '}
            <a
              href="https://github.com/Bateas/MeteoMapGal"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
            >MIT (código)</a>. Cada fuente de datos retiene su propia licencia — algunas
            requieren autorización para uso comercial. Proyecto sin ánimo de lucro.
            {' · '}
            <a
              href="https://github.com/Bateas/MeteoMapGal/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
            >Reportar bug</a>
          </p>
        </div>

        {/* ── Alpha mode toggle (experimental features) ─────── */}
        <div className="bg-amber-950/20 rounded-lg p-3 border border-amber-900/40 mt-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={alphaMode}
              onChange={toggleAlphaMode}
              className="mt-0.5 w-4 h-4 rounded accent-amber-500"
            />
            <div className="flex-1">
              <div className="text-[13px] font-bold text-amber-300 flex items-center gap-2">
                Modo Alpha
                <span className="text-[8px] font-bold text-amber-500/70 uppercase tracking-wider">experimental</span>
              </div>
              <p className="text-[11px] text-amber-200/60 mt-1">
                Activa funcionalidades en pruebas. Actualmente: <strong>Modo Evento / Regata</strong>.
                Pueden ser inestables o cambiar sin aviso.
              </p>
            </div>
          </label>
        </div>
      </div>
    </div>
  );
}

/* ─── Timeline sub-components ───────────────────── */

function TimelineGroup({ label, dotColor, textColor }: { label: string; dotColor: string; textColor: string }) {
  return (
    <div className="relative flex items-center gap-2 pt-5 pb-2">
      <div className={`absolute left-[-21px] w-[21px] h-[21px] rounded-full ${dotColor} flex items-center justify-center ring-2 ring-slate-950`}>
        {dotColor.includes('emerald') && (
          <WeatherIcon id="check" size={12} className="text-white" />
        )}
        {dotColor.includes('amber') && (
          <WeatherIcon id="clock" size={12} className="text-white" />
        )}
      </div>
      <span className={`text-sm font-bold ${textColor} ml-3 uppercase tracking-wide`}>{label}</span>
    </div>
  );
}

function TimelineMilestone({
  iconId,
  title,
  desc,
  status,
}: {
  iconId: IconId;
  title: string;
  desc: string;
  status: 'done' | 'planned' | 'idea' | 'wip';
}) {
  const cfg = {
    done:    { dot: 'bg-emerald-500/30 border-emerald-500/50', text: 'text-emerald-400', icon: 'text-emerald-400/70' },
    wip:     { dot: 'bg-sky-500/30 border-sky-500/50', text: 'text-sky-400', icon: 'text-sky-400/70' },
    planned: { dot: 'bg-amber-500/20 border-amber-500/40', text: 'text-amber-400', icon: 'text-amber-400/70' },
    idea:    { dot: 'bg-slate-500/20 border-slate-500/40', text: 'text-slate-400', icon: 'text-slate-500' },
  };
  const s = cfg[status];

  return (
    <div className="relative flex items-start gap-3 pb-4 ml-3">
      {/* Small dot on timeline */}
      <div className={`absolute left-[-33px] top-1.5 w-[9px] h-[9px] rounded-full border ${s.dot}`} />
      <span className={`shrink-0 mt-0.5 ${s.icon}`}>
        <WeatherIcon id={iconId} size={15} />
      </span>
      <div className="min-w-0">
        <span className={`text-xs font-bold ${s.text}`}>{title}</span>
        <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

/* ─── Shared sub-components ─────────────────────── */

function SourceRow({ letter, name, desc, color }: { letter: string; name: string; desc: string; color: string }) {
  return (
    <div className="flex items-start gap-3">
      <div
        className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white"
        style={{ background: color }}
      >
        {letter}
      </div>
      <div>
        <span className="text-[11px] font-bold text-slate-300">{name}</span>
        <span className="text-[11px] text-slate-500 ml-1">{desc}</span>
      </div>
    </div>
  );
}

function TechRow({ name, license }: { name: string; license: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-300 font-medium">{name}</span>
      <span className="text-slate-600 font-mono text-[11px]">{license}</span>
    </div>
  );
}
