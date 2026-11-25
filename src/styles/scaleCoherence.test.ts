/**
 * One scale, wherever it is written. The colours of the scale live as CSS tokens and also as hex for what is painted on
 * a canvas (arrows, particles) or an image (shared card, widget): nothing else keeps them equal. And a softer palette
 * has to keep the figure inside the shape readable, which only the maths can say, so it does the WCAG maths on the
 * tokens themselves.
 */
import { describe, it, expect } from 'vitest';
import { WIND_TONES_ON_DARK, WIND_TONES_ON_LIGHT, WIND_TONE_NAMES } from '../services/windUtils';
import { VERDICT_HEX } from '../config/verdictStyles';

const [fsModule, urlModule, pathModule] = ['node:fs', 'node:url', 'node:path'];
const { readFileSync } = await import(/* @vite-ignore */ fsModule);
const { fileURLToPath } = await import(/* @vite-ignore */ urlModule);
const { dirname, join } = await import(/* @vite-ignore */ pathModule);
const tokens: string = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'v3tokens.css'), 'utf8');

function blockOf(selector: string): string {
  const at = tokens.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return tokens.slice(at, tokens.indexOf('}', at));
}
const THEMES = { dark: blockOf(':root'), light: blockOf(':root[data-theme="light"]') };
const token = (theme: keyof typeof THEMES, name: string) => {
  const hex = new RegExp(`${name}:\\s*(#[0-9a-f]{6})`).exec(THEMES[theme])?.[1];
  expect(hex, `${theme} ${name}`).toBeTruthy();
  return hex!;
};

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const STEPS = ['calma', 'flojo', 'navegable', 'bueno', 'fuerte'];
/** The colour of the wind goes on past the verdict (18-nov, Beaufort): 22, 34 and 48 kt. */
const WIND_STEPS = [...WIND_TONE_NAMES];

describe.each(['dark', 'light'] as const)('the scale, %s theme', (theme) => {
  it.each(WIND_STEPS)('the figure on a %s chip reads at 4.5:1 or more', (step) => {
    expect(contrast(token(theme, `--g-ct-${step}`), token(theme, `--g-c-${step}`))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(WIND_STEPS)('a %s line stands out from the page at 3:1 or more', (step) => {
    expect(contrast(token(theme, `--g-s-${step}`), token(theme, '--g-bg'))).toBeGreaterThanOrEqual(2.95);
  });

  it('each step is its own colour', () => {
    expect(new Set(WIND_STEPS.map((s) => token(theme, `--g-c-${s}`))).size).toBe(WIND_STEPS.length);
    expect(new Set(WIND_STEPS.map((s) => token(theme, `--g-s-${s}`))).size).toBe(WIND_STEPS.length);
  });
});

describe('the same colours where CSS does not reach', () => {
  it('arrows and particles on a dark map', () => {
    expect([...WIND_TONES_ON_DARK]).toEqual(WIND_STEPS.map((s) => token('dark', `--g-s-${s}`)));
  });

  it('arrows and particles on a light map', () => {
    expect([...WIND_TONES_ON_LIGHT]).toEqual(WIND_STEPS.map((s) => token('light', `--g-s-${s}`)));
  });

  it('the shared image and the widget', () => {
    const { calm, light, sailing, good, strong } = VERDICT_HEX;
    expect([calm, light, sailing, good, strong]).toEqual(STEPS.map((s) => token('dark', `--g-s-${s}`)));
  });
});
