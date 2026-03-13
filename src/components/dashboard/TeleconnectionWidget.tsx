import { useState, useEffect } from 'react';
import { fetchTeleconnections, type TeleconnectionIndex } from '../../api/naoClient';

/**
 * NAO/AO teleconnection indices widget.
 * Positive NAO → mild, wet winters in Galicia (Atlantic storms).
 * Negative NAO → cold, dry (blocking high).
 * AO negative → Arctic air intrusions.
 */

const INTERPRETATIONS: Record<string, Record<string, string>> = {
  NAO: {
    strong_positive: 'Fuerte flujo atlántico → viento SW, lluvias, temporal',
    positive: 'Borrascas activas → viento y lluvia en Galicia',
    neutral: 'Patrón neutro — sin dominio claro',
    negative: 'Bloqueo anticiclónico → tiempo estable, menos viento',
    strong_negative: 'Bloqueo severo → frío seco, heladas, calma',
  },
  AO: {
    strong_positive: 'Vórtice polar fuerte → westerlies activos',
    positive: 'Chorro polar bien definido → temporal atlántico',
    neutral: 'Patrón neutro',
    negative: 'Vórtice polar débil → posibles olas de frío',
    strong_negative: 'Colapso polar → irrupciones árticas severas',
  },
};

function getPhase(value: number): string {
  if (value > 1.5) return 'strong_positive';
  if (value > 0.5) return 'positive';
  if (value > -0.5) return 'neutral';
  if (value > -1.5) return 'negative';
  return 'strong_negative';
}

function phaseLabel(value: number): string {
  if (value > 1.5) return 'Muy positivo';
  if (value > 0.5) return 'Positivo';
  if (value > -0.5) return 'Neutro';
  if (value > -1.5) return 'Negativo';
  return 'Muy negativo';
}

function phaseColor(value: number): string {
  if (value > 1.5) return '#3b82f6';   // blue
  if (value > 0.5) return '#22c55e';   // green
  if (value > -0.5) return '#eab308';  // yellow
  if (value > -1.5) return '#f97316';  // orange
  return '#ef4444';                    // red
}

function trendArrow(trend: number): string {
  if (trend > 0.3) return '↑';
  if (trend < -0.3) return '↓';
  return '→';
}

export function TeleconnectionWidget() {
  const [indices, setIndices] = useState<TeleconnectionIndex[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchTeleconnections()
      .then((data) => { if (!cancelled) { setIndices(data); setLoading(false); } })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="text-xs text-slate-500 text-center py-2">Cargando índices...</div>;
  if (error || indices.length === 0) return null; // Fail silently

  return (
    <div className="bg-slate-800/60 rounded-lg border border-slate-700/50 overflow-hidden">
      <div className="px-3 py-1.5 bg-slate-700/40 text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
        <span>🌍</span>
        <span>Índices Teleconexión</span>
        <span className="ml-auto text-[9px] text-slate-500 font-normal">
          NOAA CPC
        </span>
      </div>
      <div className="p-3 space-y-3">
        {indices.map((idx) => {
          const phase = getPhase(idx.value);
          const interp = INTERPRETATIONS[idx.name]?.[phase] ?? '';
          return (
            <div key={idx.name} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300">
                  {idx.name === 'NAO' ? 'NAO (Osc. Atlántico Norte)' : 'AO (Osc. Ártica)'}
                </span>
                <div className="flex items-center gap-1.5">
                  <span
                    className="text-sm font-bold tabular-nums"
                    style={{ color: phaseColor(idx.value) }}
                  >
                    {idx.value > 0 ? '+' : ''}{idx.value.toFixed(2)}
                  </span>
                  <span className="text-xs text-slate-400">
                    {trendArrow(idx.trend)}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span style={{ color: phaseColor(idx.value) }}>
                  {phaseLabel(idx.value)}
                </span>
                <span className="text-slate-500">
                  Media 30d: {idx.avg30d > 0 ? '+' : ''}{idx.avg30d.toFixed(2)}
                </span>
              </div>
              <p className="text-[10px] text-slate-400 leading-snug">
                {interp}
              </p>
            </div>
          );
        })}
        <p className="text-[9px] text-slate-600 leading-tight">
          NAO positiva = borrascas atlánticas activas en Galicia. Negativa = bloqueo, calma.
          Dato del {indices[0]?.date ?? '?'}.
        </p>
      </div>
    </div>
  );
}
