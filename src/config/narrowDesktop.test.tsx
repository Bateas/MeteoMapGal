/**
 * A narrow desktop window. The desktop view starts at 768 px, and up to 1024 px the open side panel left about
 * 450 px of map: a card covered half of it and the warnings strip at the bottom was squeezed to half a word
 * («Nad», 25-nov, seen at 770 px). The panel now folds in that range when a card opens, and the strip takes a row
 * of its own under the tools. Measured in a browser at 770x1224.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('react-map-gl/maplibre', () => ({ useMap: () => ({ current: null }) }));

import { Ficha } from '../components/map/Ficha';
import { useUIStore } from '../store/uiStore';
import { isNarrowDesktop, NARROW_DESKTOP_QUERY } from './narrowDesktop';

// Node modules through a string variable, as in repoGuards.test.ts: the app tsconfig carries no Node types.
const [fsModule, pathModule, urlModule] = ['node:fs', 'node:path', 'node:url'];
const { readFileSync } = await import(/* @vite-ignore */ fsModule);
const { join, dirname } = await import(/* @vite-ignore */ pathModule);
const { fileURLToPath } = await import(/* @vite-ignore */ urlModule);
const src: string = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]): string => readFileSync(join(src, ...parts), 'utf8');

const realWidth = window.innerWidth;
function setWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: px });
}

afterEach(() => {
  cleanup();
  setWidth(realWidth);
  useUIStore.setState({ isMobile: false, sidebarCollapsed: true });
});

function card() {
  return (
    <Ficha longitude={-8.7} latitude={42.3} onClose={() => {}} titleId="t">
      <h2 id="t">Cesantes</h2>
    </Ficha>
  );
}

describe('a narrow desktop window', () => {
  it('runs from the phone cut up to 1024 px, and no further', () => {
    expect(isNarrowDesktop(767)).toBe(false);
    expect(isNarrowDesktop(768)).toBe(true);
    expect(isNarrowDesktop(770)).toBe(true);
    expect(isNarrowDesktop(1023)).toBe(true);
    expect(isNarrowDesktop(1024)).toBe(false);
    expect(NARROW_DESKTOP_QUERY).toBe('(min-width: 768px) and (max-width: 1023px)');
  });

  it('a card that opens there folds the side panel', () => {
    setWidth(770);
    useUIStore.setState({ isMobile: false, sidebarCollapsed: false });
    render(card());
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
  });

  it('on a wide window the panel stays as the reader left it', () => {
    setWidth(1280);
    useUIStore.setState({ isMobile: false, sidebarCollapsed: false });
    render(card());
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  });

  it('the panel can be opened again with the card up: only a new card folds it', () => {
    setWidth(770);
    useUIStore.setState({ isMobile: false, sidebarCollapsed: false });
    const view = render(card());
    useUIStore.getState().setSidebarCollapsed(false);
    view.rerender(card());
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  });
});

describe('the bar of tools at the bottom of the map', () => {
  const chrome = read('styles', 'chrome.css');
  const ficha = read('styles', 'ficha.css');
  const map = read('components', 'map', 'WeatherMap.tsx');

  it('wraps, and the warnings keep a width of their own instead of being squeezed', () => {
    expect(map).toMatch(/className="gc-maptools [^"]*\bflex-wrap\b/);
    const rule = chrome.split('\n').find((line) => line.startsWith('.gc-maptools-alerts {')) ?? '';
    expect(rule).toMatch(/min-width:\s*min\(240px, 100%\)/);
    // min-w-0 beside it would hand the width back
    expect(map).not.toMatch(/gc-maptools-alerts[^"]*min-w-0/);
  });

  it('the strip clips what does not fit instead of spilling over the edge of the map', () => {
    const rule = chrome.split('\n').find((line) => line.startsWith('.gc-alertstrip {')) ?? '';
    expect(rule).toContain('overflow: hidden');
  });

  it('a card docked at the bottom of a narrow map stands on the bar, whatever rows it takes', () => {
    const rule = ficha.split('\n').find((line) => line.startsWith('[data-narrow] .gf-dock')) ?? '';
    expect(rule).toContain('bottom: calc(var(--map-tools-h');
    expect(map).toContain("'--map-tools-h'");
  });
});
