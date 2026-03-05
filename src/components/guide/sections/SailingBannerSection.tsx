/**
 * Guide section: Banner Go/No-Go — explains the sailing condition banner and data sources.
 */
import { WeatherIcon } from '../../icons/WeatherIcons';
import type { IconId } from '../../icons/WeatherIcons';

export function SailingBannerSection() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Navegación, fuentes y atribuciones</h2>
      <p className="text-slate-400 text-sm leading-relaxed">
        MeteoMap combina múltiples fuentes de datos en tiempo real para ofrecer una visión
        completa de las condiciones meteorológicas. El banner superior del mapa (sector Embalse)
        muestra un veredicto rápido de navegación combinando viento, alertas y scoring térmico.
      </p>

      {/* Verdict levels */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">Veredictos</h3>
        <div className="space-y-2">
          <VerdictCard
            iconId="sailboat"
            label="GO"
            color="#22c55e"
            wind="6 – 20 kt"
            description="Condiciones favorables para navegar. Muestra estación con mejor viento."
          />
          <VerdictCard
            iconId="alert-triangle"
            label="MARGINAL"
            color="#f59e0b"
            wind="20 – 25 kt / 4 – 6 kt"
            description="Viento fuerte (>20kt) o viento suave con potencial térmico. Navegar con precaución."
          />
          <VerdictCard
            iconId="ban"
            label="NO-GO"
            color="#ef4444"
            wind="> 25 kt / < 4 kt"
            description="Viento excesivo, calma total, o alertas críticas activas. No salir."
          />
        </div>
      </div>

      {/* Data sources */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">Fuentes de datos</h3>
        <p className="text-[10px] text-slate-400 leading-relaxed">
          MeteoMap combina 5 fuentes de datos en tiempo real. Las letras dentro de cada
          marcador de estación indican la fuente:
        </p>
        <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800 space-y-2">
          <SourceRow
            letter="A"
            name="AEMET"
            desc="Agencia estatal (España). 9 estaciones. Datos oficiales, actualización cada 10-30 min."
            color="#ef4444"
          />
          <SourceRow
            letter="M"
            name="MeteoGalicia"
            desc="Red autonómica (Galicia). 13 estaciones. Temperatura + humedad principalmente."
            color="#3b82f6"
          />
          <SourceRow
            letter="C"
            name="Meteoclimatic"
            desc="Red ciudadana verificada. 6 estaciones (Ourense + Pontevedra). Datos cada ~5 min."
            color="#22c55e"
          />
          <SourceRow
            letter="W"
            name="Weather Underground"
            desc="Estaciones personales. 1 estación local. Datos en tiempo real."
            color="#f59e0b"
          />
          <SourceRow
            letter="N"
            name="Netatmo"
            desc="Estaciones domésticas. 11 estaciones. Solo temperatura (sin anemómetro)."
            color="#a855f7"
          />
        </div>
      </div>

      {/* Satellite + Storm shadow */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">Satélite y sombra de tormenta</h3>
        <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800 space-y-2">
          <p className="text-[10px] text-slate-400 leading-relaxed">
            La capa satélite (<WeatherIcon id="satellite" size={12} className="inline-block" /> en el selector de capas) muestra la imagen infrarroja de EUMETSAT
            Meteosat actualizada cada 15 minutos. Funciona de día y de noche.
          </p>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[10px]">
              <div className="w-4 h-3 rounded-sm bg-white border border-slate-600 shrink-0" />
              <span className="text-slate-400"><strong className="text-slate-300">Blanco brillante</strong> — nubes altas y frías (cumulonimbus, tormentas activas)</span>
            </div>
            <div className="flex items-center gap-2 text-[10px]">
              <div className="w-4 h-3 rounded-sm bg-gray-400 shrink-0" />
              <span className="text-slate-400"><strong className="text-slate-300">Gris claro</strong> — nubes medias o estratos</span>
            </div>
            <div className="flex items-center gap-2 text-[10px]">
              <div className="w-4 h-3 rounded-sm bg-gray-700 border border-slate-600 shrink-0" />
              <span className="text-slate-400"><strong className="text-slate-300">Oscuro</strong> — cielo despejado o nubes bajas</span>
            </div>
          </div>
          <p className="text-[9px] text-slate-500 italic">
            El sistema de <strong className="text-amber-400/80">sombra de tormenta</strong> cruza la imagen
            satelital con datos de radiación solar, rayos y anomalías de viento para detectar tormentas
            acercándose antes de que lleguen al embalse.
          </p>
        </div>
      </div>

      {/* Lightning */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">Rayos y tormentas</h3>
        <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800 space-y-2">
          <p className="text-[10px] text-slate-400 leading-relaxed">
            Los impactos de rayos (últimas 24h) se muestran como puntos en el mapa.
            El color indica antigüedad: rojo = reciente, amarillo = horas, gris = antiguo.
          </p>
          <div className="space-y-1">
            <AlertDistance color="#ef4444" dist="< 10 km" label="Peligro — salir del agua inmediatamente" />
            <AlertDistance color="#f59e0b" dist="< 25 km" label="Alerta — prepararse para recoger" />
            <AlertDistance color="#3b82f6" dist="< 50 km" label="Vigilancia — monitorizar evolución" />
          </div>
          <p className="text-[9px] text-slate-500 italic">
            Fuente: MeteoGalicia meteo2api. Actualización cada 2 minutos.
          </p>
        </div>
      </div>

      {/* Supplementary data sources */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">Fuentes complementarias</h3>
        <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800 space-y-2">
          <SourceRow
            letter="O"
            name="Open-Meteo"
            desc="Previsión horaria + datos atmosféricos (CAPE, PBL, LI, CIN). Motor del scoring térmico."
            color="#06b6d4"
          />
          <SourceRow
            letter="R"
            name="AEMET Radar (Cuntis)"
            desc="Radar de precipitación, radio ~240 km. Actualización cada 10 min."
            color="#ec4899"
          />
          <SourceRow
            letter="S"
            name="EUMETSAT Meteosat"
            desc="Imagen satélite infrarroja (IR 10.8μm). Actualización cada 15 min. Funciona 24h."
            color="#8b5cf6"
          />
          <SourceRow
            letter="L"
            name="MeteoGalicia (Rayos)"
            desc="Impactos de rayos últimas 24h vía meteo2api. Actualización cada 2 min."
            color="#f43f5e"
          />
          <SourceRow
            letter="E"
            name="ENAIRE"
            desc="Zonas UAS y NOTAMs para pilotos de dron. Restricciones de espacio aéreo."
            color="#6366f1"
          />
        </div>
      </div>

      {/* Refresh */}
      <div className="bg-slate-900/30 rounded-lg p-3 border border-slate-700/50">
        <p className="text-[10px] text-slate-400">
          <strong className="text-slate-300">Actualización automática:</strong> Todas las fuentes
          se actualizan cada 5 minutos (rayos cada 2 min). Pulsa{' '}
          <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-mono">R</kbd>{' '}
          para forzar una recarga manual.
        </p>
      </div>

      {/* Technology & Attribution */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">Tecnología y atribuciones</h3>
        <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800 space-y-3">
          <p className="text-[10px] text-slate-400 leading-relaxed">
            MeteoMap es software de código abierto construido con tecnologías libres.
            Agradecemos a las comunidades que hacen posible este proyecto:
          </p>
          <div className="space-y-1.5">
            <AttrRow name="MapLibre GL JS" license="BSD-3" desc="Motor de mapas interactivos con terreno 3D" />
            <AttrRow name="lucide-react" license="ISC" desc="Iconos SVG consistentes (todos los iconos de la app)" />
            <AttrRow name="React + Vite" license="MIT" desc="Framework de UI y bundler de desarrollo" />
            <AttrRow name="Zustand" license="MIT" desc="Gestión de estado ligera" />
            <AttrRow name="Tailwind CSS" license="MIT" desc="Sistema de diseño utility-first" />
            <AttrRow name="Recharts" license="MIT" desc="Gráficas y visualizaciones de datos" />
          </div>
          <p className="text-[9px] text-slate-600 italic">
            Todas las librerías utilizadas son de código abierto con licencias permisivas
            (MIT, BSD, ISC) que permiten uso libre, modificación y distribución.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─── Sub-components ─────────────────────────── */

function VerdictCard({
  iconId,
  label,
  color,
  wind,
  description,
}: {
  iconId: IconId;
  label: string;
  color: string;
  wind: string;
  description: string;
}) {
  return (
    <div
      className="flex items-start gap-3 p-3 rounded-lg border"
      style={{ borderColor: `${color}20`, background: `${color}08` }}
    >
      <span className="text-lg" style={{ color }}><WeatherIcon id={iconId} size={20} /></span>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold" style={{ color }}>{label}</span>
          <span className="text-[9px] text-slate-500 font-mono">{wind}</span>
        </div>
        <p className="text-[10px] text-slate-500 mt-0.5">{description}</p>
      </div>
    </div>
  );
}

function SourceRow({
  letter,
  name,
  desc,
  color,
}: {
  letter: string;
  name: string;
  desc: string;
  color: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div
        className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
        style={{ background: color }}
      >
        {letter}
      </div>
      <div>
        <span className="text-[10px] font-bold text-slate-300">{name}</span>
        <p className="text-[9px] text-slate-500">{desc}</p>
      </div>
    </div>
  );
}

function AttrRow({ name, license, desc }: { name: string; license: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 text-[10px]">
      <span className="text-slate-300 font-semibold shrink-0 w-28">{name}</span>
      <span className="text-slate-600 font-mono shrink-0 w-10">{license}</span>
      <span className="text-slate-500">{desc}</span>
    </div>
  );
}

function AlertDistance({ color, dist, label }: { color: string; dist: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
      <span className="font-mono text-slate-300 w-14 shrink-0">{dist}</span>
      <span className="text-slate-500">{label}</span>
    </div>
  );
}
