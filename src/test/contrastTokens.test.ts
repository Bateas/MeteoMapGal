/**
 * Contrast guard for the colour tokens the axe audit (25-sep) flagged.
 *
 * The fix lives in CSS variables, which jsdom does not resolve, so the test
 * reads index.css as text and does the WCAG maths itself. It fails if the
 * dark slate-500 override is removed, placed in a way that the light theme
 * would pick it up, or tuned below 4.5:1 on the dark panels.
 *
 * Read from disk, not with `import '../index.css?raw'`: Vitest replaces every
 * .css import (raw included) with an empty string unless css processing is on.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { Header } from '../components/layout/Header';
import { useWeatherStore } from '../store/weatherStore';
import { useThermalStore } from '../store/thermalStore';
import { useUIStore } from '../store/uiStore';

// The Node modules are loaded through a string variable because the app tsconfig
// carries no Node types (a static 'node:fs' import fails tsc -b); the test itself
// always runs under Node. Not new URL('../index.css', import.meta.url) either:
// Vite rewrites that pattern into an http://localhost URL that fs cannot open.
const [fsModule, urlModule, pathModule] = ['node:fs', 'node:url', 'node:path'];
const { readFileSync } = await import(/* @vite-ignore */ fsModule);
const { fileURLToPath } = await import(/* @vite-ignore */ urlModule);
const { dirname, join } = await import(/* @vite-ignore */ pathModule);
const css: string = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.css'), 'utf8');

type Linear = [number, number, number];

/** oklch -> linear sRGB (OKLab reference matrices, clamped to the gamut). */
function oklchToLinear(lPct: number, c: number, hDeg: number): Linear {
  const L = lPct / 100;
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function hexToLinear(hex: string): Linear {
  const n = parseInt(hex.slice(1), 16);
  const toLin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [toLin((n >> 16) & 255), toLin((n >> 8) & 255), toLin(n & 255)];
}

const luminance = ([r, g, b]: Linear) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function contrast(fg: Linear, bg: Linear): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Dark backgrounds the failing text actually sat on (measured by axe).
const DARK_PANELS: Record<string, string> = {
  'slate-900': '#0f172b',
  sidebar: '#10192d',
  card: '#162034',
  'slate-800': '#1d293d',
};

// Tailwind 4.3 slate-400 lightness: slate-500 must stay below it.
const SLATE_400_LIGHTNESS = 70.4;

describe('dark theme slate-500 override', () => {
  const match = css.match(
    /@layer base\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{[^}]*--color-slate-500:\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)/,
  );

  it('exists in @layer base and only outside the light theme', () => {
    expect(match).not.toBeNull();
  });

  it('reaches WCAG AA 4.5:1 on every dark panel', () => {
    const [, l, c, h] = match!;
    const fg = oklchToLinear(Number(l), Number(c), Number(h));
    for (const [name, bg] of Object.entries(DARK_PANELS)) {
      expect(contrast(fg, hexToLinear(bg)), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('stays dimmer than slate-400 so the two text levels remain distinct', () => {
    expect(Number(match![1])).toBeLessThan(SLATE_400_LIGHTNESS);
  });

  it('leaves the light theme remap alone', () => {
    const light = css.match(/\[data-theme="light"\]\s*\{[^}]*--color-slate-500:\s*(#[0-9a-f]{6})/i);
    expect(light?.[1]).toBe('#94a3b8');
  });
});

describe('.badge-beta text colour', () => {
  it('follows the theme variable instead of a fixed #64748b', () => {
    const block = css.match(/\.badge-beta\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(block).not.toBe('');
    expect(block).not.toMatch(/color:\s*#64748b/i);
    expect(block).toMatch(/color:\s*var\(--color-slate-400/);
  });
});

describe('mobile Header station count', () => {
  beforeEach(() => {
    useWeatherStore.setState({
      stations: [
        { id: 'a', name: 'A', source: 'aemet', lat: 42.3, lon: -8.1, altitude: 100 } as any,
        { id: 'b', name: 'B', source: 'aemet', lat: 42.3, lon: -8.1, altitude: 100 } as any,
      ],
      currentReadings: new Map([['a', { temperature: 15, windSpeed: 5 } as any]]),
    });
    useThermalStore.setState({ rules: [] });
    useUIStore.setState({ isMobile: true, simpleMode: false });
  });

  it('uses a colour that is readable on the active blue pill', () => {
    render(createElement(Header, { onRefresh: () => {} }));
    const count = screen.getByText('1/2');
    // blue-200 at 60% was 2.2:1 on bg-blue-600; blue-50 is 4.8:1.
    expect(count.className).toContain('text-blue-50');
    expect(count.className).not.toContain('text-blue-200/60');
  });
});

// Light theme: the panels are white/near-white, where Tailwind's pale amber
// (the "Avanzado" button and the "Modo simple activo" banner) read 1.2-1.4:1.
describe('light theme amber remap', () => {
  const block = (selector: string) => {
    const at = css.indexOf(selector + ' {');
    expect(at, `${selector} block`).toBeGreaterThanOrEqual(0);
    return css.slice(at, css.indexOf('}', at));
  };
  const token = (body: string, name: string) => {
    const m = body.match(new RegExp(`--color-${name}:\\s*oklch\\(([\\d.]+)%\\s+([\\d.]+)\\s+([\\d.]+)\\)`));
    expect(m, `--color-${name}`).not.toBeNull();
    return oklchToLinear(Number(m![1]), Number(m![2]), Number(m![3]));
  };
  const LIGHT_PANELS = ['#ffffff', '#f8fafc', '#fff5e6'];

  it('amber-300 and amber-200 reach 4.5:1 on the light panels and the amber banner', () => {
    const light = block('[data-theme="light"]');
    for (const name of ['amber-300', 'amber-200']) {
      for (const bg of LIGHT_PANELS) {
        expect(contrast(token(light, name), hexToLinear(bg)), `${name} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('the map, which stays dark in the light theme, gets the pale amber back', () => {
    const map = block('[data-theme="light"] .map-dark-scope');
    // On the dark map panels the pale tone is what reads (>= 4.5:1 on slate-900).
    expect(contrast(token(map, 'amber-300'), hexToLinear('#0f172b'))).toBeGreaterThanOrEqual(4.5);
  });
});
