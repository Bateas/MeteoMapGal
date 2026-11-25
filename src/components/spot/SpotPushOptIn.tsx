/**
 * SpotPushOptIn — compact per-spot opt-in row for the lightning safety pushes.
 *
 * Renders nothing when the browser cannot receive Web Push (iOS Safari without
 * the installed PWA): silence, not an explanation — the popup just went on a
 * density diet and an unusable feature earns zero pixels.
 *
 * Only the two safety levels ever push (AVISO approaching or a strike within 10 km / PELIGRO <10km),
 * both computed by lightningProximityService on the ingestor side. Nothing
 * else pushes — no verdicts, no wind, no summaries.
 */
import { useEffect, useState } from 'react';
import { WeatherIcon } from '../icons/WeatherIcons';
import { useToastStore } from '../../store/toastStore';
import {
  isPushSupported,
  getSubscribedSpots,
  subscribeSpot,
  unsubscribeSpot,
  sendTestPush,
} from '../../api/pushClient';

type OptInStatus = 'off' | 'requesting' | 'on' | 'denied' | 'error';

interface SpotPushOptInProps {
  spot: { id: string; name: string };
}

export function SpotPushOptIn({ spot }: SpotPushOptInProps) {
  const addToast = useToastStore((s) => s.addToast);
  const [status, setStatus] = useState<OptInStatus>(() =>
    getSubscribedSpots().includes(spot.id) ? 'on' : 'off'
  );

  // Re-derive when the popup is reused for another spot (no remount guarantee)
  useEffect(() => {
    setStatus(getSubscribedSpots().includes(spot.id) ? 'on' : 'off');
  }, [spot.id]);

  if (!isPushSupported()) return null;

  const handleEnable = async () => {
    setStatus('requesting');
    const result = await subscribeSpot(spot.id);
    setStatus(result === 'on' ? 'on' : result === 'denied' ? 'denied' : 'error');
  };

  const handleDisable = async () => {
    await unsubscribeSpot(spot.id);
    setStatus('off');
  };

  const handleTest = async () => {
    const ok = await sendTestPush();
    addToast(
      ok ? 'Notificación de prueba enviada' : 'No se pudo enviar la prueba',
      ok ? 'success' : 'warning'
    );
  };

  if (status === 'denied') {
    return (
      <div className="gf-row gf-row--static">
        <WeatherIcon id="bell-off" size={16} />
        <span>Notificaciones bloqueadas en el navegador</span>
      </div>
    );
  }

  if (status === 'on') {
    return (
      <div className="gf-row" style={{ cursor: 'default' }}>
        <WeatherIcon id="bell" size={16} />
        <span className="gf-grow">Aviso de tormenta activado</span>
        <button type="button" onClick={handleTest} className="gc-btn gc-btn--plain">Probar</button>
        <button type="button" onClick={handleDisable} aria-label="Quitar aviso de tormenta" className="gc-btn gc-btn--plain">Quitar</button>
      </div>
    );
  }

  // off / requesting / error: one row (error adds a discreet note)
  return (
    <>
      <button type="button" onClick={handleEnable} disabled={status === 'requesting'} aria-pressed={false} className="gc-btn gf-action">
        <WeatherIcon id="bell" size={16} />
        {status === 'requesting' ? 'Pidiendo permiso…' : 'Avisarme si hay tormenta cerca'}
      </button>
      {status === 'error' && <div className="gf-hint" style={{ paddingBottom: 6 }}>No se pudo activar el aviso</div>}
    </>
  );
}
