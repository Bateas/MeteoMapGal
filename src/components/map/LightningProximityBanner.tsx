/**
 * LightningProximityBanner — "rayo a X km de TU spot", the visible half of
 * the LOCAL lightning safety feature.
 *
 * Auto-shows when observed cloud-to-ground strikes put a spot of the active
 * sector at risk (reactive overlay: observation-based, so auto-activation is
 * allowed). Sits BELOW CriticalAlertBanner so both can show during a severe
 * storm without overlapping: its own slot on desktop, the next place in
 * AppShell's top-of-map column on a phone.
 *
 * Click selects the affected spot — the popup gives the full local picture.
 */

import { memo } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useSpotStore } from '../../store/spotStore';
import { useSpotLightningRisk, useSpotLightningWait } from '../../hooks/useSpotLightningRisk';
import { WeatherIcon } from '../icons/WeatherIcons';
import type { SpotLightningWait } from '../../services/lightningProximityService';

export const LightningProximityBanner = memo(function LightningProximityBanner() {
  const isMobile = useUIStore((s) => s.isMobile);
  const selectSpot = useSpotStore((s) => s.selectSpot);
  const risks = useSpotLightningRisk();
  const waits = useSpotLightningWait();

  if (risks.length === 0) {
    if (waits.length === 0) return null;
    return <WaitBanner wait={waits[0]} others={waits.length - 1} isMobile={isMobile} onSelect={selectSpot} />;
  }

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
      // Phone: placed by AppShell's top-of-map column, right under the critical banner.
      className={`${isMobile ? 'max-w-full' : 'absolute z-30 top-14 left-1/2 -translate-x-1/2'} pointer-events-auto`}
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

/**
 * After «sal del agua»: the spot was in danger, the close strikes stopped, and the map holds a
 * wait until 30 min after the last one within 10 km (measured: 26 % -> 19 % of «it struck again»).
 * It informs, it never clears anyone: no «ya puedes», and it says until when.
 */
function WaitBanner({ wait, others, isMobile, onSelect }: {
  wait: SpotLightningWait; others: number; isMobile: boolean; onSelect: (id: string) => void;
}) {
  const until = new Date(wait.untilMs).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
  const kmTxt = wait.lastKm < 1 ? '<1 km' : `${Math.round(wait.lastKm)} km`;
  return (
    <div
      className={`${isMobile ? 'max-w-full' : 'absolute z-30 top-14 left-1/2 -translate-x-1/2'} pointer-events-auto`}
      role="status"
      aria-live="polite"
    >
      <div
        className={`flex items-center rounded-lg font-semibold shadow-lg cursor-pointer
          ${isMobile ? 'gap-1.5 px-3 py-1.5 max-w-[calc(100vw-2rem)]' : 'gap-2.5 px-4 py-2'}`}
        style={{
          background: 'rgba(245, 158, 11, 0.14)',
          border: '1px solid rgba(245, 158, 11, 0.55)',
          color: '#f59e0b',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
        }}
        onClick={() => onSelect(wait.spotId)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(wait.spotId); }
        }}
        tabIndex={0}
        role="button"
        title="Ver el spot afectado"
      >
        <WeatherIcon id="zap" size={isMobile ? 14 : 18} />
        <div className="flex flex-col min-w-0">
          <span className={`font-black tracking-wide truncate ${isMobile ? 'text-xs' : 'text-sm'}`}>
            {`ESPERA HASTA LAS ${until} — ${wait.spotName.toUpperCase()}`}
          </span>
          <span className={`font-normal opacity-80 truncate ${isMobile ? 'text-[10px]' : 'text-[11px]'}`}>
            {`Último rayo a ${kmTxt} hace ${wait.lastAgeMin} min · una tormenta puede volver`}
            {others > 0 ? ` · +${others} spot${others > 1 ? 's' : ''}` : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
