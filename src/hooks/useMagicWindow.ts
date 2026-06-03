/**
 * useMagicWindow — polls the ingestor magic-window endpoint for the active sector.
 *
 * T2-2 (S136+3+3). The detector runs on the backend every 5 min poll cycle
 * and persists a row when active. This hook reads the latest detection
 * (within 4h) and exposes it for a frontend banner / callout.
 *
 * Polling cadence: every 5 min — the detector runs at the same rate so faster
 * polling buys nothing. Visibility-aware so background tabs don't burn CPU.
 */
import { useEffect, useState } from 'react';
import { useVisibilityPolling } from './useVisibilityPolling';
import { useSectorStore } from '../store/sectorStore';
import { isCoastalSector } from '../config/sectors';

const POLL_INTERVAL_MS = 5 * 60 * 1000;

export interface MagicWindowStatus {
  active: boolean;
  sector: 'embalse' | 'rias';
  score?: number;
  summary?: string;
  estimatedHours?: number;
  detectedAt?: string;
}

async function fetchMagicWindow(sector: string): Promise<MagicWindowStatus | null> {
  try {
    const res = await fetch(`/api/v1/magic-window/latest?sector=${sector}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as MagicWindowStatus;
  } catch {
    return null;
  }
}

export function useMagicWindow(): MagicWindowStatus | null {
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const [status, setStatus] = useState<MagicWindowStatus | null>(null);

  // Reset on sector switch
  useEffect(() => {
    setStatus(null);
  }, [sectorId]);

  // Magic window (sea-breeze) only applies to coastal sectors — skip inland to save API calls
  const isCoastal = isCoastalSector(sectorId);
  useVisibilityPolling(async () => {
    const result = await fetchMagicWindow(sectorId);
    setStatus(result);
  }, POLL_INTERVAL_MS, isCoastal);

  return status;
}
