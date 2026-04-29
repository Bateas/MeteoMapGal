/**
 * useConvectionAutoActivate — auto-toggles the convection risk overlay when
 * the atmosphere is loaded (CAPE × -LI threshold crossed in next 6 h).
 *
 * Why: the grid only fetches when the toggle is ON (to avoid burning Open-
 * Meteo quota), but for storm days we want users to see the heat map without
 * having to discover the toggle. Solution: piggyback on `forecastStore`'s
 * `convectionData` (single-point sector center, polled every 30 min by
 * `useForecastTimeline`), which is essentially free — it's already running.
 *
 * If sector-center peak risk ≥ ACTIVATE_THRESHOLD over the next 6 h, we flip
 * the overlay ON. If the user manually toggles it OFF, we mark "dismissed
 * today" so we don't re-activate the same day. The flag resets at midnight
 * (per-day key in localStorage).
 *
 * Run-once lifecycle: mount this hook ONCE in the app layer.
 */
import { useEffect, useRef } from 'react';
import { useForecastStore } from './useForecastTimeline';
import { useMapStyleStore } from '../store/mapStyleStore';

/**
 * Threshold for auto-activation. CAPE × -LI / 1000 score:
 *   - 1000 J/kg × LI -2 = 2.0  (modest — don't auto)
 *   - 1500 × -3 = 4.5  (moderate, granizo posible territory — activate)
 *   - 2000 × -4 = 8    (high — clearly activate)
 *
 * 4.0 picks up "moderate-to-strong" without nagging on edge cases.
 */
const ACTIVATE_THRESHOLD = 4;

/** Look-ahead window: 6 h forward from now (typical convective day cycle). */
const LOOK_AHEAD_HOURS = 6;
/** Tolerate 1 h of past data so we activate during ongoing events too. */
const LOOK_BACK_HOURS = 1;

const DISMISSED_KEY = 'meteomap-convection-auto-dismissed-date';

function todayLocalKey(): string {
  // Local-date key (YYYY-MM-DD). Day rolls at midnight per user's timezone,
  // which is the right behaviour for "I dismissed this for today".
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function wasDismissedToday(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === todayLocalKey();
  } catch {
    return false; // SSR / private mode
  }
}

function markDismissedToday(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, todayLocalKey());
  } catch {
    // ignore (private mode / disabled storage)
  }
}

export function useConvectionAutoActivate(): void {
  const convectionData = useForecastStore((s) => s.convectionData);
  const showRisk = useMapStyleStore((s) => s.showConvectionRisk);
  const toggle = useMapStyleStore((s) => s.toggleConvectionRisk);

  // Track previous toggle state to detect "user just turned it OFF"
  const prevShowRiskRef = useRef(showRisk);

  // Mark dismissed when user explicitly toggles OFF.
  useEffect(() => {
    if (prevShowRiskRef.current === true && showRisk === false) {
      markDismissedToday();
    }
    prevShowRiskRef.current = showRisk;
  }, [showRisk]);

  // Auto-activate when convective potential crosses threshold.
  useEffect(() => {
    if (showRisk) return; // already on, nothing to do
    if (wasDismissedToday()) return; // user opted out for today
    if (!convectionData || convectionData.length === 0) return;

    const now = Date.now();
    let peakRisk = 0;

    for (const f of convectionData) {
      const dt = (f.time.getTime() - now) / 3_600_000; // hours
      if (dt < -LOOK_BACK_HOURS) continue;
      if (dt > LOOK_AHEAD_HOURS) continue;
      if (f.cape == null || f.liftedIndex == null) continue;
      if (f.liftedIndex >= 0) continue; // need negative LI for instability
      const score = (f.cape * -f.liftedIndex) / 1000;
      if (score > peakRisk) peakRisk = score;
    }

    if (peakRisk >= ACTIVATE_THRESHOLD) {
      toggle();
    }
    // Note: convectionData updates every 30 min via useForecastTimeline. As the
    // day evolves, if a new high peak appears the effect re-runs and we can
    // toggle on (unless dismissed). If user dismisses, we stop until tomorrow.
  }, [convectionData, showRisk, toggle]);
}
