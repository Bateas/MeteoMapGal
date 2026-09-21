/**
 * Guard for the ingestor → frontend code boundary.
 *
 * The ingestor deliberately shares PURE logic with the frontend instead of
 * duplicating it (skyXWindIsMeasuring, predictCesantesCanalization, the
 * scoring gates...), so the map and the 24/7 analyzer cannot disagree. The
 * price of sharing is a boundary that must hold:
 *
 *   - direct imports from ingestor/ into src/ may land ONLY in src/services,
 *     src/config, src/types or src/api (pure, framework-free code)
 *   - nothing reached transitively may live in src/components, src/hooks or
 *     src/store, no reached module may be a .tsx file, and none may import a
 *     UI framework package (react, zustand, maplibre...)
 *
 * The crawler starts from every non-test .ts file directly under ingestor/
 * and follows relative `import`, `import type`, `export ... from` and literal
 * `import('...')` edges, resolving `.js` specifiers to `.ts`/`.tsx` and bare
 * paths to index files. Type-only edges count too: they never load at
 * runtime, but the ingestor type-checks through them, so a violation reached
 * only that way is still reported, tagged "(type-only)".
 *
 * Specifiers that match a `compilerOptions.paths` alias of ingestor/tsconfig.json
 * (`@app/*` -> `../src/*`) are followed like relative ones. tsx resolves those
 * aliases at runtime, so treating them as packages would let
 * `import ... from '@app/store/spotStore'` load UI code past the guard.
 *
 * It runs against an injected host, so the same code is exercised on a fake
 * import graph below — a guard that cannot fail proves nothing.
 */
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Crawler (host-agnostic: paths are repo-relative, POSIX-style) ────────

interface ImportHost {
  /** Source text of a repo-relative file, or undefined if it does not exist. */
  read(relPath: string): Promise<string | undefined>;
}

interface ImportEdge {
  from: string;
  to: string;
  specifier: string;
  /** Erased at compile time (`import type`, `export type`, `import('x').T`). */
  typeOnly: boolean;
  /** Resolved through a tsconfig `paths` alias rather than a relative path. */
  viaAlias: boolean;
}

/** One tsconfig `paths` entry, with its targets made repo-relative. */
interface PathAlias {
  /** Specifier pattern as written in tsconfig, with at most one `*`. */
  pattern: string;
  /** Repo-relative targets; the `*` receives what the pattern's `*` matched. */
  targets: string[];
}

interface CrawlResult {
  /** Every reached module → the module that first imported it (null = root). */
  parents: Map<string, string | null>;
  edges: ImportEdge[];
  /** Bare (package) specifiers imported by each reached module. */
  packages: Map<string, string[]>;
  unresolved: { from: string; specifier: string }[];
}

interface Violation {
  module: string;
  reason: string;
  chain: string[];
  /** Reached only through type-level edges: never loaded, still type-checked. */
  typeOnly: boolean;
}

const ALLOWED_DIRECT_SRC_DIRS = ['src/services/', 'src/config/', 'src/types/', 'src/api/'];
const FORBIDDEN_SRC_DIRS = ['src/components/', 'src/hooks/', 'src/store/'];
const UI_PACKAGES = ['react', 'react-dom', 'zustand', 'maplibre-gl', 'react-map-gl', 'lucide-react', 'recharts'];
const PARSED_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

/**
 * Drop comments so a commented-out import never becomes an edge. String
 * literals are matched first and kept, so a `//` inside a URL survives.
 */
function stripComments(source: string): string {
  return source.replace(
    /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (match, literal: string | undefined) => literal ?? (match.startsWith('/*') ? ' ' : ''),
  );
}

/**
 * Module specifiers of every static import/re-export and literal dynamic
 * import. `import { type A } from` counts as a value edge: conservative.
 */
