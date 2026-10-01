/**
 * Puertos del Estado asked third parties (1-oct-2026) to stop using PORTUSSRV
 * and to read its data through POEM, which only our service does, with its
 * token (ingestor/poemClient.ts). The browser must never ask Puertos del
 * Estado, and our public proxy must not offer a way to PORTUSSRV: before this,
 * `/portus-api` forwarded anything to it from our own address.
 *
 * Scans the web code and the proxy configs for any trace of that path. The
 * scanner is checked on a planted line first: a guard that cannot fail proves
 * nothing.
 */
import { describe, it, expect } from 'vitest';

// Node modules through a string variable: the app tsconfig carries no Node types
// (a static 'node:fs' import fails tsc -b), and the test always runs under Node.
// Same pattern as src/test/contrastTokens.test.ts.
const [fsModule, urlModule, pathModule] = ['node:fs', 'node:url', 'node:path'];
const { promises: fs } = await import(/* @vite-ignore */ fsModule);
const { fileURLToPath } = await import(/* @vite-ignore */ urlModule);
const path = await import(/* @vite-ignore */ pathModule);

const ROOT: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FORBIDDEN = /portussvr|portus-api/i;

interface DirEntry { name: string; isDirectory(): boolean }

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries: DirEntry[] = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else if (/\.(ts|tsx|js)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

function offending(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => FORBIDDEN.test(line));
}

describe('the browser and our proxies never reach PORTUSSRV', () => {
  it('the scanner catches a planted line', () => {
    expect(offending("const PORTUS_API = '/portus-api';")).toHaveLength(1);
    expect(offending("fetch('https://portus.puertos.es/portussvr/api/lastData/station/3221')")).toHaveLength(1);
    expect(offending("const POEM = 'https://poem.puertos.es';")).toHaveLength(0);
  });

  it('no web source file mentions it', async () => {
    const files = await walk(path.join(ROOT, 'src'));
    expect(files.length).toBeGreaterThan(100);
    const hits: string[] = [];
    for (const f of files) {
      for (const line of offending(await fs.readFile(f, 'utf8'))) hits.push(`${path.relative(ROOT, f)}: ${line.trim()}`);
    }
    expect(hits).toEqual([]);
  });

  it('no proxy route for it in development, the service worker, robots or the web server', async () => {
    for (const f of ['vite.config.ts', 'public/sw.js', 'public/robots.txt', 'nginx.conf']) {
      expect(offending(await fs.readFile(path.join(ROOT, f), 'utf8')), f).toEqual([]);
    }
  });
});
