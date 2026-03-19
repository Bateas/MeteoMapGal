/**
 * Unified Alert Service — thin re-export barrel.
 *
 * All alert logic has been modularized into src/services/alerts/.
 * This file re-exports everything for backward compatibility so
 * NO consumer files need to change their imports.
 *
 * @see ./alerts/types.ts        — Shared types (AlertSeverity, UnifiedAlert, CompositeRisk, etc.)
 * @see ./alerts/stormAlerts.ts   — buildStormAlerts(), buildStormShadowAlerts()
 * @see ./alerts/thermalAlerts.ts — buildThermalAlerts(), buildInversionAlerts()
 * @see ./alerts/fieldAlerts.ts   — buildFieldAlerts(), campoLevelToScore()
 * @see ./alerts/riskEngine.ts    — computeCompositeRisk(), severityFromScore(), colorFromSeverity()
 * @see ./alerts/aggregator.ts    — aggregateAllAlerts(), deduplicateByCategory(), enrichPressureAlerts()
 */

export * from './alerts/types';
export * from './alerts/riskEngine';
export * from './alerts/stormAlerts';
export * from './alerts/thermalAlerts';
export * from './alerts/fieldAlerts';
export * from './alerts/aggregator';
