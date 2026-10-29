/**
 * Our own devices carry the mmg_equipo cookie so the audience panels can leave them out.
 * What infra asked for (29-oct): the field goes at the END of the monitoring log line (the
 * panels read it by position), only that cookie is logged and never the whole Cookie header,
 * "-" when it is absent. The server sets it, because Safari keeps a cookie written by the page
 * for 7 days at most, and the installed app on iPhone keeps its cookies apart from Safari.
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

function location(conf: string, exact: string): string {
  const start = conf.indexOf(`location = ${exact} {`);
  expect(start, `location = ${exact}`).toBeGreaterThan(0);
  return conf.slice(start, conf.indexOf('\n    }', start));
}

describe('team devices in the monitoring log', () => {
  it('the team field is the last one of the log line', async () => {
    const conf = await read('nginx.conf');
    const line = conf.split('\n').find((l) => l.startsWith('log_format loki'));
    expect(line).toBeDefined();
    expect(line!.endsWith(`,"equipo":"$log_equipo"}';`)).toBe(true);
  });

  it('only that cookie is logged, never the Cookie header', async () => {
    const conf = await read('nginx.conf');
    expect(conf).not.toMatch(/\$http_cookie/);
    const uses = conf.split('\n').filter((l) => /\$cookie_/.test(l) && !l.trim().startsWith('#'));
    expect(uses).toEqual(['map $cookie_mmg_equipo $log_equipo {']);
  });

  it('logs "-" unless the cookie holds the one value the server sets', async () => {
    const conf = await read('nginx.conf');
    const start = conf.indexOf('map $cookie_mmg_equipo $log_equipo {');
    const body = conf.slice(start, conf.indexOf('\n}', start));
    const entries = body.split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
    expect(entries).toEqual(['default  "-";', '"1"      "1";']);
  });
});

describe('/equipo sets the mark and /equipo/fuera removes it', () => {
  it('the server sets a year-long cookie for the whole site, only over https', async () => {
    const block = location(await read('nginx.conf'), '/equipo');
    expect(block).toContain('add_header Set-Cookie "mmg_equipo=1; Max-Age=31536000; Path=/; Secure; SameSite=Lax" always;');
    expect(block).not.toMatch(/Domain=/);
  });

  it('removing it expires the same cookie', async () => {
    const block = location(await read('nginx.conf'), '/equipo/fuera');
    expect(block).toContain('add_header Set-Cookie "mmg_equipo=; Max-Age=0; Path=/; Secure; SameSite=Lax" always;');
  });

  it('both answer with a relative redirect back to the guide, never cached', async () => {
    const conf = await read('nginx.conf');
    for (const exact of ['/equipo', '/equipo/fuera']) {
      const block = location(conf, exact);
      expect(block).toContain('absolute_redirect off;');
      expect(block).toContain('add_header Cache-Control "no-store" always;');
      expect(block).toContain('return 302 /guia/roadmap;');
      expect(block).toContain('add_header Strict-Transport-Security');
    }
    expect(conf).toContain('location /guia/ {');
  });

  it('the page links to both and never writes the cookie itself', async () => {
    const page = await read('src/components/guide/sections/RoadmapSection.tsx');
    expect(page).toContain("'/equipo/fuera'");
    expect(page).toContain("'/equipo'");
    expect(page).not.toMatch(/document\.cookie\s*=/);
  });
});
