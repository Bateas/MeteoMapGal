/**
 * The level of Condiciones in words, for screen readers: the dot beside «Condiciones» says it only by colour.
 * One list for the header and the bottom bar, so both say the same (review, 18-nov).
 */
export const CONDITIONS_LEVEL_WORD = {
  none: '', riesgo: ' Nivel: riesgo.', moderado: ' Nivel: moderado.', alto: ' Nivel: alto.', critico: ' Nivel: crítico.',
} as const;
