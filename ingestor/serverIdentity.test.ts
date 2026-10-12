/**
 * Every server request to MeteoGalicia and the Xunta says who we are.
 *
 * MeteoGalicia audits request efficiency by IP and Puertos del Estado knows us by the exact
 * User-Agent we described to them (30-sep-2026). Two checks: the string itself does not drift,
 * and every ingestor file that holds a url of those hosts uses the shared constant. The scanner
 * is tried on planted text first: a guard that cannot fail proves nothing.
 */
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVER_USER_AGENT } from '../src/config/serverIdentity';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOSTS = /https:\/\/(servizos\.meteogalicia\.gal|apis-ext\.xunta\.gal)/;

/** A file that names one of the hosts but never the shared agent. */
function missesAgent(text: string): boolean {
  return HOSTS.test(text) && !text.includes('SERVER_USER_AGENT');
}

describe('server identity towards MeteoGalicia and the Xunta', () => {
  it('is the string Puertos del Estado and MeteoGalicia know us by', () => {
    expect(SERVER_USER_AGENT).toBe('Mozilla/5.0 (compatible; MeteoMapGal/1.0; +https://meteomapgal.navia3d.com)');
  });

  it('the scanner catches a planted file', () => {
    expect(missesAgent("const BASE = 'https://servizos.meteogalicia.gal';\nfetch(BASE)")).toBe(true);
    expect(missesAgent("const BASE = 'https://apis-ext.xunta.gal/x';\nfetch(BASE, { headers: { 'User-Agent': SERVER_USER_AGENT } })")).toBe(false);
    expect(missesAgent(' * servizos.meteogalicia.gal drops off DNS (a comment, no url)')).toBe(false);
  });

  it('every ingestor file with a url of those hosts uses it', async () => {
    const names = (await fs.readdir(HERE)).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'));
    expect(names.length).toBeGreaterThan(20);
    const offenders: string[] = [];
    for (const n of names) if (missesAgent(await fs.readFile(path.join(HERE, n), 'utf8'))) offenders.push(n);
    expect(offenders).toEqual([]);
  });
});
