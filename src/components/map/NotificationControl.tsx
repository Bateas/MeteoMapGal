import { memo, useCallback } from 'react';
import { useNotificationStore } from '../../store/notificationStore';
import { requestNotificationPermission, playAlertTone } from '../../services/notificationService';
import type { AlertSeverity } from '../../services/alertService';
import { WeatherIcon } from '../icons/WeatherIcons';

// ── Severity options ────────────────────────────────────────

const SEVERITY_OPTIONS: { value: AlertSeverity; label: string }[] = [
  { value: 'moderate', label: 'Moderado+' },
  { value: 'high', label: 'Alto+' },
  { value: 'critical', label: 'Solo Crítico' },
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
    // Compact toggle button
    return (
      <button
        className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] transition-all"
        style={{
          background: config.enabled
            ? 'rgba(59, 130, 246, 0.12)'
            : 'rgba(100, 116, 139, 0.1)',
          border: `1px solid ${config.enabled ? 'rgba(59, 130, 246, 0.3)' : 'rgba(100, 116, 139, 0.25)'}`,
          color: config.enabled ? '#3b82f6' : '#64748b',
        }}
        onClick={() => setSettingsOpen(true)}
        title="Configurar notificaciones"
      >
        <WeatherIcon id={config.enabled ? 'bell' : 'bell-off'} size={11} />
        <span className="font-mono tracking-wide">
          {config.enabled ? 'ON' : 'OFF'}
        </span>
      </button>
    );
  }

  // Expanded settings panel
  return (
    <div
      className="rounded-lg p-2.5 space-y-2"
      style={{
        background: 'rgba(15, 23, 42, 0.95)',
        border: '1px solid rgba(100, 116, 139, 0.25)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-slate-400 tracking-wider uppercase">
          Notificaciones
        </span>
        <button
          className="text-[9px] text-slate-500 hover:text-slate-300 px-1"
          onClick={() => setSettingsOpen(false)}
        >
          ✕
        </button>
      </div>

      {/* Master toggle */}
      <ToggleRow
        label="Activar"
        enabled={config.enabled}
        onChange={setEnabled}
      />

      {config.enabled && (
        <>
          {/* Sound */}
          <ToggleRow
            label="Sonido"
            enabled={config.soundEnabled}
            onChange={setSoundEnabled}
            extra={
              <button
                className="text-[8px] text-cyan-500 hover:text-cyan-400 ml-1"
                onClick={handleTestSound}
              >
                ▶ test
              </button>
            }
          />

          {/* Volume */}
          {config.soundEnabled && (
            <div className="flex items-center gap-2 px-1">
              <span className="text-[9px] text-slate-500 w-12">Vol</span>
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(config.volume * 100)}
                onChange={(e) => setVolume(Number(e.target.value) / 100)}
                className="flex-1 h-1 accent-cyan-500"
              />
              <span className="text-[9px] text-slate-500 font-mono w-6 text-right">
                {Math.round(config.volume * 100)}
              </span>
            </div>
          )}

          {/* Push notifications */}
          <ToggleRow
            label="Push"
            enabled={config.pushEnabled}
            onChange={setPushEnabled}
          />

          {/* Permission request */}
          {config.pushEnabled && permissionStatus !== 'granted' && (
            <button
              className="w-full text-[9px] py-1 rounded bg-cyan-900/30 border border-cyan-800/40 text-cyan-400 hover:bg-cyan-900/50 transition-colors"
              onClick={handleRequestPermission}
            >
              {permissionStatus === 'denied'
                ? 'Permiso denegado — habilitar en ajustes del navegador'
                : 'Permitir notificaciones del navegador'}
            </button>
          )}

          {/* Min severity */}
          <div className="flex items-center gap-2 px-1">
            <span className="text-[9px] text-slate-500 w-12">Nivel</span>
            <div className="flex gap-1 flex-1">
              {SEVERITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className="text-[8px] px-1.5 py-0.5 rounded transition-all"
                  style={{
                    background: config.minSeverity === opt.value
                      ? 'rgba(59, 130, 246, 0.2)'
                      : 'transparent',
                    border: `1px solid ${config.minSeverity === opt.value
                      ? 'rgba(59, 130, 246, 0.4)' : 'rgba(100, 116, 139, 0.15)'}`,
                    color: config.minSeverity === opt.value ? '#3b82f6' : '#64748b',
                  }}
                  onClick={() => setMinSeverity(opt.value)}
                >
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
    <div className="flex items-center gap-2 px-1">
      <span className="text-[9px] text-slate-500 w-12">{label}</span>
      <button
        className="w-7 h-3.5 rounded-full transition-all relative"
        style={{
          background: enabled ? 'rgba(34, 197, 94, 0.3)' : 'rgba(100, 116, 139, 0.2)',
          border: `1px solid ${enabled ? 'rgba(34, 197, 94, 0.4)' : 'rgba(100, 116, 139, 0.2)'}`,
        }}
        onClick={() => onChange(!enabled)}
      >
        <div
          className="w-2.5 h-2.5 rounded-full absolute top-0.5 transition-all"
          style={{
            left: enabled ? '13px' : '1px',
            background: enabled ? '#22c55e' : '#64748b',
          }}
        />
      </button>
      {extra}
    </div>
  );
}
