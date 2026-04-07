import { useState } from 'react';
import { WeatherIcon } from '../icons/WeatherIcons';
import { useWebcamStore } from '../../store/webcamStore';
import { windKtColor, waveColor } from './spotColors';
import type { SpotScore, WindContribution } from '../../services/spotScoringEngine';
import type { SailingSpot } from '../../config/spots';

const VERDICT_LABEL: Record<string, string> = {
  calm: 'calma', light: 'flojo', sailing: 'navegable',
  good: 'buen día', strong: 'fuerte', unknown: 'sin datos',
};

export function Cell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-slate-500 text-[11px]">{label}</span>
      <span className="font-bold text-slate-200" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}

export function ScoringBreakdown({ score, spot }: { score: SpotScore; spot: SailingSpot }) {
  const [open, setOpen] = useState(false);

  const lines: { label: string; value: string; color?: string }[] = [];

  if (score.wind) {
    const w = score.wind;
    lines.push({
      label: 'Consenso viento',
      value: `${w.stationCount} estaciones, ${w.avgSpeedKt.toFixed(0)} kt ${w.dominantDir}`,
      color: windKtColor(w.avgSpeedKt),
    });
    if (w.matchedPattern) {
      lines.push({ label: 'Patrón', value: w.matchedPattern, color: '#fbbf24' });
    }
  }

  if (score.waves?.waveHeight != null) {
    const wh = score.waves.waveHeight;
    const relevance = spot.waveRelevance === 'critical' ? 'oceánico' : spot.waveRelevance === 'moderate' ? 'moderado' : 'interior';
    lines.push({
      label: `Oleaje (${relevance})`,
      value: `${wh.toFixed(1)} m${score.waves.wavePeriod != null ? ` \u00b7 Tp ${score.waves.wavePeriod.toFixed(0)}s` : ''}`,
      color: waveColor(wh),
    });
  } else if (spot.waveRelevance === 'none') {
    lines.push({ label: 'Aguas', value: 'Aguas planas (bonus)', color: '#22c55e' });
  }

  if (score.thermal && score.thermal.thermalProbability > 0) {
    lines.push({
      label: 'Térmica',
      value: `${score.thermal.thermalProbability}% prob${score.thermal.deltaT != null ? ` \u00b7 \u0394T ${score.thermal.deltaT.toFixed(0)}\u00b0C` : ''}`,
      color: '#fbbf24',
    });
    if (score.thermal.windWindow) {
      const tw = score.thermal.windWindow;
      lines.push({
        label: 'Ventana t\u00e9rmica',
        value: `${tw.startHour}h\u2013${tw.endHour}h \u00b7 ~${tw.avgSpeedKt.toFixed(0)} kt ${tw.dominantDir}`,
      });
    }
  }

  if (score.hardGateTriggered) {
    lines.push({ label: 'Límite', value: score.hardGateTriggered, color: '#ef4444' });
  }

  if (score.wind && spot.id === 'cesantes' && score.wind.dominantDir === 'N') {
    lines.push({ label: 'Penalización', value: 'Norte en Cesantes (\u221215)', color: '#f97316' });
  }

  if (lines.length === 0) return null;

  return (
    <div className="mt-2 pt-1.5 border-t border-slate-700/40">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-300 transition-colors w-full text-left"
      >
        <WeatherIcon id="info" size={11} className="text-slate-400 shrink-0" />
        <span className="font-semibold">¿Por qué {VERDICT_LABEL[score.verdict] ?? score.verdict}?</span>
        <span className="text-slate-500 text-[11px] ml-auto">{open ? '\u25B2' : '\u25BC'}</span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-1">
          {lines.map((line, i) => (
            <div key={i} className="flex items-baseline gap-1.5 text-[11px]">
              <span className="text-slate-500 shrink-0 w-[72px] text-right">{line.label}</span>
              <span className="font-semibold" style={line.color ? { color: line.color } : { color: '#e2e8f0' }}>
                {line.value}
              </span>
            </div>
          ))}
          <div className="text-[11px] text-slate-600 mt-1 italic">
            Score: {score.score}/100 \u00b7 {score.wind?.stationCount ?? 0} fuentes
          </div>
          {score.wind?.contributions && <WindSources contributions={score.wind.contributions} />}
          <SpotVisionBadge spot={spot} />
        </div>
      )}
    </div>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  aemet: 'AEMET', meteogalicia: 'MG', meteoclimatic: 'MC',
  wunderground: 'WU', netatmo: 'NT', skyx: 'SkyX', buoy: 'Boya',
};

function WindSources({ contributions }: { contributions: WindContribution[] }) {
  const [open, setOpen] = useState(false);
  if (!contributions || contributions.length === 0) return null;
  return (
    <div className="mt-1 pt-1 border-t border-slate-700/30">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-[10px] text-blue-400/70 hover:text-blue-300 cursor-pointer flex items-center gap-1"
      >
        <span className="text-[8px]">{open ? '\u25BC' : '\u25B6'}</span>
        Fuentes ({contributions.length})
      </button>
      {open && (
        <div className="mt-1 space-y-0.5">
          {contributions.slice(0, 8).map((c, i) => (
            <div key={i} className="flex items-center gap-1 text-[9px] text-slate-400">
              <span className={`w-[24px] shrink-0 font-mono ${c.source === 'buoy' ? 'text-cyan-400' : 'text-slate-500'}`}>
                {SOURCE_LABELS[c.source] ?? c.source}
              </span>
              <span className="truncate flex-1" title={c.name}>{c.name}</span>
              <span className="font-semibold text-slate-300 w-[32px] text-right">{c.speedKt}kt</span>
              <span className="w-[16px] text-center">{c.dir ?? '-'}</span>
              <span className="text-slate-600 w-[28px] text-right">{c.distKm}km</span>
              <span className="text-slate-600 w-[22px] text-right">{c.weightPct}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SpotVisionBadge({ spot }: { spot: SailingSpot }) {
  const visionResults = useWebcamStore((s) => s.visionResults);
  if (!spot.webcams || spot.webcams.length === 0) return null;

  let bestResult: { bf: number; label: string; kt: number; confidence: string; sky: string; fog: boolean; ago: number; webcamName: string } | null = null;

  for (const [webcamId, result] of visionResults) {
    if (result.beaufort < 0) continue;
    if (result.spotId === spot.id) {
      const ago = Math.round((Date.now() - result.analyzedAt.getTime()) / 60_000);
      if (!bestResult || result.confidence === 'high' || ago < (bestResult.ago ?? 999)) {
        bestResult = { bf: result.beaufort, label: result.beaufortLabel, kt: result.windEstimateKt, confidence: result.confidence, sky: result.weather.sky, fog: result.weather.fogVisible, ago, webcamName: webcamId };
      }
    }
  }

  if (!bestResult) return null;
  const color = bestResult.bf <= 1 ? '#94a3b8' : bestResult.bf <= 3 ? '#38bdf8' : bestResult.bf <= 5 ? '#fbbf24' : '#f87171';

  return (
    <div className="mt-1 pt-1 border-t border-slate-700/30">
      <div className="flex items-center gap-1.5 text-[10px]">
        <span className="text-slate-600">Vision IA:</span>
        <span className="font-bold" style={{ color }}>B{bestResult.bf}</span>
        <span className="text-slate-500">{bestResult.label} ~{bestResult.kt}kt</span>
        {bestResult.fog && <span className="text-amber-400">Niebla</span>}
        <span className="ml-auto text-slate-600">{bestResult.ago < 60 ? `${bestResult.ago}m` : `${Math.round(bestResult.ago / 60)}h`}</span>
      </div>
    </div>
  );
}
