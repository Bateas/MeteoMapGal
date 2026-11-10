/**
 * The measured lightning state around the active sector's point (services/lightningStatus.ts),
 * for the toolbar chip, the ticker and the field panel. Recomputed with every lightning poll.
 */
import { useMemo } from 'react';
import { useLightningStore } from './useLightningData';
import { useSectorStore } from '../store/sectorStore';
import { lightningStatus, type LightningStatus } from '../services/lightningStatus';

export function useLightningStatus(): LightningStatus {
  const strikes = useLightningStore((s) => s.strikes);
  const level = useLightningStore((s) => s.stormAlert.level);
  const lastFetch = useLightningStore((s) => s.lastFetch);
  const center = useSectorStore((s) => s.activeSector.center); // [lon, lat]
  // lastFetch is a dependency on purpose: a poll that brings the same strikes still ages them.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => lightningStatus(strikes, center[1], center[0], level, Date.now()), [strikes, level, center, lastFetch]);
}
