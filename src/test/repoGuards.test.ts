/**
 * This repository is PUBLIC. On 5-oct-2026 its history had to be rewritten
 * because commits made from a clone WITHOUT the leak hooks published a database
 * host, a login, local paths and private notes. These tests make a clone without
 * the hooks fail loudly the first time anyone (or any assistant) runs the tests,
 * instead of finding out from GitHub.
 */
import { describe, it, expect } from 'vitest';

// Node modules through a string variable, as in contrastTokens.test.ts: the app
// tsconfig carries no Node types (a static 'node:fs' import fails tsc -b), and
// the test always runs under Node.
const [cpModule, fsModule, pathModule, urlModule] = ['node:child_process', 'node:fs', 'node:path', 'node:url'];
const { execSync } = await import(/* @vite-ignore */ cpModule);
const { existsSync } = await import(/* @vite-ignore */ fsModule);
const { join, dirname } = await import(/* @vite-ignore */ pathModule);
const { fileURLToPath } = await import(/* @vite-ignore */ urlModule);

// The repository root: two levels up from this file (src/test/).
const root: string = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const isClone = existsSync(join(root, '.git'));

function git(args: string): string {
  try {
    return execSync(`git ${args}`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

describe.skipIf(!isClone)('repository guards (this repository is public)', () => {
  it('runs the leak hooks: core.hooksPath points at .githooks', () => {
    expect(git('config core.hooksPath'), 'Run once in this clone: git config core.hooksPath .githooks').toBe('.githooks');
  });

  it('has the commit, message and push hooks', () => {
    for (const hook of ['pre-commit', 'commit-msg', 'pre-push']) {
      expect(existsSync(join(root, '.githooks', hook)), `.githooks/${hook} is missing`).toBe(true);
    }
  });

  it('publishes nothing the allowlist .gitignore would keep out', () => {
    // A tracked file that the ignore rules exclude was force-added or predates
    // the allowlist: either way it is published without anyone having said so.
    expect(git('ls-files -ci --exclude-standard')).toBe('');
  });

  it('publishes no notes or documents beyond the README', () => {
    const docs = git('ls-files')
      .split('\n')
      .filter((p) => /\.(md|pdf|docx?|odt|html?)$/i.test(p))
      .filter((p) => !['README.md', 'index.html', 'widget.html'].includes(p));
    expect(docs).toEqual([]);
  });
});
