/** AIS ship tracking types */

export type VesselType = 'cargo' | 'ferry' | 'sailing' | 'fishing' | 'other';

export interface TrajectoryPoint {
  lat: number;
  lon: number;
  timestamp: number;
  cog: number; // Course over ground (degrees)
  sog: number; // Speed over ground (knots)
}

export interface Vessel {
  mmsi: number;
  name: string;
  type: VesselType;
  lat: number;
  lon: number;
  cog: number;
  heading: number; // True heading (degrees). 511 = unavailable → use cog
  sog: number; // Speed over ground (knots)
  destination: string;
  lastUpdate: number; // timestamp ms
}

/** Map AIS shipType integer (ITU-R M.1371-5 Table 53) to VesselType */
export function mapShipType(aisType: number): VesselType {
  if (aisType === 30) return 'fishing';
  if (aisType >= 36 && aisType <= 37) return 'sailing';
  if (aisType >= 60 && aisType <= 69) return 'ferry';
  if (aisType >= 70 && aisType <= 79) return 'cargo';
  return 'other';
}

/** Vessel type display colors */
export const VESSEL_COLORS: Record<VesselType, string> = {
  cargo: '#94a3b8',   // slate-400
  ferry: '#3b82f6',   // blue-500
  sailing: '#22c55e', // green-500
  fishing: '#eab308', // yellow-500
  other: '#a78bfa',   // violet-400
};

/** Vessel type labels (Spanish) */
export const VESSEL_LABELS: Record<VesselType, string> = {
  cargo: 'Carga',
  ferry: 'Ferry',
  sailing: 'Velero',
  fishing: 'Pesca',
  other: 'Otro',
};
