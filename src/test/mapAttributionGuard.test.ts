/**
 * maplibre-gl 5.x has GHSA-jrc7-96c5-q579 (CVE-2026-85061): its attribution sanitizer can be bypassed,
 * so an attribution string that comes from outside could run script in the page. The fix is only in 6.4.1.
 * We are not affected because every attribution the map shows is a literal written in this code: no remote
 * style, no TileJSON and no attribution taken from a response. This test keeps it that way while we stay
 * on 5.x: any new `attribution` that is not a literal fails here, and has to be a literal or be sanitized
 * and added below on purpose. See `security/vex.openvex.json`.
 */
import { describe, it, expect } from 'vitest';

const [fsModule, pathModule, urlModule] = ['node:fs', 'node:path', 'node:url'];
const { readFileSync, readdirSync, statSync } = await import(/* @vite-ignore */ fsModule);
const { join, dirname, relative } = await import(/* @vite-ignore */ pathModule);
const { fileURLToPath } = await import(/* @vite-ignore */ urlModule);

const root: string = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Values that are not literals but are checked here to carry only literals. */
const PASS_THROUGH = new Set([
  // the wrapper hands on what each overlay passes, and every overlay passes a literal (checked below)
  'src/components/map/RasterTileOverlay.tsx|attribution={attribution}',
  // the base maps: def comes from MAP_STYLES in mapStyleStore.ts, all literals
  'src/components/map/WeatherMap.tsx|attribution: def.attribution',
  // a constant of this same file, checked to be a literal below
  'src/components/map/BuoySymbolLayer.tsx|attribution={BUOY_ATTRIBUTION}',
  // the type of the MAP_STYLES field
  'src/store/mapStyleStore.ts|attribution: string',
]);

/** Files where `attribution` means something else: the fire-to-lightning link, never shown by maplibre. */
const OTHER_MEANING = new Set(['src/store/fireStore.ts', 'src/components/map/FireOverlay.tsx']);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const files = sourceFiles(join(root, 'src')).map((p) => ({
  rel: relative(root, p).split('\\').join('/'),
  text: readFileSync(p, 'utf8') as string,
}));

describe('map attributions are literals (GHSA-jrc7-96c5-q579, while on maplibre 5)', () => {
  it('every attribution handed to the map is a literal or a checked pass-through', () => {
    const bad: string[] = [];
    for (const f of files) {
      if (OTHER_MEANING.has(f.rel)) continue;
      for (const m of f.text.matchAll(/\battribution\s*(=|:)\s*([^\n,;)>]+)/g)) {
        const value = m[2].trim();
        if (/^["'`]/.test(value) && !value.includes('${')) continue;
        const key = `${f.rel}|attribution${m[1] === '=' ? '=' : ': '}${value}`.replace(/\s+$/, '');
        if (!PASS_THROUGH.has(key)) bad.push(key);
      }
    }
    expect(bad, 'attribution that is not a literal: make it a literal or sanitize it and list it here').toEqual([]);
  });

  it('the buoy attribution constant is a literal', () => {
    const f = files.find((x) => x.rel === 'src/components/map/BuoySymbolLayer.tsx');
    expect(f?.text).toMatch(/const BUOY_ATTRIBUTION\s*=\s*\n?\s*'[^'$`]*';/);
  });

  it('nobody passes a custom attribution or loads a remote style', () => {
    const hits = files.filter((f) => /customAttribution|mapStyle=\{?["'`]https?:|\.json['"`]\s*\)\s*;?\s*\/\/\s*style/.test(f.text)).map((f) => f.rel);
    expect(hits).toEqual([]);
  });
});
