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

export type WaterMassType = 'acna' | 'fluvial' | 'surface_warm' | 'transitional' | 'unknown';

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

  // Pure ACNA (Upwelled deep North Atlantic Central Water):
  // Typically <= 14.5°C, or <= 15.0°C when accompanied by high oceanic salinity (>= 35 PSU)
  const isColdDeepWater = (tempC != null && tempC <= 14.5) ||
    (tempC != null && tempC <= 15.0 && salinityPsu != null && salinityPsu >= 35.0);

  if (isColdDeepWater) {
    const salStr = salinityPsu != null ? ` (${salinityPsu.toFixed(1)} PSU)` : '';
    return {
      type: 'acna',
      label: 'Agua Profunda ACNA',
      badgeText: '🌊 Afloramiento ACNA',
      description: `Agua fría profunda oceánica rica en nutrientes${salStr}. Afloramiento activo.`,
      color: '#38bdf8', // sky-400
      bg: 'rgba(14, 165, 233, 0.15)',
      borderColor: 'rgba(56, 189, 248, 0.4)',
    };
  }

  // Estuarine / river runoff influence: low salinity (< 33 PSU)
  if (salinityPsu != null && salinityPsu < 33.0) {
    return {
      type: 'fluvial',
      label: 'Influencia Fluvial / Estuario',
      badgeText: '💧 Agua de Estuario',
      description: `Agua salobre con aporte de río (${salinityPsu.toFixed(1)} PSU). Capa superficial estuarina.`,
      color: '#a3e635', // lime-400
      bg: 'rgba(163, 230, 53, 0.12)',
      borderColor: 'rgba(163, 230, 53, 0.35)',
    };
  }

  // Warm surface water (late summer / relaxed conditions without upwelling)
  if (tempC != null && tempC >= 17.0) {
    return {
      type: 'surface_warm',
      label: 'Atlántica Superficial Templada',
      badgeText: '☀️ Superficial Templada',
      description: `Agua superficial templada (${tempC.toFixed(1)}°C). Afloramiento inactivo o en reposo.`,
      color: '#fbbf24', // amber-400
      bg: 'rgba(251, 191, 36, 0.12)',
      borderColor: 'rgba(251, 191, 36, 0.35)',
    };
  }

  // Standard coastal mix (14.6 - 16.9°C)
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
export function detectUpwellingSummary(buoys: BuoyReading[]): UpwellingSummary {
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
      ? ` · Frente térmico Δ${thermalFront.deltaT}°C en bocana`
      : '';
    tickerMessage = `Afloramiento (Upwelling): agua a ${coldest.temp.toFixed(1)}°C en ${coldest.name}${frontSnippet}`;
    fishingAdvice = thermalFront
      ? `Frente térmico activo (${innerTemp?.temp.toFixed(1)}°C ría vs ${outerTemp?.temp.toFixed(1)}°C exterior): pique óptimo de calamar al atardecer y caballas en bocana.`
      : `Agua fría oxigenada (${coldest.temp.toFixed(1)}°C): calamar (lura) muy activo. Pescadores: buscar capas medias y zonas de corriente.`;
  }

  return {
    hasUpwelling,
    coldestBuoy: coldest,
    thermalFront,
    tickerMessage,
    fishingAdvice,
  };
}
