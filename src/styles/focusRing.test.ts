/**
 * The keyboard focus ring has to show. A rule that lost its declarations left its selectors joined to the next rule
 * («the ring takes the paper colour on a filled control»), so every button, tab and bar item got a ring the colour of
 * the paper it sits on: with Tab nothing looked selected (25-nov, seen on a desktop in the welcome questions).
 */
import { describe, it, expect } from 'vitest';

// Node modules through a string variable, as in repoGuards.test.ts: the app tsconfig carries no Node types.
const [fsModule, pathModule, urlModule] = ['node:fs', 'node:path', 'node:url'];
const { readFileSync, readdirSync } = await import(/* @vite-ignore */ fsModule);
const { join, dirname } = await import(/* @vite-ignore */ pathModule);
const { fileURLToPath } = await import(/* @vite-ignore */ urlModule);
const here: string = dirname(fileURLToPath(import.meta.url));

interface Rule { selectors: string[]; body: string; file: string }

/** Flat rules of a style sheet, comments out. Enough for one-level rules, which is where the rings live. */
function rules(file: string): Rule[] {
  const css = (readFileSync(join(here, file), 'utf8') as string).replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selectors: m[1].split(',').map((s) => s.trim()).filter(Boolean), body: m[2].trim(), file });
  }
  return out;
}

const all = (readdirSync(here) as string[]).filter((f) => f.endsWith('.css')).flatMap(rules);
const paperRing = all.filter((r) => /outline-color:\s*var\(--g-bg\)/.test(r.body) && r.selectors.some((s) => s.includes(':focus-visible')));
/** Filled with ink: pressed, expanded, the primary button or the lead button of the rail. */
const FILLED = /\[aria-(pressed|expanded|current|selected)="true"\]|--primary|--lead|\.is-on/;

describe('the keyboard focus ring', () => {
  it('there is a rule that gives the ring the paper colour, for filled controls', () => {
    expect(paperRing.length).toBeGreaterThan(0);
  });

  it('only a control filled with ink takes the paper colour', () => {
    const plain = paperRing.flatMap((r) => r.selectors.filter((s) => !FILLED.test(s)).map((s) => `${r.file}: ${s}`));
    expect(plain).toEqual([]);
  });

  it('a plain button, tab and bar item have an ink ring of their own', () => {
    for (const selector of ['.gc-btn:focus-visible', '.gc-tab:focus-visible', '.gc-navitem:focus-visible', '.gc-tool:focus-visible']) {
      const rule = all.find((r) => r.selectors.includes(selector) && /outline:/.test(r.body));
      expect(rule?.body, selector).toMatch(/outline:\s*2px solid var\(--g-ink\)/);
    }
  });
});
