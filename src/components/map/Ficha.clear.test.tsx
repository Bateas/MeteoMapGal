/**
 * An open sheet stops under what floats over the top of the map. The warnings strip went over the map on 19-nov and
 * the sheet still measured its room as if the strip pushed the map down: with a two-line warning it ran under the
 * strip, and the handle and the close button could not be reached (25-nov, on a phone). The lightning band did the same.
 * jsdom lays nothing out: the sheet has to hand the box height to the style sheet, and the style sheet has to take
 * the strip and the bands off it. Measured in a browser at 375x812 after the change.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('react-map-gl/maplibre', () => ({ useMap: () => ({ current: null }) }));

import { Ficha } from './Ficha';
import { useUIStore } from '../../store/uiStore';

// Node modules through a string variable, as in repoGuards.test.ts: the app tsconfig carries no Node types.
const [fsModule, pathModule, urlModule] = ['node:fs', 'node:path', 'node:url'];
const { readFileSync } = await import(/* @vite-ignore */ fsModule);
const { join, dirname } = await import(/* @vite-ignore */ pathModule);
const { fileURLToPath } = await import(/* @vite-ignore */ urlModule);
const css: string = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'styles', 'ficha.css'), 'utf8');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useUIStore.setState({ isMobile: false });
});

describe('the open sheet and what floats over the top of the map', () => {
  it('the sheet hands the style sheet the whole height of the map box, beside its own room', () => {
    useUIStore.setState({ isMobile: true });
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(900);
    render(
      <Ficha longitude={-8.7} latitude={42.3} onClose={() => {}} titleId="t">
        <h2 id="t">Bocana</h2>
        <section className="gf-group"><p>Aquí</p></section>
      </Ficha>,
    );
    const sheet = screen.getByRole('region', { name: 'Bocana' });
    expect(sheet.style.getPropertyValue('--gf-box')).toBe(`${window.innerHeight}px`);
    expect(sheet.style.getPropertyValue('--gf-open')).toBe(`${window.innerHeight - 44}px`);
  });

  it('the style sheet takes the warnings strip and the bands off that height', () => {
    const rule = css.split('\n').find((line) => line.startsWith('.gf-sheet {')) ?? '';
    const maxHeight = /max-height:\s*([^;]+);/.exec(rule)?.[1] ?? '';
    expect(maxHeight).toMatch(/^min\(var\(--gf-open/);
    expect(maxHeight).toContain('var(--gf-box');
    expect(maxHeight).toContain('- var(--ticker-h, 0px)');
    expect(maxHeight).toContain('- var(--map-stack-h, 0px)');
  });

  it('peeking keeps its own height: only the open sheet reaches that far up', () => {
    const peek = css.split('\n').find((line) => line.startsWith('.gf-sheetwrap[data-detent="peek"] .gf-sheet')) ?? '';
    expect(peek).toContain('var(--gf-peek');
    expect(peek).not.toContain('--ticker-h');
  });
});
