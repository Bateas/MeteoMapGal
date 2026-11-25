import { describe, it, expect, afterEach } from 'vitest';
import { mapIsDark } from './useMapInk';
import { useMapStyleStore } from '../store/mapStyleStore';
import { useThemeStore } from '../store/themeStore';
import { windSpeedColor, WIND_TONES_ON_DARK, WIND_TONES_ON_LIGHT } from '../services/windUtils';

const set = (activeStyleId: string, theme: 'dark' | 'light') => {
  useMapStyleStore.setState({ activeStyleId } as never);
  useThemeStore.setState({ theme } as never);
};

afterEach(() => set('auto', 'dark'));

describe('whether the map drawn is dark', () => {
  it('«auto» follows the theme', () => {
    set('auto', 'dark');
    expect(mapIsDark()).toBe(true);
    set('auto', 'light');
    expect(mapIsDark()).toBe(false);
  });

  it('a chosen map is what it is, whatever the theme: a street map is light in the dark theme', () => {
    set('voyager', 'dark');
    expect(mapIsDark()).toBe(false);
    set('dark', 'light');
    expect(mapIsDark()).toBe(true);
  });

  it('and that picks the tones that can be seen on it', () => {
    set('auto', 'dark');
    expect(windSpeedColor(10, mapIsDark())).toBe(WIND_TONES_ON_DARK[4]);
    set('auto', 'light');
    expect(windSpeedColor(10, mapIsDark())).toBe(WIND_TONES_ON_LIGHT[4]);
  });
});
