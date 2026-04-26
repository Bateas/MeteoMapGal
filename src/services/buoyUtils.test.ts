/**
 * Tests for buoyUtils — color scales + WMO sea state mapping for marine data.
 *
 * Pure functions with no side effects. Used by BuoyMarker, BuoyPopup, BuoyPanel.
 * Bug here = wrong colors / wrong sea-state labels in user-facing UI.
 */

import { describe, it, expect } from 'vitest';
import {
  waveHeightColor,
  waveHeightClass,
  waterTempColor,
  waterTempClass,
  seaStateLabel,
  seaStateCode,
  currentSpeedColor,
  currentSpeedClass,
} from './buoyUtils';

// ── waveHeightColor ──────────────────────────────────────────

describe('waveHeightColor', () => {
  it('returns slate (no data) for null', () => {
    expect(waveHeightColor(null)).toBe('#64748b');
  });

  it('green for calm (<0.5m)', () => {
    expect(waveHeightColor(0)).toBe('#22c55e');
    expect(waveHeightColor(0.4)).toBe('#22c55e');
  });

  it('lime for slight (0.5-1m)', () => {
    expect(waveHeightColor(0.5)).toBe('#a3e635');
    expect(waveHeightColor(0.99)).toBe('#a3e635');
  });

  it('yellow for moderate (1-2m)', () => {
    expect(waveHeightColor(1.0)).toBe('#eab308');
    expect(waveHeightColor(1.5)).toBe('#eab308');
  });

  it('orange for rough (2-3m)', () => {
    expect(waveHeightColor(2.0)).toBe('#f97316');
    expect(waveHeightColor(2.9)).toBe('#f97316');
  });

  it('red for high (≥3m)', () => {
    expect(waveHeightColor(3.0)).toBe('#ef4444');
    expect(waveHeightColor(8.0)).toBe('#ef4444');
  });
});

// ── waveHeightClass ──────────────────────────────────────────

describe('waveHeightClass', () => {
  it('matches the same buckets as waveHeightColor', () => {
    expect(waveHeightClass(0.4)).toBe('text-green-400');
    expect(waveHeightClass(0.7)).toBe('text-lime-400');
    expect(waveHeightClass(1.5)).toBe('text-yellow-500');
    expect(waveHeightClass(2.5)).toBe('text-orange-400');
    expect(waveHeightClass(5.0)).toBe('text-red-400');
  });
});

// ── waterTempColor ───────────────────────────────────────────

describe('waterTempColor — Galician Atlantic 10-22°C', () => {
  it('returns slate for null', () => {
    expect(waterTempColor(null)).toBe('#64748b');
  });

  it('blue for cold (<12°C)', () => {
    expect(waterTempColor(11)).toBe('#3b82f6');
  });

  it('cyan for cool (12-15°C)', () => {
    expect(waterTempColor(13)).toBe('#06b6d4');
  });

  it('green for mild (15-18°C)', () => {
    expect(waterTempColor(16)).toBe('#22c55e');
  });

  it('yellow for warm (18-21°C)', () => {
    expect(waterTempColor(19)).toBe('#eab308');
  });

  it('orange for very warm (≥21°C)', () => {
    expect(waterTempColor(22)).toBe('#f97316');
  });
});

describe('waterTempClass', () => {
  it('blue/cyan/green/yellow/orange ladder', () => {
    expect(waterTempClass(10)).toBe('text-blue-400');
    expect(waterTempClass(13)).toBe('text-cyan-400');
    expect(waterTempClass(16)).toBe('text-green-400');
    expect(waterTempClass(20)).toBe('text-yellow-500');
    expect(waterTempClass(23)).toBe('text-orange-400');
  });
});

// ── WMO Sea State ────────────────────────────────────────────

describe('seaStateLabel — WMO codes 0-9', () => {
  it('returns "--" for null', () => {
    expect(seaStateLabel(null)).toBe('--');
  });

  it('maps 0m → Calma', () => {
    expect(seaStateLabel(0)).toBe('Calma');
  });

  it('maps 0.05m → Rizada', () => {
    expect(seaStateLabel(0.05)).toBe('Rizada');
  });

  it('maps 0.3m → Marejadilla', () => {
    expect(seaStateLabel(0.3)).toBe('Marejadilla');
  });

  it('maps 1.0m → Marejada', () => {
    expect(seaStateLabel(1.0)).toBe('Marejada');
  });

  it('maps 2.0m → Fuerte marejada', () => {
    expect(seaStateLabel(2.0)).toBe('Fuerte marejada');
  });

  it('maps 3.5m → Gruesa', () => {
    expect(seaStateLabel(3.5)).toBe('Gruesa');
  });

  it('maps 5m → Muy gruesa', () => {
    expect(seaStateLabel(5)).toBe('Muy gruesa');
  });

  it('maps 8m → Arbolada', () => {
    expect(seaStateLabel(8)).toBe('Arbolada');
  });

  it('maps 12m → Montañosa', () => {
    expect(seaStateLabel(12)).toBe('Montañosa');
  });

  it('maps >14m → Enorme', () => {
    expect(seaStateLabel(20)).toBe('Enorme');
  });
});

describe('seaStateCode — numeric WMO 0-9', () => {
  it('returns null for null input', () => {
    expect(seaStateCode(null)).toBeNull();
  });

  it('returns 0 for calm sea', () => {
    expect(seaStateCode(0)).toBe(0);
  });

  it('returns 4 for fuerte marejada (≈2m)', () => {
    expect(seaStateCode(2.0)).toBe(4);
  });

  it('returns 9 for extreme waves', () => {
    expect(seaStateCode(15)).toBe(9);
  });

  it('boundary: 1.25m → code 3 (Marejada upper edge)', () => {
    expect(seaStateCode(1.25)).toBe(3);
  });
});

// ── currentSpeedColor ────────────────────────────────────────

describe('currentSpeedColor — Galician rías 0-0.5 m/s', () => {
  it('returns slate for null', () => {
    expect(currentSpeedColor(null)).toBe('#64748b');
  });

  it('slate-400 for negligible (<0.05 m/s)', () => {
    expect(currentSpeedColor(0.02)).toBe('#94a3b8');
  });

  it('teal for gentle (0.05-0.1 m/s)', () => {
    expect(currentSpeedColor(0.07)).toBe('#2dd4bf');
  });

  it('cyan for moderate (0.1-0.2 m/s)', () => {
    expect(currentSpeedColor(0.15)).toBe('#06b6d4');
  });

  it('sky for strong (0.2-0.35 m/s)', () => {
    expect(currentSpeedColor(0.25)).toBe('#0284c7');
  });

  it('violet for very strong (≥0.35 m/s)', () => {
    expect(currentSpeedColor(0.5)).toBe('#7c3aed');
  });
});

describe('currentSpeedClass', () => {
  it('matches color buckets with Tailwind classes', () => {
    expect(currentSpeedClass(0.02)).toBe('text-slate-400');
    expect(currentSpeedClass(0.07)).toBe('text-teal-400');
    expect(currentSpeedClass(0.15)).toBe('text-cyan-400');
    expect(currentSpeedClass(0.30)).toBe('text-sky-500');
    expect(currentSpeedClass(0.50)).toBe('text-violet-500');
  });
});
