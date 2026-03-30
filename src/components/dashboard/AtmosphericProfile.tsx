/**
 * AtmosphericProfile — Compact vertical profile of atmospheric stability.
 *
 * Shows key parameters for thermal soaring assessment:
 * - Boundary Layer Height (mixing depth)
 * - CAPE (convective available potential energy)
 * - CIN (convective inhibition)
 * - Lifted Index (stability)
 * - Cloud cover + solar radiation
 *
 * Data comes from thermalStore.atmosphericContext (Open-Meteo model data).
 * Only shown in Embalse sector (thermal sailing context).
 */

import { memo, useMemo } from 'react';
import { useThermalStore } from '../../store/thermalStore';
import type { AtmosphericContext } from '../../types/thermal';

// ── Atmospheric gauge colors ─────────────────────────────

function capeColor(cape: number): string {
  if (cape >= 1000) return '#ef4444'; // strong convection
  if (cape >= 500) return '#f59e0b';  // moderate
  if (cape >= 200) return '#22c55e';  // light
  return '#64748b';                   // weak
}

function capeLabel(cape: number): string {
  if (cape >= 1000) return 'Fuerte';
  if (cape >= 500) return 'Moderada';
  if (cape >= 200) return 'Ligera';
  return 'Débil';
}

function blhColor(blh: number): string {
  if (blh >= 2000) return '#22c55e';  // excellent thermals
  if (blh >= 1500) return '#34d399';  // good
  if (blh >= 1000) return '#f59e0b';  // moderate
  if (blh >= 500) return '#fb923c';   // limited
  return '#64748b';                   // very low
}

function blhLabel(blh: number): string {
  if (blh >= 2000) return 'Excelente';
  if (blh >= 1500) return 'Buena';
  if (blh >= 1000) return 'Moderada';
  if (blh >= 500) return 'Limitada';
  return 'Muy baja';
}

function liColor(li: number): string {
  if (li <= -6) return '#ef4444';     // very unstable (storms)
  if (li <= -2) return '#f59e0b';     // unstable (thermals)
  if (li <= 0) return '#22c55e';      // slightly unstable
  if (li <= 2) return '#64748b';      // neutral
  return '#3b82f6';                   // stable
}

function liLabel(li: number): string {
  if (li <= -6) return 'Muy inestable';
  if (li <= -2) return 'Inestable';
  if (li <= 0) return 'Lig. inestable';
  if (li <= 2) return 'Neutral';
  return 'Estable';
}

function cinColor(cin: number): string {
  if (cin <= 20) return '#22c55e';    // free convection
  if (cin <= 50) return '#34d399';    // easy triggering
  if (cin <= 100) return '#f59e0b';   // moderate cap
  if (cin <= 200) return '#fb923c';   // strong cap
  return '#ef4444';                   // very strong cap
}

function cinLabel(cin: number): string {
  if (cin <= 20) return 'Libre';
  if (cin <= 50) return 'Fácil';
  if (cin <= 100) return 'Moderado';
  if (cin <= 200) return 'Fuerte';
  return 'Muy fuerte';
}

// ── Stability assessment ─────────────────────────────────

interface StabilityAssessment {
  label: string;
  color: string;
  description: string;
}

function assessStability(ctx: AtmosphericContext): StabilityAssessment {
  const cape = ctx.cape ?? 0;
  const cin = ctx.convectiveInhibition ?? 0;
  const li = ctx.liftedIndex ?? 0;
  const blh = ctx.boundaryLayerHeight ?? 0;

  // Storm risk
  if (cape >= 1000 && li <= -4) {
    return {
      label: 'Convección',
      color: '#ef4444',
      description: 'Convección fuerte probable. Riesgo de tormenta.',
    };
  }

  // Excellent thermals
  if (blh >= 1500 && cape >= 200 && cin <= 50 && li <= 0) {
    return {
      label: 'Excelente',
      color: '#22c55e',
      description: 'Capa de mezcla profunda, baja inhibición. Térmicas potentes.',
    };
  }

  // Good thermals
  if (blh >= 1000 && cin <= 100 && li <= 2) {
    return {
      label: 'Buena',
      color: '#34d399',
      description: 'Condiciones favorables para térmicas moderadas.',
    };
  }

  // Marginal
  if (blh >= 500 || (cape >= 100 && cin <= 150)) {
    return {
      label: 'Marginal',
      color: '#f59e0b',
      description: 'Capa de mezcla limitada. Térmicas débiles o esporádicas.',
    };
  }

  // Stable
  return {
    label: 'Estable',
    color: '#3b82f6',
    description: 'Atmósfera estable. Sin actividad convectiva significativa.',
  };
}

