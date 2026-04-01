/**
 * AIS WebSocket lifecycle hook.
 * Connects when overlay is active + Rías sector.
 * Disconnects on tab hidden, sector switch, or toggle off.
 */
import { useEffect, useRef } from 'react';
import { useAISStore } from '../store/aisStore';
import { useSectorStore } from '../store/sectorStore';
import { connectAIS, disconnectAIS } from '../api/aisClient';

const PRUNE_INTERVAL_MS = 60_000; // prune stale vessels every 60s

export function useAISData() {
  const showOverlay = useAISStore((s) => s.showOverlay);
  const activeSector = useSectorStore((s) => s.activeSector);
  const enabled = showOverlay && activeSector.id === 'rias';
  const pruneRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled) {
      disconnectAIS();
      useAISStore.getState().setConnected(false);
      if (pruneRef.current) {
        clearInterval(pruneRef.current);
        pruneRef.current = null;
      }
      return;
    }

    const store = useAISStore.getState();

    connectAIS(
      (vessel) => {
        const s = useAISStore.getState();
        s.upsertVessel(vessel);
        s.addTrajectoryPoint(vessel.mmsi, {
          lat: vessel.lat,
          lon: vessel.lon,
          timestamp: vessel.lastUpdate,
          cog: vessel.cog,
          sog: vessel.sog,
        });
      },
      () => useAISStore.getState().setConnected(true),
      () => useAISStore.getState().setConnected(false),
      (err) => useAISStore.getState().setError(err),
    );

    // Prune stale vessels periodically
    pruneRef.current = setInterval(() => {
      useAISStore.getState().pruneStale();
    }, PRUNE_INTERVAL_MS);

    // Visibility handling — disconnect when tab hidden
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        disconnectAIS();
        useAISStore.getState().setConnected(false);
      } else if (document.visibilityState === 'visible') {
        connectAIS(
          (vessel) => {
            const s = useAISStore.getState();
            s.upsertVessel(vessel);
            s.addTrajectoryPoint(vessel.mmsi, {
              lat: vessel.lat,
              lon: vessel.lon,
              timestamp: vessel.lastUpdate,
              cog: vessel.cog,
              sog: vessel.sog,
            });
          },
          () => useAISStore.getState().setConnected(true),
          () => useAISStore.getState().setConnected(false),
          (err) => useAISStore.getState().setError(err),
        );
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      disconnectAIS();
      useAISStore.getState().setConnected(false);
      if (pruneRef.current) {
        clearInterval(pruneRef.current);
        pruneRef.current = null;
      }
    };
  }, [enabled]);
}
