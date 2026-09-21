/**
 * Upwelling and Water Mass Detector for Galician Rías Baixas.
 *
 * Oceanographic context:
 * - Upwelling (Afloramiento costero): Northerly winds (Nordés) drive offshore
 *   Ekman transport. Subsurface Eastern North Atlantic Central Water (ACNA)
 *   ascends into the rías from depths of 100-200m at 12–14.5°C with high
 *   salinity (35.5–35.8 PSU) and high nutrient content (nitrates/phosphates).
 * - Estuarine water: Diluted surface layer with river runoff (Ulla, Verdugo)
 *   characterised by lower salinity (< 33 PSU).
 * - Thermal fronts: Strong temperature gradients (≥ 2.5°C) between open ocean
 *   (e.g. Cabo Silleiro) and upwelled ría waters (e.g. Rande / Cortegada),
 *   creating convergence zones with high food density (xouba, squid, mackerel).
 */
import type { BuoyReading } from '../api/buoyClient';
import { isBuoyFresh, BUOY_WATER_MAX_MIN } from './buoyUtils';

export type WaterMassType = 'acna' | 'fluvial' | 'surface_warm' | 'transitional' | 'anomaly' | 'unknown';

export interface WaterMassInfo {
  type: WaterMassType;
  label: string;
  badgeText: string;
  description: string;
  color: string;
  bg: string;
  borderColor: string;
}

/**
 * Classify water mass from temperature and salinity measurements.
 */
export function classifyWaterMass(tempC: number | null, salinityPsu: number | null): WaterMassInfo {
  if (tempC == null && salinityPsu == null) {
    return {
      type: 'unknown',
      label: 'Sin datos marinos',
      badgeText: 'Sin datos',
      description: 'Sensor de agua no disponible en esta baliza',
      color: '#94a3b8',
      bg: 'rgba(148, 163, 184, 0.1)',
      borderColor: 'rgba(148, 163, 184, 0.25)',
    };
  }

  // 1. Physical sensor anomaly / glitch
  // In Galician coastal rías, sea temperature < 10.5°C or > 28°C is unphysical (sensor malfunction / in air)
  if (tempC != null && (tempC < 10.5 || tempC > 28.0)) {
    return {
      type: 'anomaly',
      label: 'Medición Anómala',
      badgeText: 'Sensor en revisión',
      description: `Temperatura fuera de rango físico de ría (${tempC.toFixed(1)}°C). Posible anomalía o mantenimiento de sonda.`,
      color: '#f59e0b', // amber-500
      bg: 'rgba(245, 158, 11, 0.12)',
      borderColor: 'rgba(245, 158, 11, 0.35)',
    };
  }

  // 2. Estuarine / river runoff influence: low salinity (< 33 PSU)
  // Must be checked BEFORE ACNA: estuarine water can NEVER be deep oceanic ACNA
  if (salinityPsu != null && salinityPsu < 33.0) {
    return {
      type: 'fluvial',
      label: 'Influencia Fluvial / Estuario',
      badgeText: 'Agua de Estuario',
      description: `Agua salobre con aporte de río (${salinityPsu.toFixed(1)} PSU). Capa superficial estuarina.`,
      color: '#a3e635', // lime-400
      bg: 'rgba(163, 230, 53, 0.12)',
      borderColor: 'rgba(163, 230, 53, 0.35)',
    };
  }

  // 3. Pure ACNA (Upwelled deep Eastern North Atlantic Central Water):
  // Typically 11.0–14.8°C with oceanic salinity (>= 34.5 PSU, typically 35.5–35.8 PSU).
  // Salinity must NOT be estuarine (< 33 PSU), and temp must be >= 10.5°C (not a glitch).
  const isAcna = tempC != null && tempC >= 10.5 && (
    tempC <= 14.5 || (tempC <= 14.8 && salinityPsu != null && salinityPsu >= 34.5)
  ) && (salinityPsu == null || salinityPsu >= 33.0);

  if (isAcna) {
    const salStr = salinityPsu != null ? ` (${salinityPsu.toFixed(1)} PSU)` : '';
    return {
      type: 'acna',
      label: 'Agua Profunda ACNA',
      badgeText: 'Afloramiento ACNA',
      description: `Agua fría profunda oceánica rica en nutrientes${salStr}. Afloramiento activo.`,
      color: '#38bdf8', // sky-400
      bg: 'rgba(14, 165, 233, 0.15)',
      borderColor: 'rgba(56, 189, 248, 0.4)',
    };
  }

  // 4. Warm surface water (late summer / relaxed conditions without upwelling)
  if (tempC != null && tempC >= 17.0) {
    return {
      type: 'surface_warm',
      label: 'Atlántica Superficial Templada',
      badgeText: 'Superficial Templada',
      description: `Agua superficial templada (${tempC.toFixed(1)}°C). Afloramiento inactivo o en reposo.`,
      color: '#fbbf24', // amber-400
      bg: 'rgba(251, 191, 36, 0.12)',
      borderColor: 'rgba(251, 191, 36, 0.35)',
    };
  }

  // 5. Standard coastal mix (14.6 - 16.9°C)
  return {
    type: 'transitional',
    label: 'Agua Costera Mixta',
    badgeText: 'Agua Costera',
    description: `Mezcla estándar de ría (${tempC != null ? `${tempC.toFixed(1)}°C` : '--'}). Condiciones neutras.`,
    color: '#2dd4bf', // teal-400
    bg: 'rgba(45, 212, 191, 0.12)',
    borderColor: 'rgba(45, 212, 191, 0.35)',
  };
}

