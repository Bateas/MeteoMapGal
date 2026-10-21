/**
 * The sea AT a spot, not at the open-ocean buoy it is read from.
 *
 * A spot's waves come from its `waveBuoys`, which are open-ocean buoys by policy (Cabo
 * Silleiro, 50 km out). On 21-oct Silleiro measured 3.4 m from the NW while the CESGA SWAN
 * model gave 2.1 m at Cíes-Ría (the islands shelter the south mouth from the NW) and the
 * webcam at Patos showed about a metre: a 3 m gate fed with the buoy closed a spot that was
 * open. Order of trust:
 *   1. SWAN at the spot's centre (physics, includes the islands' shelter), labelled as model;
 *   2. the buoy times the spot's `coastalFactor` (a provisional, documented estimate);
 *   3. the buoy itself (spots with no factor: behaviour as before).
 * Pure: the caller fetches SWAN (map hook, server job) and passes the number in.
 */
import type { SailingSpot } from '../config/spots';

export type LocalWaveSource = 'swan' | 'estimate' | 'buoy';

export interface LocalWave {
  heightM: number;
  source: LocalWaveSource;
}

/** SWAN above this would be a parse or model error at a coastal point. */
const SWAN_MAX_M = 15;

export function localWaveHeight(
  spot: Pick<SailingSpot, 'coastalFactor'>,
  buoyHeightM: number | null,
  swanHsM?: number | null,
): LocalWave | null {
  if (swanHsM != null && Number.isFinite(swanHsM) && swanHsM >= 0 && swanHsM < SWAN_MAX_M) {
    return { heightM: swanHsM, source: 'swan' };
  }
  if (buoyHeightM == null || !Number.isFinite(buoyHeightM)) return null;
  if (spot.coastalFactor != null && spot.coastalFactor > 0) {
    return { heightM: buoyHeightM * spot.coastalFactor, source: 'estimate' };
  }
  return { heightM: buoyHeightM, source: 'buoy' };
}
