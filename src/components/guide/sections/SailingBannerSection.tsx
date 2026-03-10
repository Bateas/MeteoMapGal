/**
 * Guide section: Sailing banner — explains the verdict system and scoring.
 */
import { WeatherIcon } from '../../icons/WeatherIcons';
import type { IconId } from '../../icons/WeatherIcons';

export function SailingBannerSection() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Navegación — veredictos y scoring</h2>
      <p className="text-slate-400 text-sm leading-relaxed">
        El banner de navegación en el mapa (sector Embalse) muestra un veredicto rápido combinando
        viento real, previsión, condiciones térmicas y alertas en un score 0-100.
        El scoring detallado por spot está en el panel «Spots de navegación» del sidebar (ver sección dedicada).
      </p>

      {/* Verdict levels */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">Veredictos</h3>
        <div className="space-y-2">
          <VerdictCard
            iconId="sailboat"
            label="¡A navegar!"
            color="#10b981"
            range="≥ 45 pts"
            description="Buen día. Viento real sostenido (>5kt) en varias estaciones. Con calor y cielos despejados, excelente."
          />
          <VerdictCard
            iconId="wind"
            label="Viento flojo"
            color="#f59e0b"
            range="20 – 44 pts"
            description="Algo de viento pero no sostenido, o previsión favorable sin confirmación real aún."
          />
          <VerdictCard
            iconId="sleep"
            label="Sin condiciones"
            color="#ef4444"
            range="< 20 pts"
            description="Calma generalizada en estaciones. Sin viento suficiente para navegar."
          />
        </div>
      </div>

      {/* Scoring breakdown */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">Composición del score (0-100)</h3>
        <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800 space-y-2">
          <ScoreRow label="Consenso viento real" points="0-40" color="#10b981"
            desc="Factor dominante. Estaciones con viento consistente (±45°, ≥2kt). +5kt y +5 estaciones = máximo." />
          <ScoreRow label="Viento previsto" points="0-20" color="#06b6d4"
            desc="Ventana de viento ≥3kt entre 10h-20h en la previsión horaria." />
          <ScoreRow label="ΔT diurno" points="0-15" color="#f59e0b"
            desc="Bonus térmico. ΔT ≥20°C indica alto potencial de convección." />
          <ScoreRow label="Atmósfera" points="0-15" color="#3b82f6"
            desc="Bonus térmico. Nubes bajas + CAPE alto + PBL elevada favorecen térmicas." />
          <ScoreRow label="Zona térmica" points="0-10" color="#a855f7"
            desc="Score de las micro-zonas del embalse (confirmación en terreno)." />
          <div className="border-t border-slate-700/50 pt-2 mt-2">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-slate-300 font-bold">Penalizaciones</span>
              <span className="text-red-400 text-[9px]">Tormenta: -40 · Alerta alta: -20 · Lluvia &gt;60%: -10</span>
            </div>
          </div>
        </div>
        <p className="text-[10px] text-slate-500 leading-relaxed">
          <strong className="text-slate-400">Filosofía:</strong> Si hay &gt;5kt de viento real sostenido, ya es un buen día
          para navegar. Las condiciones térmicas (ΔT, atmósfera) son un <em>bonus</em> que hacen el día excelente, no un requisito.
        </p>
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
  range,
  description,
}: {
  iconId: IconId;
  label: string;
  color: string;
  range: string;
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
          <span className="text-[9px] text-slate-500 font-mono">{range}</span>
        </div>
        <p className="text-[10px] text-slate-500 mt-0.5">{description}</p>
      </div>
    </div>
  );
}

function ScoreRow({ label, points, color, desc }: { label: string; points: string; color: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="shrink-0 w-1.5 h-full min-h-[24px] rounded-full" style={{ background: color }} />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-slate-300">{label}</span>
          <span className="text-[9px] font-mono" style={{ color }}>{points} pts</span>
        </div>
        <p className="text-[9px] text-slate-500 mt-0.5">{desc}</p>
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
