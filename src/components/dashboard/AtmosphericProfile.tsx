/**
 * Atmospheric stability over Castrelo, for whoever looks for it: a fold whose title is the conclusion, with the
 * model's figures inside, each with its meaning in words. Measures convection, not wind to sail with.
 *
 * Data comes from thermalStore.atmosphericContext (Open-Meteo model data). Sky and radiation are not repeated
 * here: the table above already has the sky.
 */
import { memo, useMemo } from 'react';
import { useThermalStore } from '../../store/thermalStore';
import type { AtmosphericContext } from '../../types/thermal';

function capeWord(cape: number): string {
  if (cape >= 1000) return 'fuerte';
  if (cape >= 500) return 'moderada';
  if (cape >= 200) return 'ligera';
  return 'débil';
}

function mixingWord(blh: number): string {
  if (blh >= 2000) return 'muy profunda';
  if (blh >= 1500) return 'profunda';
  if (blh >= 1000) return 'moderada';
  if (blh >= 500) return 'limitada';
  return 'muy baja';
}

function liftedWord(li: number): string {
  if (li <= -6) return 'muy inestable';
  if (li <= -2) return 'inestable';
  if (li <= 0) return 'algo inestable';
  if (li <= 2) return 'neutra';
  return 'estable';
}

function capWord(cin: number): string {
  if (cin <= 20) return 'sin tapa';
  if (cin <= 50) return 'tapa floja';
  if (cin <= 100) return 'tapa moderada';
  if (cin <= 200) return 'tapa fuerte';
  return 'tapa muy fuerte';
}

interface StabilityAssessment {
  label: string;
  description: string;
}

/** Exported for the test. */
export function assessStability(ctx: AtmosphericContext): StabilityAssessment {
  const cape = ctx.cape ?? 0;
  const cin = ctx.convectiveInhibition ?? 0;
  const li = ctx.liftedIndex ?? 0;
  const blh = ctx.boundaryLayerHeight ?? 0;

  if (cape >= 1000 && li <= -4) {
    return { label: 'Convección', description: 'Convección fuerte probable. Riesgo de tormenta.' };
  }
  if (blh >= 1500 && cape >= 200 && cin <= 50 && li <= 0) {
    return { label: 'Excelente', description: 'Capa de mezcla profunda, baja inhibición. Térmicas potentes.' };
  }
  if (blh >= 1000 && cin <= 100 && li <= 2) {
    return { label: 'Buena', description: 'Condiciones favorables para térmicas moderadas.' };
  }
  if (blh >= 500 || (cape >= 100 && cin <= 150)) {
    return { label: 'Marginal', description: 'Capa de mezcla limitada. Térmicas débiles o esporádicas.' };
  }
  return { label: 'Estable', description: 'Atmósfera estable. Sin actividad convectiva significativa.' };
}

export const AtmosphericProfile = memo(function AtmosphericProfile() {
  const ctx = useThermalStore((s) => s.atmosphericContext);
  const assessment = useMemo(() => (ctx ? assessStability(ctx) : null), [ctx]);

  if (!ctx || !assessment) return null;

  return (
    <details className="g-fold">
      <summary>
        Perfil atmosférico: {assessment.label.toLowerCase()} <span className="g-beta">beta</span>
      </summary>
      <p className="g-how" style={{ marginBottom: 10 }}>
        {assessment.description} Mide la convección, no el viento para navegar.
      </p>
      <dl className="g-atmos">
        {ctx.boundaryLayerHeight !== null && (
          <div title="Altura de la capa límite. Más de 1500 m, térmicas fuertes.">
            <dt>Capa de mezcla</dt>
            <dd>{Math.round(ctx.boundaryLayerHeight)} m, {mixingWord(ctx.boundaryLayerHeight)}</dd>
          </div>
        )}
        {ctx.cape !== null && (
          <div title="Energía para la convección. Más de 500, moderada.">
            <dt>CAPE</dt>
            <dd>{Math.round(ctx.cape)} J/kg, {capeWord(ctx.cape)}</dd>
          </div>
        )}
        {ctx.convectiveInhibition !== null && (
          <div title="Lo que frena la convección. Más de 200, un bloqueo fuerte.">
            <dt>CIN</dt>
            <dd>{Math.round(ctx.convectiveInhibition)} J/kg, {capWord(ctx.convectiveInhibition)}</dd>
          </div>
        )}
        {ctx.liftedIndex !== null && (
          <div title="Negativo, inestable. Por debajo de -2, térmicas.">
            <dt>Índice de elevación</dt>
            <dd>{ctx.liftedIndex.toFixed(1).replace('.', ',')} °C, {liftedWord(ctx.liftedIndex)}</dd>
          </div>
        )}
      </dl>
      {ctx.fetchedAt && (
        <p className="g-how" style={{ marginTop: 8 }}>
          Modelo Open-Meteo, a las {ctx.fetchedAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}.
        </p>
      )}
    </details>
  );
});
