/**
 * The headline of the forecast's "Resumen para navegantes": one line from the best wind ahead, the rain
 * hours and how steady the direction is.
 *
 * Until 28-sep, good wind with a steady direction AND rain matched none of the wind cases and fell through
 * to "Sin viento significativo previsto — dia de calma": the day before a front (25 kt S, 6 h of rain) read
 * as a calm day right under a table showing 25 kt. Strong wind had no case of its own either. Strong uses
 * the spot verdict's scale ('strong' from 18 kt), so the summary and the map speak the same language.
 */
export const SUMMARY_STRONG_KT = 18;
export const SUMMARY_GOOD_KT = 8;
export const SUMMARY_SOME_WIND_KT = 4;
/** Two or more rainy hours ahead count as a rainy day for the headline. */
export const SUMMARY_RAIN_HOURS = 2;
/** directionConsistency (0-100) from which the direction counts as steady. */
export const SUMMARY_STEADY_DIR = 60;

export type SailingLineTone = 'strong' | 'good' | 'mixed' | 'light' | 'calm';
export type SailingLineIcon = 'sailboat' | 'wind' | 'cloud-rain';

export interface SailingLineInput {
  bestKt: number;
  /** "sobre las ..." reference already formatted by the caller, or null. */
  bestTimeLabel: string | null;
  rainHours: number;
  directionConsistency: number;
}

export function sailingConclusionLine(i: SailingLineInput): { text: string; tone: SailingLineTone; icon: SailingLineIcon } {
  const kt = i.bestKt.toFixed(0);
  const when = i.bestTimeLabel ? ` sobre las ${i.bestTimeLabel}` : '';
  const rainy = i.rainHours >= SUMMARY_RAIN_HOURS;
  const rain = rainy ? `, con lluvia (${i.rainHours} h)` : '';

  if (i.bestKt >= SUMMARY_STRONG_KT) {
    return { text: `Viento fuerte: hasta ${kt} kt${when}${rain}.`, tone: 'strong', icon: 'wind' };
  }
  if (i.bestKt >= SUMMARY_GOOD_KT && rainy) {
    return { text: `Viento de hasta ${kt} kt${when}, pero con lluvia (${i.rainHours} h): mira las horas secas en la tabla.`, tone: 'mixed', icon: 'cloud-rain' };
  }
  if (i.bestKt >= SUMMARY_GOOD_KT && i.directionConsistency >= SUMMARY_STEADY_DIR) {
    return { text: `Buen dia para navegar — viento hasta ${kt}kt${when}, direccion estable.`, tone: 'good', icon: 'sailboat' };
  }
  if (i.bestKt >= SUMMARY_GOOD_KT) {
    return { text: `Viento suficiente (${kt}kt${i.bestTimeLabel ? `, ${i.bestTimeLabel}` : ''}) pero direccion inestable — cambios frecuentes.`, tone: 'mixed', icon: 'wind' };
  }
  if (i.bestKt >= SUMMARY_SOME_WIND_KT) {
    return { text: `Viento flojo (max ${kt}kt) — navegable para veleros ligeros/foils, insuficiente para quillados.`, tone: 'light', icon: 'wind' };
  }
  return { text: 'Sin viento significativo previsto — dia de calma.', tone: 'calm', icon: 'wind' };
}
