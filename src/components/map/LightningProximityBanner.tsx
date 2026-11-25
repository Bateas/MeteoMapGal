/**
 * LightningProximityBanner — "rayo a X km de TU spot", the visible half of
 * the LOCAL lightning safety feature.
 *
 * Auto-shows when observed cloud-to-ground strikes put a spot of the active
 * sector at risk (reactive overlay: observation-based, so auto-activation is
 * allowed). Sits BELOW CriticalAlertBanner so both can show during a severe
 * storm without overlapping: the next place in the column at the top of the map
 * (WeatherMap on a desktop, AppShell on a phone).
 *
 * Click selects the affected spot — the popup gives the full local picture.
 */

import { memo } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useSpotStore } from '../../store/spotStore';
import { useSpotLightningRisk, useSpotLightningWait } from '../../hooks/useSpotLightningRisk';
import { WeatherIcon } from '../icons/WeatherIcons';
import { namedFirst, type SpotLightningWait } from '../../services/lightningProximityService';

export const LightningProximityBanner = memo(function LightningProximityBanner() {
  const isMobile = useUIStore((s) => s.isMobile);
  const selectSpot = useSpotStore((s) => s.selectSpot);
  const activeSpotId = useSpotStore((s) => s.activeSpotId);
  const favoriteSpotId = useSpotStore((s) => s.favoriteSpotId);
  const risks = useSpotLightningRisk();
  const waits = useSpotLightningWait();

  if (risks.length === 0) {
    if (waits.length === 0) return null;
    return <WaitBanner wait={namedFirst(waits, activeSpotId, favoriteSpotId)} others={waits.length - 1} isMobile={isMobile} onSelect={selectSpot} />;
  }

  const top = namedFirst(risks, activeSpotId, favoriteSpotId);
  const danger = top.level === 'peligro';

  const kmTxt = top.nearestKm < 1 ? '<1 km' : `${Math.round(top.nearestKm)} km`;
  const title = danger
    ? `RAYO A ${kmTxt.toUpperCase()} — ${top.spotName.toUpperCase()}`
    : `${top.count25 === 1 ? 'Rayo' : 'Rayos'} a ${kmTxt} — ${top.spotName}`;

  let subtitle = top.count25 === 1 ? '1 impacto en 20 min · posible tormenta en la zona' : `${top.count25} impactos en 20 min`;
  // «acercándose» is measured (the strikes of the last 10 min fell closer than the 10 before);
  // the minutes to arrival are not shown: on the stored season they were off by 18 min on average
  // and the notice itself was wrong 6 times out of 10.
  if (top.approaching) subtitle += ' · acercándose';
  if (danger) subtitle += ' · sal del agua';
  const others = risks.length - 1;


  return (
    <div
      // Placed by the column at the top of the map, right under the critical banner.
      className="max-w-full pointer-events-auto"
      role="alert"
      aria-live="assertive"
    >
      <button type="button" className={`gc-band ${danger ? 'gc-band--danger' : 'gc-band--warn'}`} data-level={top.level} onClick={() => selectSpot(top.spotId)} title="Ver el spot afectado">
        {/* The level is not left to the colour alone: danger wears the warning triangle, the rest the bolt. */}
        <WeatherIcon id={danger ? 'alert-triangle' : 'zap'} size={isMobile ? 16 : 20} />
        <span>
          <b>{title}</b>
          <span>{subtitle}{others > 0 ? ` · +${others} spot${others > 1 ? 's' : ''}` : ''}</span>
        </span>
      </button>
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
      className="max-w-full pointer-events-auto"
      role="status"
      aria-live="polite"
    >
      <button type="button" className="gc-band gc-band--warn" data-level="espera" onClick={() => onSelect(wait.spotId)} title="Ver el spot afectado">
        <WeatherIcon id="zap" size={isMobile ? 16 : 20} />
        <span>
          <b>{`ESPERA HASTA LAS ${until} — ${wait.spotName.toUpperCase()}`}</b>
          <span>
            {`Último rayo a ${kmTxt} hace ${wait.lastAgeMin} min · una tormenta puede volver`}
            {others > 0 ? ` · +${others} spot${others > 1 ? 's' : ''}` : ''}
          </span>
        </span>
      </button>
    </div>
  );
}
