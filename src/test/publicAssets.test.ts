/**
 * Every file the app names at the root of the site has to exist in `public/`. The browser notification asked for
 * `/favicon.ico`, which was never published: the alert came up with no icon and the server logged a 404 each time.
 */
import { describe, it, expect } from 'vitest';

// Node modules through a string variable, as in repoGuards.test.ts: the app tsconfig carries no Node types.
const [fsModule, pathModule, urlModule] = ['node:fs', 'node:path', 'node:url'];
const { existsSync, readFileSync, readdirSync, statSync } = await import(/* @vite-ignore */ fsModule);
const { join, dirname, relative } = await import(/* @vite-ignore */ pathModule);
const { fileURLToPath } = await import(/* @vite-ignore */ urlModule);

const root: string = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ASSET = /['"`(]\/([\w.-]+\.(?:ico|png|svg|jpg|jpeg|webp|webmanifest|json))(?=['"`)?#])/g;

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir) as string[]) {
    const path: string = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(ts|tsx|css)$/.test(name) && !/\.test\./.test(name)) out.push(path);
  }
  return out;
}

describe('files named at the root of the site', () => {
  const files = [...sources(join(root, 'src')), join(root, 'index.html'), join(root, 'public/sw.js'), join(root, 'public/manifest.json')];
  const named = new Map<string, string>();
  for (const file of files) {
    for (const m of (readFileSync(file, 'utf8') as string).matchAll(ASSET)) named.set(m[1], file);
  }

  it('finds the ones it is meant to guard', () => {
    expect([...named.keys()]).toEqual(expect.arrayContaining(['icon-192.png', 'favicon.svg']));
  });

  it('all exist in public/', () => {
    const missing = [...named]
      .filter(([name]) => !existsSync(join(root, 'public', name)))
      .map(([name, file]) => `${name} (${relative(root, file) as string})`);
    expect(missing).toEqual([]);
  });
});
