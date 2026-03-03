/**
 * Guide section: Banner Go/No-Go — explains the sailing condition banner and data sources.
 */
export function SailingBannerSection() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Banner de navegación y fuentes</h2>
      <p className="text-slate-400 text-sm leading-relaxed">
        El banner superior del mapa muestra un veredicto rápido de condiciones
        de navegación. Combina viento real de las estaciones, alertas activas
        y puntuación térmica.
      </p>

      {/* Verdict levels */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">Veredictos</h3>
        <div className="space-y-2">
          <VerdictCard
            icon="⛵"
            label="GO"
            color="#22c55e"
            wind="6 – 20 kt"
            description="Condiciones favorables para navegar. Muestra estación con mejor viento."
          />
          <VerdictCard
            icon="⚠️"
            label="MARGINAL"
            color="#f59e0b"
            wind="20 – 25 kt / 4 – 6 kt"
            description="Viento fuerte (>20kt) o viento suave con potencial térmico. Navegar con precaución."
          />
          <VerdictCard
            icon="🚫"
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
            La capa satélite (🛰️ en el selector de capas) muestra la imagen infrarroja de EUMETSAT
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

      {/* Refresh */}
      <div className="bg-slate-900/30 rounded-lg p-3 border border-slate-700/50">
        <p className="text-[10px] text-slate-400">
          <strong className="text-slate-300">Actualización automática:</strong> Todas las fuentes
          se actualizan cada 5 minutos (rayos cada 2 min). Pulsa{' '}
          <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-mono">R</kbd>{' '}
          para forzar una recarga manual.
        </p>
      </div>
    </div>
  );
}

/* ─── Sub-components ─────────────────────────── */

function VerdictCard({
  icon,
  label,
  color,
  wind,
  description,
}: {
  icon: string;
  label: string;
  color: string;
  wind: string;
  description: string;
}) {
  return (
    <div
      className="flex items-start gap-3 p-3 rounded-lg border"
      style={{ borderColor: `${color}30`, background: `${color}08` }}
    >
      <span className="text-lg">{icon}</span>
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

function AlertDistance({ color, dist, label }: { color: string; dist: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
      <span className="font-mono text-slate-300 w-14 shrink-0">{dist}</span>
      <span className="text-slate-500">{label}</span>
    </div>
  );
}