// ── Component ────────────────────────────────────────────

export const AtmosphericProfile = memo(function AtmosphericProfile() {
  const ctx = useThermalStore((s) => s.atmosphericContext);

  const assessment = useMemo(() => {
    if (!ctx) return null;
    return assessStability(ctx);
  }, [ctx]);

  if (!ctx) {
    return (
      <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-slate-200">Perfil Atmosférico</span> <span className="badge-beta">Beta</span>
          <span className="text-[11px] text-slate-500 ml-auto">Cargando...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-700/40 bg-slate-800/20 p-2.5 space-y-2">
      {/* Header + stability badge */}
      <div className="flex items-center gap-2">
        <div>
          <span className="text-[11px] font-bold text-slate-200">Perfil Atmosférico</span> <span className="badge-beta">Beta</span>
          <span className="text-[11px] text-slate-600 ml-1">(convección)</span>
        </div>
        {assessment && (
          <span
            className="text-[11px] font-bold px-1.5 py-0.5 rounded ml-auto"
            style={{
              color: assessment.color,
              background: `${assessment.color}15`,
              border: `1px solid ${assessment.color}30`,
            }}
          >
            {assessment.label}
          </span>
        )}
      </div>

      {assessment && (
        <p className="text-[11px] text-slate-400 leading-snug">
          {assessment.description}
          {assessment.label === 'Marginal' && (
            <span className="text-slate-600"> Este valor mide condiciones de convección, no viento para navegar.</span>
          )}
        </p>
      )}

      {/* Vertical profile visualization */}
      <ProfileBar ctx={ctx} />

      {/* Parameter rows */}
      <div className="space-y-1">
        {ctx.boundaryLayerHeight !== null && (
          <ParamRow
            label="Capa mezcla"
            value={`${Math.round(ctx.boundaryLayerHeight)}m`}
            color={blhColor(ctx.boundaryLayerHeight)}
            badge={blhLabel(ctx.boundaryLayerHeight)}
            tooltip="Altura de la capa límite planetaria. >1500m = térmicas fuertes."
          />
        )}
        {ctx.cape !== null && (
          <ParamRow
            label="CAPE"
            value={`${Math.round(ctx.cape)} J/kg`}
            color={capeColor(ctx.cape)}
            badge={capeLabel(ctx.cape)}
            tooltip="Energía potencial convectiva. >500 = convección moderada."
          />
        )}
        {ctx.convectiveInhibition !== null && (
          <ParamRow
            label="CIN"
            value={`${Math.round(ctx.convectiveInhibition)} J/kg`}
            color={cinColor(ctx.convectiveInhibition)}
            badge={`Cap ${cinLabel(ctx.convectiveInhibition)}`}
            tooltip="Inhibición convectiva. >200 = capa de bloqueo fuerte."
          />
        )}
        {ctx.liftedIndex !== null && (
          <ParamRow
            label="Lifted Idx"
            value={`${ctx.liftedIndex.toFixed(1)}°C`}
            color={liColor(ctx.liftedIndex)}
            badge={liLabel(ctx.liftedIndex)}
            tooltip="Índice de elevación. Negativo = inestable. <-2 = térmicas."
          />
        )}
        {ctx.cloudCover !== null && (
          <ParamRow
            label="Nubes"
            value={`${Math.round(ctx.cloudCover)}%`}
            color={ctx.cloudCover < 30 ? '#22c55e' : ctx.cloudCover < 60 ? '#f59e0b' : '#ef4444'}
            badge={ctx.cloudCover < 30 ? 'Despejado' : ctx.cloudCover < 60 ? 'Parcial' : 'Cubierto'}
          />
        )}
        {ctx.solarRadiation !== null && (
          <ParamRow
            label="Radiación"
            value={`${Math.round(ctx.solarRadiation)} W/m²`}
            color={ctx.solarRadiation > 600 ? '#22c55e' : ctx.solarRadiation > 300 ? '#f59e0b' : '#64748b'}
            badge={ctx.solarRadiation > 600 ? 'Fuerte' : ctx.solarRadiation > 300 ? 'Moderada' : 'Débil'}
          />
        )}
      </div>

      {/* Timestamp */}
      {ctx.fetchedAt && (
        <div className="text-[11px] text-slate-600 text-right pt-0.5">
          Datos: {ctx.fetchedAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
    </div>
  );
});

// ── Sub-components ────────────────────────────────────────

function ParamRow({ label, value, color, badge, tooltip }: {
  label: string;
  value: string;
  color: string;
  badge: string;
  tooltip?: string;
}) {
  return (
    <div className="flex items-center gap-1.5" title={tooltip}>
      <span className="text-[11px] text-slate-500 w-16 flex-shrink-0">{label}</span>
      <span className="text-[11px] font-bold font-mono flex-shrink-0" style={{ color }}>{value}</span>
      <span
        className="text-[11px] font-semibold px-1 py-px rounded ml-auto"
        style={{ color, background: `${color}15` }}
      >
        {badge}
      </span>
    </div>
  );
}

/** Mini vertical profile bar — shows BLH height relative to common scale */
function ProfileBar({ ctx }: { ctx: AtmosphericContext }) {
  const blh = ctx.boundaryLayerHeight ?? 0;
  const cape = ctx.cape ?? 0;
  const cin = ctx.convectiveInhibition ?? 0;

  // Scale: 0-3000m
  const maxAlt = 3000;
  const blhPct = Math.min(100, (blh / maxAlt) * 100);
  const cinBarH = Math.min(20, (cin / 200) * 20); // CIN as a cap bar (0-20px)

  return (
    <div className="relative h-16 w-full rounded bg-gradient-to-t from-slate-800 to-slate-900 overflow-hidden border border-slate-700/30">
      {/* BLH fill — gradient from warm base to cool top */}
      <div
        className="absolute bottom-0 left-0 right-0 transition-all duration-700"
        style={{
          height: `${blhPct}%`,
          background: cape >= 500
            ? 'linear-gradient(to top, rgba(245,158,11,0.15), rgba(239,68,68,0.10))'
            : 'linear-gradient(to top, rgba(34,197,94,0.12), rgba(34,197,94,0.03))',
        }}
      />

      {/* CIN cap bar at top of BLH */}
      {cin > 20 && (
        <div
          className="absolute left-0 right-0 transition-all duration-500"
          style={{
            bottom: `${blhPct}%`,
            height: `${cinBarH}px`,
            background: 'rgba(239,68,68,0.2)',
            borderTop: '1px solid rgba(239,68,68,0.4)',
          }}
        />
      )}

      {/* BLH label */}
      <div
        className="absolute left-1 text-[11px] font-mono transition-all duration-500"
        style={{
          bottom: `${blhPct}%`,
          transform: 'translateY(50%)',
          color: blhColor(blh),
        }}
      >
        ─ {Math.round(blh)}m
      </div>

      {/* Altitude scale on right */}
      <div className="absolute right-1 top-0 bottom-0 flex flex-col justify-between py-0.5">
        <span className="text-[11px] text-slate-600 font-mono">3km</span>
        <span className="text-[11px] text-slate-600 font-mono">0</span>
      </div>

      {/* Ground label */}
      <div className="absolute bottom-0.5 left-1 text-[11px] text-slate-600">
        SUP
      </div>
    </div>
  );
}
