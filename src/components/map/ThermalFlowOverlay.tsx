/**
 * ThermalFlowOverlay — DISABLED (#57).
 *
 * Attempted: arrow points along valley SW→NE axis.
 * Result: adds zero information. User already knows thermal direction.
 * Ticker, zone alerts, station wind arrows, and propagation arrows
 * already convey all thermal info needed.
 *
 * Keeping file for lazy import compatibility.
 */
import { memo } from 'react';

function ThermalFlowOverlayInner() {
  return null;
}

export const ThermalFlowOverlay = memo(ThermalFlowOverlayInner);
