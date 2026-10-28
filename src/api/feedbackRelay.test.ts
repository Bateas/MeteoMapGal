/**
 * The feedback form is the only public route to the automation backend (n8n). What protects it
 * lives in the web server, not in the browser: anyone can POST without the app. This checks the
 * guards are still in nginx.conf: POST only, a small body, a per-visitor limit and one global
 * counter for the whole form (n8n's own limit can be overrun by simultaneous posts).
 */
import { describe, it, expect } from 'vitest';

// Node modules through a string variable: the app tsconfig carries no Node types
// (a static 'node:fs' import fails tsc -b), and the test always runs under Node.
const [fsModule, urlModule, pathModule] = ['node:fs', 'node:url', 'node:path'];
const { promises: fs } = await import(/* @vite-ignore */ fsModule);
const { fileURLToPath } = await import(/* @vite-ignore */ urlModule);
const path = await import(/* @vite-ignore */ pathModule);

const ROOT: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('feedback relay guards (nginx.conf)', () => {
  it('keeps POST only, 4 KB, the per-visitor limit and the global counter', async () => {
    const conf: string = await fs.readFile(path.join(ROOT, 'nginx.conf'), 'utf8');
    expect(conf).toMatch(/limit_req_zone \$server_name zone=feedback_global:\S+ rate=10r\/m;/);
    // Up to the location's own closing brace (4 spaces in): `limit_except POST { ... }` sits inside.
    const block = conf.match(/location = \/api\/webhook\/meteomap-feedback \{([\s\S]*?)\n {4}\}/);
    expect(block).not.toBeNull();
    const body = block![1];
    expect(body).toContain('limit_req zone=webhook_limit');
    expect(body).toContain('limit_req zone=feedback_global');
    expect(body).toContain('limit_except POST { deny all; }');
    expect(body).toContain('client_max_body_size 4k;');
    // No other public route to the automation backend.
    expect(conf.match(/proxy_pass http:\/\/n8n_backend/g)?.length).toBe(1);
  });
});
