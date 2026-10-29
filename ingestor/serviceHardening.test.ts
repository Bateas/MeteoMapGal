/**
 * The two services run as a throwaway user with read-only disk and only their own
 * keys (ingestor/*.endurecido.conf, installed as systemd drop-ins; plan agreed with
 * infra on 29-oct). This fails if a drop-in loses any of that, opens a writable
 * path, or a unit stops declaring production (the API's CORS list depends on it).
 */
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (name: string) => fs.readFile(path.join(HERE, name), 'utf8').then((t) => t.replace(/\r\n/g, '\n'));
const directives = (text: string) => text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

const SERVICES = [
  { unit: 'meteo-api', env: '/etc/meteomapgal/api.env' },
  { unit: 'meteo-ingestor', env: '/etc/meteomapgal/ingestor.env' },
];

describe('service hardening drop-ins', () => {
  for (const { unit, env } of SERVICES) {
    it(`${unit}: own user, own keys, nothing writable`, async () => {
      const lines = directives(await read(`${unit}.endurecido.conf`));
      expect(lines).toContain('DynamicUser=yes');
      // The empty line resets the unit's shared .env; without it both would be read.
      const envLines = lines.filter((l) => l.startsWith('EnvironmentFile='));
      expect(envLines).toEqual(['EnvironmentFile=', `EnvironmentFile=${env}`]);
      expect(lines.filter((l) => l.startsWith('ReadWritePaths='))).toEqual(['ReadWritePaths=']);
      expect(lines).toContain('ProtectSystem=strict');
      expect(lines).toContain('PrivateTmp=yes');
      expect(lines).toContain('CapabilityBoundingSet=');
      // V8 writes the code it then runs: this one would stop Node from starting.
      expect(lines).not.toContain('MemoryDenyWriteExecute=yes');
    });

    it(`${unit}: the unit declares production`, async () => {
      expect(directives(await read(`${unit}.service`))).toContain('Environment=NODE_ENV=production');
    });
  }

  it('the deploy warns when an installed drop-in is not the one in the repo', async () => {
    const script = await fs.readFile(path.join(HERE, '..', 'tools', 'meteomap-update.sh'), 'utf8');
    expect(script).toContain('for svc in meteo-api meteo-ingestor; do');
    expect(script).toContain('cmp -s "$REPO/ingestor/$svc.endurecido.conf"');
  });
});
