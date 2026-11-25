import { describe, expect, it } from 'vitest';

// Loaded by name at run time: a static 'node:fs' import fails tsc -b (same as bootTokens.test.ts).
const fsModule = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ fsModule)) as { readFileSync: (p: string, enc: 'utf8') => string };

/**
 * The rain bars of the weather point take their three blues from `--gfp-1..3`. Those were set only on
 * the old map popup; inside the docked card nothing set them and the bars came out black on the dark
 * card (seen 11-nov). Every container the card can live in has to set them, in both themes.
 */
describe('weather point card: the rain tones exist wherever the card is drawn', () => {
  const css = readFileSync('src/styles/pointCard.css', 'utf8');
  const ficha = readFileSync('src/components/map/Ficha.tsx', 'utf8');
  const containers = ['gf-dock', 'gf-sheetwrap'];

  it('the card still uses those two containers', () => {
    for (const c of containers) expect(ficha).toContain(c);
  });

  it('dark and light set the tones on each of them', () => {
    const dark = css.split('\n').find((l: string) => l.includes('--gfp-1') && !l.includes('data-theme')) ?? '';
    const light = css.split('\n').find((l: string) => l.includes('--gfp-1') && l.includes('data-theme="light"')) ?? '';
    for (const c of containers) {
      expect(dark).toContain(`.${c}`);
      expect(light).toContain(`[data-theme="light"] .${c}`);
    }
  });
});
