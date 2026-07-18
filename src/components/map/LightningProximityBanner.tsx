/**
 * LightningProximityBanner — "rayo a X km de TU spot", the visible half of
 * the LOCAL lightning safety feature.
 *
 * Auto-shows when observed cloud-to-ground strikes put a spot of the active
 * sector at risk (reactive overlay: observation-based, so auto-activation is
 * allowed). Sits in its own slot BELOW CriticalAlertBanner so both can show
 * during a severe storm without overlapping.
 *
 * Click selects the affected spot — the popup gives the full local picture.
 */

import { memo } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useSpotStore } from '../../store/spotStore';
import { useSpotLightningRisk } from '../../hooks/useSpotLightningRisk';
import { WeatherIcon } from '../icons/WeatherIcons';

export const LightningProximityBanner = memo(function LightningProximityBanner() {
  const isMobile = useUIStore((s) => s.isMobile);
  const selectSpot = useSpotStore((s) => s.selectSpot);
  const risks = useSpotLightningRisk();

  if (risks.length === 0) return null;

  const top = risks[0];
  const danger = top.level === 'peligro';

  const kmTxt = top.nearestKm < 1 ? '<1 km' : `${Math.round(top.nearestKm)} km`;
  const title = danger
    ? `RAYO A ${kmTxt.toUpperCase()} — ${top.spotName.toUpperCase()}`
    : `Rayos a ${kmTxt} — ${top.spotName}`;

  let subtitle = `${top.count25} impactos en 20 min`;
  if (top.approaching) {
    subtitle += top.etaMin != null ? ` · acercándose ~${top.etaMin} min` : ' · acercándose';
  }
  if (danger) subtitle += ' · sal del agua';
  const others = risks.length - 1;

  const accent = danger ? '239, 68, 68' : '245, 158, 11';
  const textColor = danger ? '#ef4444' : '#f59e0b';

  return (
    <div
      className={`${isMobile ? 'fixed z-30 top-[7rem]' : 'absolute z-30 top-14'} left-1/2 -translate-x-1/2 pointer-events-auto`}
      role="alert"
      aria-live="assertive"
    >
      <div
        className={`flex items-center rounded-lg font-semibold shadow-lg cursor-pointer
          ${danger ? 'animate-pulse' : ''}
          ${isMobile ? 'gap-1.5 px-3 py-1.5 max-w-[calc(100vw-2rem)]' : 'gap-2.5 px-4 py-2'}`}
        style={{
          background: `rgba(${accent}, ${danger ? 0.20 : 0.14})`,
          border: `1px solid rgba(${accent}, 0.55)`,
          color: textColor,
          boxShadow: `0 0 20px rgba(${accent}, 0.35), 0 4px 16px rgba(0, 0, 0, 0.4)`,
        }}
        onClick={() => selectSpot(top.spotId)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectSpot(top.spotId); }
        }}
        tabIndex={0}
        role="button"
        title="Ver el spot afectado"
      >
        <WeatherIcon id="zap" size={isMobile ? 14 : 18} />
        <div className="flex flex-col min-w-0">
          <span className={`font-black tracking-wide truncate ${isMobile ? 'text-xs' : 'text-sm'}`}>
            {title}
          </span>
          <span className={`font-normal opacity-80 truncate ${isMobile ? 'text-[10px]' : 'text-[11px]'}`}>
            {subtitle}{others > 0 ? ` · +${others} spot${others > 1 ? 's' : ''}` : ''}
          </span>
        </div>
      </div>
    </div>
  );
});
