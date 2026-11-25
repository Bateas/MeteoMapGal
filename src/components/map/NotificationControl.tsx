import { memo, useCallback } from 'react';
import { useNotificationStore } from '../../store/notificationStore';
import { requestNotificationPermission, playAlertTone } from '../../services/notificationService';
import type { AlertSeverity } from '../../services/alertService';
import { WeatherIcon } from '../icons/WeatherIcons';

// ── Severity options ────────────────────────────────────────

const SEVERITY_OPTIONS: { value: AlertSeverity; label: string }[] = [
  { value: 'moderate', label: 'Moderado' },
  { value: 'high', label: 'Alto' },
  { value: 'critical', label: 'Crítico' },
];

// ── Main component ──────────────────────────────────────────

export const NotificationControl = memo(function NotificationControl() {
  const config = useNotificationStore((s) => s.config);
  const permissionStatus = useNotificationStore((s) => s.permissionStatus);
  const settingsOpen = useNotificationStore((s) => s.settingsOpen);
  const setSettingsOpen = useNotificationStore((s) => s.setSettingsOpen);
  const setEnabled = useNotificationStore((s) => s.setEnabled);
  const setPushEnabled = useNotificationStore((s) => s.setPushEnabled);
  const setSoundEnabled = useNotificationStore((s) => s.setSoundEnabled);
  const setVolume = useNotificationStore((s) => s.setVolume);
  const setMinSeverity = useNotificationStore((s) => s.setMinSeverity);
  const setPermissionStatus = useNotificationStore((s) => s.setPermissionStatus);

  const handleRequestPermission = useCallback(async () => {
    const result = await requestNotificationPermission();
    setPermissionStatus(result);
  }, [setPermissionStatus]);

  const handleTestSound = useCallback(() => {
    playAlertTone('high', config.volume);
  }, [config.volume]);

  if (!settingsOpen) {
    return (
      <button type="button" className="gc-linkbtn" onClick={() => setSettingsOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <WeatherIcon id={config.enabled ? 'bell' : 'bell-off'} size={13} />
        Notificaciones: {config.enabled ? 'sí' : 'no'}
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div className="gc-popover-head">
        <span>Notificaciones</span>
        <button type="button" className="gc-btn gc-btn--plain gc-btn--icon" onClick={() => setSettingsOpen(false)} aria-label="Cerrar notificaciones">
          <WeatherIcon id="x" size={14} />
        </button>
      </div>

      <ToggleRow label="Activar" enabled={config.enabled} onChange={setEnabled} />

      {config.enabled && (
        <>
          <ToggleRow
            label="Sonido"
            enabled={config.soundEnabled}
            onChange={setSoundEnabled}
            extra={<button type="button" className="gc-linkbtn" onClick={handleTestSound}>Probar</button>}
          />

          {config.soundEnabled && (
            <label className="gc-formrow">
              <span style={{ flex: '0 0 auto' }}>Volumen</span>
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(config.volume * 100)}
                onChange={(e) => setVolume(Number(e.target.value) / 100)}
              />
              <span className="gc-num">{Math.round(config.volume * 100)}</span>
            </label>
          )}

          <ToggleRow label="Avisos del navegador" enabled={config.pushEnabled} onChange={setPushEnabled} />

          {config.pushEnabled && permissionStatus !== 'granted' && (
            <button type="button" className="gc-btn" onClick={handleRequestPermission} style={{ whiteSpace: 'normal' }}>
              {permissionStatus === 'denied'
                ? 'Permiso denegado: actívalo en los ajustes del navegador'
                : 'Permitir notificaciones del navegador'}
            </button>
          )}

          <div className="gc-formrow">
            <span style={{ flex: '0 0 auto' }}>Avisar desde</span>
            <div className="gc-seg" role="group" aria-label="Nivel mínimo">
              {SEVERITY_OPTIONS.map((opt) => (
                <button key={opt.value} type="button" aria-pressed={config.minSeverity === opt.value} onClick={() => setMinSeverity(opt.value)}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
});

// ── Toggle row helper ───────────────────────────────────────

function ToggleRow({
  label,
  enabled,
  onChange,
  extra,
}: {
  label: string;
  enabled: boolean;
  onChange: (v: boolean) => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className="gc-formrow">
      <button type="button" role="switch" aria-checked={enabled} className="gc-option" style={{ flex: 1, padding: '6px 0', minHeight: 40 }} onClick={() => onChange(!enabled)}>
        <span className="gc-option-text">{label}</span>
        <span className="gc-switch" />
      </button>
      {extra}
    </div>
  );
}
