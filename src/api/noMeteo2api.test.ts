/**
 * MeteoGalicia told us (2-oct, and again on 9-oct for its map services) that meteo2api is not
 * meant for third-party apps, and asked for no more than one lightning request every 5
 * minutes. Only our server asks (ingestor/lightningFetcher.ts, every 5 minutes); the browser
 * reads our API. This keeps the browser and our public proxies from reaching meteo2api again:
 * before 9-oct the map fell back to it whenever our API failed, through `/meteo2api` on our
 * own address.
 *
 * The scanner is checked on a planted line first: a guard that cannot fail proves nothing.
 */
import { describe, it, expect } from 'vitest';

// Node modules through a string variable: the app tsconfig carries no Node types
// (a static 'node:fs' import fails tsc -b), and the test always runs under Node.
// Same pattern as noPortussvr.test.ts.
const [fsModule, urlModule, pathModule] = ['node:fs', 'node:url', 'node:path'];
const { promises: fs } = await import(/* @vite-ignore */ fsModule);
const { fileURLToPath } = await import(/* @vite-ignore */ urlModule);
const path = await import(/* @vite-ignore */ pathModule);

const ROOT: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** A path or url to the service; the bare name in a comment or a credit is fine. */
const FORBIDDEN = /\/meteo2api|xunta\.gal\/meteo2api|raios\/lenda/i;

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

describe('the browser and our proxies never reach meteo2api', () => {
  it('the scanner catches a planted line', () => {
    expect(offending("const RAIOS_LENDA_URL = '/meteo2api/v1/api/raios/lenda';")).toHaveLength(1);
    expect(offending("proxy_pass https://apis-ext.xunta.gal/meteo2api/;")).toHaveLength(1);
    expect(offending(' * cloud-to-ground strikes (MeteoGalicia meteo2api — certified source)')).toHaveLength(0);
  });

  it('no web source file asks for it', async () => {
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
