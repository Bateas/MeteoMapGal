/**
 * SpotPushOptIn — compact per-spot opt-in row for the lightning safety pushes.
 *
 * Renders nothing when the browser cannot receive Web Push (iOS Safari without
 * the installed PWA): silence, not an explanation — the popup just went on a
 * density diet and an unusable feature earns zero pixels.
 *
 * Only the two safety levels ever push (AVISO approaching / PELIGRO <10km),
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
      <div className="mb-1.5 text-[10px] text-slate-500">
        Notificaciones bloqueadas en el navegador
      </div>
    );
  }

  if (status === 'on') {
    return (
      <div className="mb-1.5 flex items-center gap-2 text-[11px] leading-tight">
        <span className="flex items-center gap-1 text-emerald-400">
          <WeatherIcon id="bell" size={11} className="inline" />
          Aviso de tormenta activado
        </span>
        <button
          type="button"
          onClick={handleTest}
          className="px-1.5 py-px rounded border border-slate-600 bg-slate-800 text-slate-300 text-[10px] hover:text-slate-100"
        >
          Probar
        </button>
        <button
          type="button"
          onClick={handleDisable}
          aria-label="Quitar aviso de tormenta"
          className="px-1.5 py-px rounded border border-slate-600 bg-slate-800 text-slate-400 text-[10px] hover:text-slate-200"
        >
          Quitar
        </button>
      </div>
    );
  }

  // off / requesting / error → single-line CTA (error adds a discreet note)
  return (
    <div className="mb-1.5 leading-tight">
      <button
        type="button"
        onClick={handleEnable}
        disabled={status === 'requesting'}
        aria-pressed={false}
        className="flex items-center gap-1 text-[11px] text-slate-300 hover:text-slate-100 disabled:opacity-60"
      >
        <span className="flex text-amber-400">
          <WeatherIcon id="bell" size={11} className="inline" />
        </span>
        {status === 'requesting' ? 'Pidiendo permiso…' : 'Avisarme si hay tormenta cerca'}
      </button>
      {status === 'error' && (
        <div className="text-[10px] text-slate-500">No se pudo activar el aviso</div>
      )}
    </div>
  );
}
