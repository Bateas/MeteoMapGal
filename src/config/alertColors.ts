import type { AlertLevel } from '../types/thermal';

export const ALERT_COLORS: Record<AlertLevel, string> = {
  none: '#64748b',
  low: '#3b82f6',
  medium: '#f59e0b',
  high: '#ef4444',
};
