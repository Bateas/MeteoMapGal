import type { NormalizedStation } from '../types/station';

type SourceKey = NormalizedStation['source'];

export interface SourceMeta {
  label: string;       // Short badge label (A, MC, MG, WU, NT)
  fullName: string;    // Full display name
  color: string;       // Badge background color
}

export const SOURCE_CONFIG: Record<SourceKey, SourceMeta> = {
  aemet:         { label: 'A',  fullName: 'AEMET',               color: '#3b82f6' },
  meteogalicia:  { label: 'MG', fullName: 'MeteoGalicia',        color: '#8b5cf6' },
  meteoclimatic: { label: 'MC', fullName: 'Meteoclimatic',       color: '#10b981' },
  wunderground:  { label: 'WU', fullName: 'Weather Underground', color: '#f59e0b' },
  netatmo:       { label: 'NT', fullName: 'Netatmo',             color: '#06b6d4' },
  skyx:          { label: 'SX', fullName: 'SkyX',               color: '#ec4899' },
};