function extractSpecifiers(source: string): { specifier: string; typeOnly: boolean }[] {
  const code = stripComments(source);
  const specs: { specifier: string; typeOnly: boolean }[] = [];
  // import x from '..' · import type { X } from '..' · import '..'
  // export { a } from '..' · export * as ns from '..' · export type { X } from '..'
  const staticRe = /\b(?:import|export)\s+(type\s+)?(?:[\w*{}\s,$]+?\s+from\s*)?(['"])([^'"\n]+)\2/g;
  for (const m of code.matchAll(staticRe)) specs.push({ specifier: m[3], typeOnly: Boolean(m[1]) });
  // import('..') — template literals only without ${} interpolation. Member
  // access straight on the call (`import('x').T`) is a type position: a
  // runtime import returns a Promise, so only then/catch/finally make sense.
  const dynamicRe = /\bimport\s*\(\s*(['"`])([^'"`\n$]+)\1\s*\)(\s*\.\s*(?!then\b|catch\b|finally\b)[A-Za-z_$])?/g;
  for (const m of code.matchAll(dynamicRe)) specs.push({ specifier: m[2], typeOnly: Boolean(m[3]) });
  return specs;
}

function candidatesFor(target: string): string[] {
  const ext = path.posix.extname(target);
  const base = target.slice(0, target.length - ext.length);
  switch (ext) {
    case '.js':
      return [`${base}.ts`, `${base}.tsx`, target];
    case '.jsx':
      return [`${base}.tsx`, target];
    case '.mjs':
      return [`${base}.mts`, target];
    case '.cjs':
      return [`${base}.cts`, target];
    case '.ts':
    case '.tsx':
    case '.mts':
    case '.cts':
    case '.json':
    case '.css':
      return [target];
    default:
      return [
        `${target}.ts`,
        `${target}.tsx`,
        `${target}/index.ts`,
        `${target}/index.tsx`,
        `${target}.js`,
        `${target}/index.js`,
        target,
      ];
  }
}

/**
 * The `paths` aliases a tsconfig declares, targets made repo-relative (against
 * `baseUrl` when set, else the config's own folder). A config without `paths`
 * inherits them through a relative `extends`, as tsc does; later entries of an
 * `extends` array win. Missing config means no aliases.
 */
async function readPathAliases(tsconfigRel: string, host: ImportHost): Promise<PathAlias[]> {
  const text = await host.read(tsconfigRel);
  if (text === undefined) return [];
  // tsconfig is JSONC: comments and trailing commas are legal.
  const config = JSON.parse(stripComments(text).replace(/,(\s*[}\]])/g, '$1'));
  const options = config.compilerOptions ?? {};
  const dir = path.posix.dirname(tsconfigRel);
  if (options.paths) {
    const base = path.posix.join(dir, options.baseUrl ?? '.');
    return Object.entries(options.paths as Record<string, string[]>).map(([pattern, targets]) => ({
      pattern,
      targets: targets.map((t) => path.posix.normalize(path.posix.join(base, t))),
    }));
  }
  const parents = ([] as string[]).concat(config.extends ?? []).filter((p) => p.startsWith('.')).reverse();
  for (const parent of parents) {
    const file = path.posix.normalize(path.posix.join(dir, parent.endsWith('.json') ? parent : `${parent}.json`));
    const inherited = await readPathAliases(file, host);
    if (inherited.length > 0) return inherited;
  }
  return [];
}

/**
 * Repo-relative paths an aliased specifier maps to, or undefined when no alias
 * matches. An exact pattern beats a wildcard; among wildcards the longest
 * prefix wins — the same precedence tsc applies.
 */
function aliasTargets(specifier: string, aliases: PathAlias[]): string[] | undefined {
  let best: { prefixLength: number; targets: string[] } | undefined;
  for (const { pattern, targets } of aliases) {
    const star = pattern.indexOf('*');
    if (star < 0) {
      if (pattern === specifier) return targets;
      continue;
    }
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    const matches = specifier.length >= prefix.length + suffix.length
      && specifier.startsWith(prefix)
      && specifier.endsWith(suffix);
    if (matches && (!best || prefix.length > best.prefixLength)) {
      const captured = specifier.slice(prefix.length, specifier.length - suffix.length);
      best = { prefixLength: prefix.length, targets: targets.map((t) => t.replace('*', captured)) };
    }
  }
  return best?.targets;
}

async function crawlImports(roots: string[], host: ImportHost, aliases: PathAlias[] = []): Promise<CrawlResult> {
  const parents = new Map<string, string | null>();
  const edges: ImportEdge[] = [];
  const packages = new Map<string, string[]>();
  const unresolved: CrawlResult['unresolved'] = [];
  const sources = new Map<string, string | undefined>();

  const read = async (rel: string) => {
    if (!sources.has(rel)) sources.set(rel, await host.read(rel));
    return sources.get(rel);
  };

  const queue: string[] = [];
  for (const root of roots) {
    if (!parents.has(root)) {
      parents.set(root, null);
      queue.push(root);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    // JSON, CSS and declaration files are leaves: checked, never parsed.
    const ext = current.endsWith('.d.ts') ? '.d.ts' : path.posix.extname(current);
    if (!PARSED_EXTENSIONS.has(ext)) continue;
    const source = await read(current);
    if (source === undefined) continue;

    for (const { specifier, typeOnly } of extractSpecifiers(source)) {
      const relative = specifier.startsWith('.');
      const targets = relative
        ? [path.posix.normalize(path.posix.join(path.posix.dirname(current), specifier))]
        : aliasTargets(specifier, aliases);
      // Bare specifiers that no alias claims are packages: recorded, not followed.
      if (!targets) {
        packages.set(current, [...(packages.get(current) ?? []), specifier]);
        continue;
      }
      let resolved: string | undefined;
      search: for (const target of targets) {
        for (const candidate of candidatesFor(target)) {
          if ((await read(candidate)) !== undefined) {
            resolved = candidate;
            break search;
          }
        }
      }
      // An alias that maps to nothing is reported, not waved through as a
      // package: tsc would fall back to node_modules, but here it means the
      // crawl went blind on what may be repo code.
      if (!resolved) {
        unresolved.push({ from: current, specifier });
        continue;
      }
      edges.push({ from: current, to: resolved, specifier, typeOnly, viaAlias: !relative });
      if (!parents.has(resolved)) {
        parents.set(resolved, current);
        queue.push(resolved);
      }
    }
  }
  return { parents, edges, packages, unresolved };
}

function chainTo(module: string, parents: Map<string, string | null>): string[] {
  const chain: string[] = [];
  let cursor: string | null | undefined = module;
  while (cursor) {
    chain.unshift(cursor);
    cursor = parents.get(cursor);
  }
  return chain;
}

/** Modules loaded at runtime: reachable from a root through value edges only. */
function runtimeReachable(result: CrawlResult): Set<string> {
  const roots = [...result.parents].filter(([, parent]) => parent === null).map(([m]) => m);
  const reached = new Set(roots);
  const queue = [...roots];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of result.edges) {
      if (edge.from === current && !edge.typeOnly && !reached.has(edge.to)) {
        reached.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return reached;
}

function findViolations(result: CrawlResult): Violation[] {
  const violations: Violation[] = [];
  const runtime = runtimeReachable(result);

  for (const module of result.parents.keys()) {
    const forbiddenDir = FORBIDDEN_SRC_DIRS.find((dir) => module.startsWith(dir));
    const uiPackage = (result.packages.get(module) ?? []).find((pkg) =>
      UI_PACKAGES.some((ui) => pkg === ui || pkg.startsWith(`${ui}/`)),
    );
    // One reason per module: the first rule that trips is enough to act on.
    const reason = forbiddenDir
      ? `reaches UI code in ${forbiddenDir}`
      : module.endsWith('.tsx')
        ? 'reaches a .tsx module'
        : uiPackage
          ? `reaches a module that imports ${uiPackage}`
          : null;
    if (!reason) continue;
    // One chain per distinct importer, so fixing one path never hides the next.
    const importers = [...new Set(result.edges.filter((e) => e.to === module).map((e) => e.from))];
    const chains = importers.length > 0
      ? importers.map((from) => [...chainTo(from, result.parents), module])
      : [chainTo(module, result.parents)];
    for (const chain of chains) violations.push({ module, reason, chain, typeOnly: !runtime.has(module) });
  }

  for (const edge of result.edges) {
    const fromIngestor = !edge.from.startsWith('src/');
    const intoSrc = edge.to.startsWith('src/');
    if (fromIngestor && intoSrc && !ALLOWED_DIRECT_SRC_DIRS.some((dir) => edge.to.startsWith(dir))) {
      violations.push({
        module: edge.to,
        reason: `ingestor imports src/ outside ${ALLOWED_DIRECT_SRC_DIRS.join(', ')}`,
        chain: [...chainTo(edge.from, result.parents), edge.to],
        typeOnly: edge.typeOnly,
      });
    }
  }
  return violations;
}

function formatViolation(v: Violation): string {
  return `${v.reason}${v.typeOnly ? ' (type-only)' : ''}: ${v.chain.join(' -> ')}`;
}

// ── Hosts ─────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const diskHost: ImportHost = {
  async read(rel) {
    try {
      return await fs.readFile(path.join(REPO_ROOT, rel), 'utf8');
    } catch {
      return undefined; // missing file, or a directory probed as a candidate
    }
  },
};

function fakeHost(files: Record<string, string>): ImportHost {
  return { read: async (rel) => files[rel] };
}

async function ingestorRoots(): Promise<string[]> {
  const entries = await fs.readdir(path.join(REPO_ROOT, 'ingestor'), { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') && !e.name.endsWith('.d.ts'))
    .map((e) => `ingestor/${e.name}`)
    .sort();
}

// ── Tests ─────────────────────────────────────────────────────────────────

/** Type-only chains accepted today. Adding one here needs a reason; removing one is progress. */
const KNOWN_TYPE_ONLY = [
  'reaches UI code in src/components/ (type-only): ingestor/analyzer.ts -> src/services/windUtils.ts -> src/components/icons/WeatherIcons.tsx',
  'reaches UI code in src/components/ (type-only): ingestor/analyzer.ts -> src/config/spots.ts -> src/components/icons/WeatherIcons.tsx',
  'reaches UI code in src/components/ (type-only): ingestor/discover.ts -> src/config/sectors.ts -> src/components/icons/WeatherIcons.tsx',
];

describe('ingestor → src boundary (real tree)', () => {
  it('reaches only pure shared modules, never UI code', async () => {
    const roots = await ingestorRoots();
    const aliases = await readPathAliases('ingestor/tsconfig.json', diskHost);
    const result = await crawlImports(roots, diskHost, aliases);

    // Not vacuous: the crawl really walks into the shared code.
    const reachedSrc = [...result.parents.keys()].filter((m) => m.startsWith('src/'));
    expect(roots.length).toBeGreaterThan(20);
    expect(reachedSrc.length).toBeGreaterThan(10);
    expect(reachedSrc).toContain('src/services/cesantesCanalizationDetector.ts');
    expect(reachedSrc).toContain('src/api/skyxClient.ts');

    // A relative import that resolves to nothing means the crawl went blind there.
    expect(result.unresolved.map((u) => `${u.from} imports missing ${u.specifier}`)).toEqual([]);
    const violations = findViolations(result);
    // Runtime: never. These are the ones that would load React/UI code in node.
    expect(violations.filter((v) => !v.typeOnly).map(formatViolation)).toEqual([]);
    // Type-only: known debt, pinned so it cannot grow unnoticed. IconId is declared
    // inside a .tsx component; moving it to a pure module clears all three.
    expect(violations.filter((v) => v.typeOnly).map(formatViolation).sort()).toEqual([...KNOWN_TYPE_ONLY].sort());

    // The deploy script decides whether to restart the ingestor by tracing its
    // RELATIVE imports into src/. A module reached through an alias would
    // change on deploy without that restart, so aliases stay out of this graph
    // until the script follows them too.
    expect(result.edges.filter((e) => e.viaAlias).map((e) => `${e.from} -> ${e.specifier}`)).toEqual([]);
  });
});

describe('boundary crawler (fake import graph)', () => {
  it('flags UI code reached through a shared module and prints the whole chain', async () => {
    const host = fakeHost({
      'ingestor/analyzer.ts': "import { score } from '../src/services/engine.js';\n",
      'src/services/engine.ts': "export * from '../store/spotStore.js';\nexport const score = 1;\n",
      'src/store/spotStore.ts': 'export const useSpotStore = {};\n',
    });
    const result = await crawlImports(['ingestor/analyzer.ts'], host);
    const violations = findViolations(result);

    expect(violations).toHaveLength(1);
    expect(violations[0].module).toBe('src/store/spotStore.ts');
    expect(violations[0].chain).toEqual([
      'ingestor/analyzer.ts',
      'src/services/engine.ts',
      'src/store/spotStore.ts',
    ]);
    expect(formatViolation(violations[0])).toBe(
      'reaches UI code in src/store/: ingestor/analyzer.ts -> src/services/engine.ts -> src/store/spotStore.ts',
    );
  });

  it('follows import type, multi-line imports and literal dynamic imports into .tsx and hooks', async () => {
    const host = fakeHost({
      'ingestor/api.ts': [
        "import type { Row } from '../src/types/row.js';",
        'export async function load() {',
        "  const m = await import('../src/config/panel.js');",
        '  return m;',
        '}',
      ].join('\n'),
      'src/types/row.ts': [
        'import {',
        '  useThing,',
        '  type Other,',
        "} from '../hooks/useThing';",
        'export type Row = { a: number };',
      ].join('\n'),
      'src/hooks/useThing/index.ts': 'export const useThing = 1;\n',
      'src/config/panel.tsx': 'export const Panel = () => null;\n',
    });
    const result = await crawlImports(['ingestor/api.ts'], host);
    const byModule = Object.fromEntries(findViolations(result).map((v) => [v.module, v]));

    expect(byModule['src/hooks/useThing/index.ts'].chain).toEqual([
      'ingestor/api.ts',
      'src/types/row.ts',
      'src/hooks/useThing/index.ts',
    ]);
    // Only reachable through `import type`, so it never loads — but it still counts.
    expect(byModule['src/hooks/useThing/index.ts'].typeOnly).toBe(true);
    expect(byModule['src/config/panel.tsx'].chain).toEqual(['ingestor/api.ts', 'src/config/panel.tsx']);
    expect(byModule['src/config/panel.tsx'].typeOnly).toBe(false);
  });

  it('flags a type pulled from a component, once per importing path', async () => {
    const host = fakeHost({
      'ingestor/analyzer.ts': [
        "import { icon } from '../src/services/windUtils.js';",
        "import { SPOTS } from '../src/config/spots.js';",
      ].join('\n'),
      'src/services/windUtils.ts':
        "export function icon(): import('../components/icons/WeatherIcons').IconId { return 'sun'; }\n",
      'src/config/spots.ts': "import type { IconId } from '../components/icons/WeatherIcons';\nexport const SPOTS: IconId[] = [];\n",
      'src/components/icons/WeatherIcons.tsx': "import { Sun } from 'lucide-react';\nexport type IconId = 'sun';\n",
    });
    const violations = findViolations(await crawlImports(['ingestor/analyzer.ts'], host));

    expect(violations.map(formatViolation)).toEqual([
      'reaches UI code in src/components/ (type-only): ingestor/analyzer.ts -> src/services/windUtils.ts -> src/components/icons/WeatherIcons.tsx',
      'reaches UI code in src/components/ (type-only): ingestor/analyzer.ts -> src/config/spots.ts -> src/components/icons/WeatherIcons.tsx',
    ]);
  });

  it('flags a shared module that pulls in a UI framework package', async () => {
    const host = fakeHost({
      'ingestor/dailySummary.ts': "import { fmt } from '../src/services/format.js';\n",
      'src/services/format.ts': "import { useStore } from 'zustand';\nexport const fmt = useStore;\n",
    });
    const violations = findViolations(await crawlImports(['ingestor/dailySummary.ts'], host));

    expect(violations.map(formatViolation)).toEqual([
      'reaches a module that imports zustand: ingestor/dailySummary.ts -> src/services/format.ts',
    ]);
  });

  it('flags a direct ingestor import into a src folder outside the shared four', async () => {
    const host = fakeHost({
      'ingestor/index.ts': "import { x } from '../src/widget/util.js';\n",
      'src/widget/util.ts': 'export const x = 1;\n',
    });
    const violations = findViolations(await crawlImports(['ingestor/index.ts'], host));

    expect(violations).toHaveLength(1);
    expect(violations[0].chain).toEqual(['ingestor/index.ts', 'src/widget/util.ts']);
  });

  it('stays clean on a pure graph: comments, packages and computed imports are not edges', async () => {
    const host = fakeHost({
      'ingestor/fetchers.ts': [
        "import pg from 'pg';",
        "// import { useStore } from '../src/store/weatherStore.js';",
        "/* export * from '../src/components/Map.js'; */",
        "const url = 'https://example.org/a//b';",
        "const name = 'dyn';",
        'const m = await import(`../src/hooks/${name}.js`);',
        "import { skyX } from '../src/api/skyxClient.js';",
      ].join('\n'),
      'src/api/skyxClient.ts': "import { SECTORS } from '../config/sectors';\nexport const skyX = SECTORS;\n",
      'src/config/sectors.ts': 'export const SECTORS = [];\n',
    });
    const result = await crawlImports(['ingestor/fetchers.ts'], host);

    expect([...result.parents.keys()].sort()).toEqual([
      'ingestor/fetchers.ts',
      'src/api/skyxClient.ts',
      'src/config/sectors.ts',
    ]);
    expect(findViolations(result)).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });

  it('follows a tsconfig path alias instead of mistaking it for a package', async () => {
    // tsx resolves `paths` at runtime: this import really loads the store.
    const host = fakeHost({
      'ingestor/tsconfig.json': [
        '{',
        '  // JSONC, as tsconfig allows',
        '  "compilerOptions": { "paths": { "@app/*": ["../src/*"] }, },',
        '}',
      ].join('\n'),
      'ingestor/a.ts': "import pg from 'pg';\nimport { useSpotStore } from '@app/store/spotStore';\n",
      'src/store/spotStore.ts': "import { create } from 'zustand';\nexport const useSpotStore = create;\n",
    });
    const aliases = await readPathAliases('ingestor/tsconfig.json', host);
    expect(aliases).toEqual([{ pattern: '@app/*', targets: ['src/*'] }]);

    const result = await crawlImports(['ingestor/a.ts'], host, aliases);
    expect(result.packages.get('ingestor/a.ts')).toEqual(['pg']);
    expect(result.edges).toContainEqual(
      expect.objectContaining({ from: 'ingestor/a.ts', to: 'src/store/spotStore.ts', viaAlias: true }),
    );
    expect(findViolations(result).map(formatViolation)).toEqual([
      'reaches UI code in src/store/: ingestor/a.ts -> src/store/spotStore.ts',
      'ingestor imports src/ outside src/services/, src/config/, src/types/, src/api/: ingestor/a.ts -> src/store/spotStore.ts',
    ]);
  });

  it('resolves aliases through baseUrl and extends, longest prefix first, and reports dead ones', async () => {
    const host = fakeHost({
      'tsconfig.base.json': JSON.stringify({
        compilerOptions: { baseUrl: '.', paths: { '@app/*': ['src/*'], '@app/ui/*': ['src/components/*'] } },
      }),
      'ingestor/tsconfig.json': JSON.stringify({ extends: '../tsconfig.base', compilerOptions: { strict: true } }),
      'ingestor/a.ts': "import { Panel } from '@app/ui/Panel';\nimport { x } from '@app/gone/x';\n",
      'src/components/Panel.tsx': 'export const Panel = () => null;\n',
    });
    const aliases = await readPathAliases('ingestor/tsconfig.json', host);
    const result = await crawlImports(['ingestor/a.ts'], host, aliases);

    expect(result.edges.map((e) => e.to)).toEqual(['src/components/Panel.tsx']);
    expect(result.unresolved).toEqual([{ from: 'ingestor/a.ts', specifier: '@app/gone/x' }]);
    expect(findViolations(result)[0].chain).toEqual(['ingestor/a.ts', 'src/components/Panel.tsx']);
  });

  it('reports relative imports that resolve to nothing', async () => {
    const host = fakeHost({ 'ingestor/db.ts': "import type { R } from '../src/types/gone.js';\n" });
    const result = await crawlImports(['ingestor/db.ts'], host);

    expect(result.unresolved).toEqual([{ from: 'ingestor/db.ts', specifier: '../src/types/gone.js' }]);
  });
});