export interface UpwellingSummary {
  hasUpwelling: boolean;
  coldestBuoy: { stationId: number; name: string; temp: number } | null;
  thermalFront: {
    deltaT: number;
    outerStation: string;
    outerTemp: number;
    innerStation: string;
    innerTemp: number;
  } | null;
  tickerMessage: string | null;
  fishingAdvice: string | null;
}

// Outer oceanic station IDs (deep-water / coastal outer boundary)
const OUTER_STATION_IDS = new Set([2248, 1255]); // Cabo Silleiro, Ribeira
// Inner ría / coastal station IDs
const INNER_STATION_IDS = new Set([1251, 1250, 1253]); // Rande, Cortegada, A Guarda

/**
 * Detect upwelling events and thermal fronts across coastal buoy readings.
 */
export function detectUpwellingSummary(buoys: BuoyReading[], now: number = Date.now()): UpwellingSummary {
  if (!buoys || buoys.length === 0) {
    return {
      hasUpwelling: false,
      coldestBuoy: null,
      thermalFront: null,
      tickerMessage: null,
      fishingAdvice: null,
    };
  }

  // Find valid water temperatures
  let coldest: { stationId: number; name: string; temp: number } | null = null;
  let outerTemp: { name: string; temp: number } | null = null;
  let innerTemp: { name: string; temp: number } | null = null;

  for (const b of buoys) {
    if (b.waterTemp == null) continue;
    // A buoy that stopped publishing keeps its last reading on the map; it
    // cannot tell us about upwelling happening now.
    if (!isBuoyFresh(b, BUOY_WATER_MAX_MIN, now)) continue;
    // Exclude sensor glitches (< 10.5°C or > 28°C) and estuarine river plumes (< 33.0 PSU)
    // from triggering coastal upwelling alerts or false thermal fronts
    if (b.waterTemp < 10.5 || b.waterTemp > 28.0) continue;
    if (b.salinity != null && b.salinity < 33.0) continue;

    if (!coldest || b.waterTemp < coldest.temp) {
      coldest = { stationId: b.stationId, name: b.stationName, temp: b.waterTemp };
    }

    if (OUTER_STATION_IDS.has(b.stationId)) {
      if (!outerTemp || b.waterTemp > outerTemp.temp) {
        outerTemp = { name: b.stationName, temp: b.waterTemp };
      }
    }

    if (INNER_STATION_IDS.has(b.stationId)) {
      if (!innerTemp || b.waterTemp < innerTemp.temp) {
        innerTemp = { name: b.stationName, temp: b.waterTemp };
      }
    }
  }

  const hasUpwelling = coldest != null && coldest.temp <= 14.8;

  let thermalFront: UpwellingSummary['thermalFront'] = null;
  if (outerTemp && innerTemp) {
    const deltaT = Math.round((outerTemp.temp - innerTemp.temp) * 10) / 10;
    if (deltaT >= 2.2) {
      thermalFront = {
        deltaT,
        outerStation: outerTemp.name,
        outerTemp: outerTemp.temp,
        innerStation: innerTemp.name,
        innerTemp: innerTemp.temp,
      };
    }
  }

  let tickerMessage: string | null = null;
  let fishingAdvice: string | null = null;

  if (hasUpwelling && coldest) {
    const frontSnippet = thermalFront
      ? ` · Frente térmico en bocana (Δ${thermalFront.deltaT}°C)`
      : '';
    tickerMessage = `Afloramiento: agua a ${coldest.temp.toFixed(1)}°C en ${coldest.name}${frontSnippet}`;
    fishingAdvice = thermalFront
      ? `Calamar (lura) activo en ría y caballa (xarda) en bocanas por frente térmico (Δ${thermalFront.deltaT}°C)`
      : `Calamar (lura) muy activo en ría por agua fría y oxigenada (${coldest.temp.toFixed(1)}°C)`;
  }

  return {
    hasUpwelling,
    coldestBuoy: coldest,
    thermalFront,
    tickerMessage,
    fishingAdvice,
  };
}
