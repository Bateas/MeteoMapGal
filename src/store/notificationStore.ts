import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { AlertSeverity } from '../services/alertService';
import type { NotificationConfig } from '../services/notificationService';
import { loadNotificationConfig, saveNotificationConfig } from '../services/notificationService';

interface NotificationState {
  config: NotificationConfig;
  /** Whether the settings panel is open */
  settingsOpen: boolean;
  /** Browser notification permission status */
  permissionStatus: NotificationPermission;

  setEnabled: (enabled: boolean) => void;
  setPushEnabled: (enabled: boolean) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setVolume: (volume: number) => void;
  setMinSeverity: (severity: AlertSeverity) => void;
  setSettingsOpen: (open: boolean) => void;
  setPermissionStatus: (status: NotificationPermission) => void;
}

export const useNotificationStore = create<NotificationState>()(
  devtools(
    (set, get) => ({
      config: loadNotificationConfig(),
      settingsOpen: false,
      permissionStatus: typeof window !== 'undefined' && 'Notification' in window
        ? Notification.permission
        : 'denied',

      setEnabled: (enabled) => {
        const config = { ...get().config, enabled };
        saveNotificationConfig(config);
        set({ config }, undefined, 'setEnabled');
      },

      setPushEnabled: (enabled) => {
        const config = { ...get().config, pushEnabled: enabled };
        saveNotificationConfig(config);
        set({ config }, undefined, 'setPushEnabled');
      },

      setSoundEnabled: (enabled) => {
        const config = { ...get().config, soundEnabled: enabled };
        saveNotificationConfig(config);
        set({ config }, undefined, 'setSoundEnabled');
      },

      setVolume: (volume) => {
        const config = { ...get().config, volume: Math.max(0, Math.min(1, volume)) };
        saveNotificationConfig(config);
        set({ config }, undefined, 'setVolume');
      },

      setMinSeverity: (severity) => {
        const config = { ...get().config, minSeverity: severity };
        saveNotificationConfig(config);
        set({ config }, undefined, 'setMinSeverity');
      },

      setSettingsOpen: (open) =>
        set({ settingsOpen: open }, undefined, 'setSettingsOpen'),

      setPermissionStatus: (status) =>
        set({ permissionStatus: status }, undefined, 'setPermissionStatus'),
    }),
    { name: 'NotificationStore' },
  ),
);
