/**
 * The build's source maps rebuild the original code with its comments and paths. Infra found
 * them downloadable from the site on 28-oct (main-*.js.map, 1.9 MB). They are still built, to
 * read a production stack trace, but never published: the web server answers 404 to any .map,
 * the deploy script removes them from the web root, and the bundle does not point to them.
 */
import { describe, it, expect } from 'vitest';

// Node modules through a string variable: the app tsconfig carries no Node types
// (a static 'node:fs' import fails tsc -b), and the test always runs under Node.
const [fsModule, urlModule, pathModule] = ['node:fs', 'node:url', 'node:path'];
const { promises: fs } = await import(/* @vite-ignore */ fsModule);
const { fileURLToPath } = await import(/* @vite-ignore */ urlModule);
const path = await import(/* @vite-ignore */ pathModule);

const ROOT: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = async (f: string): Promise<string> => (await fs.readFile(path.join(ROOT, f), 'utf8')).replace(/\r\n/g, '\n');

describe('source maps are never published', () => {
  it('the web server answers 404 to .map', async () => {
    const conf = await read('nginx.conf');
    const m = conf.match(/location ~\* \\.\(([a-z|]+)\)\$ \{\n\s+return 404;/);
    expect(m).not.toBeNull();
    expect(m![1].split('|')).toContain('map');
  });

  it('the deploy removes them from the web root right after copying the build', async () => {
    const script = await read('tools/meteomap-update.sh');
    const copy = script.indexOf('cp -r dist/* "$WWW/"');
    const clean = script.indexOf(`find "$WWW" -type f -name '*.map' -delete`);
    expect(copy).toBeGreaterThan(0);
    expect(clean).toBeGreaterThan(copy);
  });

  it('the bundle does not point to them', async () => {
    expect(await read('vite.config.ts')).toMatch(/sourcemap: 'hidden'/);
  });
});
