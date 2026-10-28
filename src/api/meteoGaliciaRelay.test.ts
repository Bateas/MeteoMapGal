/**
 * The web server relays to servizos.meteogalicia.gal only the paths the map asks
 * for (nginx.conf, `location ~ ^/meteogalicia-api/(...)$`). Open, it relayed any
 * path from our address, their lightning service included, which MeteoGalicia
 * wants polled only by our ingestor and no more often than every 5 minutes.
 *
 * Reads the allowed pattern from nginx.conf and every MeteoGalicia path in the
 * web code, and checks each one is allowed (a new feature that forgets the list
 * would 404 only in production) and that the lightning and MeteoSIX paths are not.
 */
import { describe, it, expect } from 'vitest';
import { latestObservationUrls } from './mgLatestBatch';
import { METEOGALICIA } from '../config/apiEndpoints';

// Node modules through a string variable: the app tsconfig carries no Node types
// (a static 'node:fs' import fails tsc -b), and the test always runs under Node.
const [fsModule, urlModule, pathModule] = ['node:fs', 'node:url', 'node:path'];
const { promises: fs } = await import(/* @vite-ignore */ fsModule);
const { fileURLToPath } = await import(/* @vite-ignore */ urlModule);
const path = await import(/* @vite-ignore */ pathModule);

const ROOT: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

interface DirEntry { name: string; isDirectory(): boolean }

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries: DirEntry[] = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(p)));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

async function allowedPattern(): Promise<RegExp> {
  const conf: string = await fs.readFile(path.join(ROOT, 'nginx.conf'), 'utf8');
  const m = conf.match(/location ~ (\^\/meteogalicia-api\/\S+\$) \{/);
  if (!m) throw new Error('no MeteoGalicia location in nginx.conf');
  return new RegExp(m[1]);
}

/** Every MeteoGalicia path the web code can send through the relay, as `/meteogalicia-api/<path>`. */
async function pathsInCode(): Promise<Set<string>> {
  const found = new Set<string>();
  const add = (p: string) => found.add(`/meteogalicia-api/${p.replace(/^\/+/, '').split('?')[0]}`);
  for (const file of await sourceFiles(path.join(ROOT, 'src'))) {
    const text: string = await fs.readFile(file, 'utf8');
    for (const m of text.matchAll(/\/meteogalicia-api\/([A-Za-z0-9_./-]+)/g)) add(m[1]);
    for (const m of text.matchAll(/['`](\/mgrss\/[A-Za-z0-9_./-]+)/g)) add(m[1]);
    for (const m of text.matchAll(/(?:datosred\/camaras\/MeteoGalicia|\$\{MG_IMG_BASE\})\/([A-Za-z0-9_-]+)\/ultima\.jpg/g)) {
      add(`datosred/camaras/MeteoGalicia/${m[1]}/ultima.jpg`);
    }
  }
  for (const url of latestObservationUrls('/meteogalicia-api', [10154, 14001])) found.add(url.split('?')[0]);
  found.add(METEOGALICIA.stationList());
  return found;
}

describe('MeteoGalicia relay allowlist', () => {
  it('lets through every path the map uses', async () => {
    const allowed = await allowedPattern();
    const paths = await pathsInCode();
    expect(paths.size).toBeGreaterThanOrEqual(8);   // 4 services + the webcams: a scan that finds nothing proves nothing
    for (const p of paths) expect(p, p).toMatch(allowed);
  });

  it('refuses lightning, MeteoSIX and anything else', async () => {
    const allowed = await allowedPattern();
    for (const p of [
      '/meteogalicia-api/mgrss/observacion/jsonRaios.action',
      '/meteogalicia-api/apiv5/getNumericForecastInfo',
      '/meteogalicia-api/mgrss/observacion/ultimos10minEstacionsMeteo.action/../jsonRaios.action',
      '/meteogalicia-api/datosred/camaras/MeteoGalicia/../../x/ultima.jpg',
      '/meteogalicia-api/',
    ]) expect(p, p).not.toMatch(allowed);
  });
});
