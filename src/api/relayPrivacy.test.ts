/**
 * The web server relays some map requests to third parties (MeteoGalicia, Meteoclimatic, IHM,
 * CESGA...). nginx passes every visitor header on by default, and Cloudflare adds the visitor's
 * IP and country, so each provider was getting the IP, country, cookies, page and browser of
 * every visitor (security audit 28-oct, item 18). Each third-party route now sends only what
 * the provider needs. This fails if a new relay forgets it, or one starts passing visitor data.
 */
import { describe, it, expect } from 'vitest';

// Node modules through a string variable: the app tsconfig carries no Node types
// (a static 'node:fs' import fails tsc -b), and the test always runs under Node.
const [fsModule, urlModule, pathModule] = ['node:fs', 'node:url', 'node:path'];
const { promises: fs } = await import(/* @vite-ignore */ fsModule);
const { fileURLToPath } = await import(/* @vite-ignore */ urlModule);
const path = await import(/* @vite-ignore */ pathModule);

const ROOT: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Each `location` block (top level of the server, 4 spaces in) with an https upstream. */
async function thirdPartyRoutes(): Promise<{ name: string; body: string }[]> {
  const conf: string = await fs.readFile(path.join(ROOT, 'nginx.conf'), 'utf8');
  const out: { name: string; body: string }[] = [];
  for (const m of conf.matchAll(/\n {4}location ([^{\n]+)\{([\s\S]*?)\n {4}\}/g)) {
    if (/proxy_pass https:\/\//.test(m[2])) out.push({ name: m[1].trim(), body: m[2] });
  }
  return out;
}

const VISITOR_DATA = /\$(remote_addr|binary_remote_addr|proxy_add_x_forwarded_for|http_cf_\w+|http_x_forwarded_for|http_x_real_ip|http_cookie|http_referer|http_user_agent|http_accept_language|http_true_client_ip)\b/;

describe('third-party relays send no visitor data', () => {
  it('every relay drops the visitor headers and sets none of its own', async () => {
    const routes = await thirdPartyRoutes();
    expect(routes.length).toBeGreaterThanOrEqual(7);   // a scan that finds nothing proves nothing
    for (const r of routes) {
      expect(r.body, r.name).toContain('proxy_pass_request_headers off;');
      for (const line of r.body.split('\n').filter((l) => /proxy_set_header/.test(l))) {
        expect(line, `${r.name}: ${line.trim()}`).not.toMatch(VISITOR_DATA);
      }
    }
  });

  it('every relay keeps the security headers its own add_header would drop (audit item 9)', async () => {
    for (const r of await thirdPartyRoutes()) {
      expect(r.body, r.name).toContain('add_header X-Content-Type-Options "nosniff" always;');
      expect(r.body, r.name).toContain('add_header X-Frame-Options "DENY" always;');
      expect(r.body, r.name).toMatch(/add_header Content-Security-Policy "default-src 'none';[^"]*sandbox" always;/);
    }
  });

  it('the static routes with their own add_header keep nosniff', async () => {
    const conf: string = (await fs.readFile(path.join(ROOT, 'nginx.conf'), 'utf8')).replace(/\r\n/g, '\n');
    for (const loc of ['/assets/', '/sw.js', '/manifest.json']) {
      const m = conf.match(new RegExp(`\\n {4}location ${loc.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} \\{([\\s\\S]*?)\\n {4}\\}`));
      expect(m, loc).not.toBeNull();
      expect(m![1], loc).toContain('add_header X-Content-Type-Options "nosniff" always;');
    }
  });
});
