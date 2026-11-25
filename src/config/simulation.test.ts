import { describe, it, expect } from 'vitest';
import { SIM_PARAMS, activeSimParams, isSimulationActive, urlWithoutSimulation, withSimulation } from './simulation';

// Node modules through a string variable, as in repoGuards.test.ts: the app tsconfig carries
// no Node types (a static 'node:fs' import fails tsc -b), and the test always runs under Node.
const [fsModule, pathModule, urlModule] = ['node:fs', 'node:path', 'node:url'];
const { readFileSync, readdirSync, statSync } = await import(/* @vite-ignore */ fsModule);
const { dirname, join } = await import(/* @vite-ignore */ pathModule);
const { fileURLToPath } = await import(/* @vite-ignore */ urlModule);

describe('simulation parameters', () => {
  it('finds every demo parameter, with or without a value', () => {
    expect(activeSimParams('?sector=rias&simstrike=cesantes&simfog')).toEqual(['simstrike', 'simfog']);
    expect(activeSimParams('?simorange=rojo&simwait=vao&simrain=lejos'))
      .toEqual(['simwait', 'simrain', 'simorange']);
  });

  it('stays off for a normal address', () => {
    expect(activeSimParams('?sector=rias&spot=cesantes')).toEqual([]);
    expect(isSimulationActive('')).toBe(false);
    expect(isSimulationActive('?simulado=1')).toBe(false);   // only the exact names
  });

  it('leaving the simulation keeps the rest of the address', () => {
    expect(urlWithoutSimulation('https://example.org/?sector=rias&simstrike=cesantes&spot=cesantes#guia'))
      .toBe('https://example.org/?sector=rias&spot=cesantes#guia');
    expect(urlWithoutSimulation('https://example.org/?simfog=a,b&simrain=1')).toBe('https://example.org/');
  });

  it('the address a card writes keeps the simulation of the page it opened on', () => {
    expect(withSimulation('/?sector=rias&spot=cesantes', '?simorange=1')).toBe('/?sector=rias&spot=cesantes&simorange=1');
    expect(withSimulation('/?sector=rias&spot=cesantes', '?simstrike=cesantes&simrain=1&otra=x'))
      .toBe('/?sector=rias&spot=cesantes&simstrike=cesantes&simrain=1');
    expect(isSimulationActive(withSimulation('/?sector=rias&spot=vao', '?simwait=vao').split('/')[1])).toBe(true);
  });

  it('and adds nothing to it on a normal page', () => {
    expect(withSimulation('/?sector=rias&spot=cesantes', '')).toBe('/?sector=rias&spot=cesantes');
    expect(withSimulation('/?sector=rias&spot=cesantes', '?sector=embalse&debug=1')).toBe('/?sector=rias&spot=cesantes');
  });

  it('every ?sim* read anywhere in src is in the list', () => {
    const found = new Set<string>();
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          const text = readFileSync(path, 'utf8');
          for (const m of text.matchAll(/(?:get|has|getSimParam)\(\s*'(sim[a-z]+)'/g)) found.add(m[1]);
        }
      }
    };
    walk(join(dirname(fileURLToPath(import.meta.url)), '..'));
    expect(found.size).toBeGreaterThan(0);
    for (const name of found) expect(SIM_PARAMS).toContain(name);
  });
});
