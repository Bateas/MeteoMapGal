/**
 * Which air-quality stations the ICA overlay paints (IcaOverlay.tsx).
 *
 * The overlay turns on when any Galician station reaches ICA 3 («Deficiente»), and it must paint
 * only those: the ones that turned it on. It used to paint every station from 2.8 up, all in the
 * «Deficiente» orange. On 29-sep a station 130 km inland reached 3.0 and switched it on, and Coia
 * (2.8, «Moderada», most likely sea salt from the south-westerly gale) covered the whole ría de
 * Vigo in orange.
 */
export const ICA_ACTIVATION_THRESHOLD = 3;

export function stationsToPaint<T extends { ica: number }>(readings: T[]): T[] {
  return readings.filter((r) => Number.isFinite(r.ica) && r.ica >= ICA_ACTIVATION_THRESHOLD);
}
