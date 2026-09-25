import { describe, it, expect } from 'vitest';
import { mainBundleOf, isNewerDeploy } from './versionCheck';

const page = (hash: string) =>
  `<!doctype html><head><script type="module" crossorigin src="/assets/main-${hash}.js"></script></head>`;

describe('versionCheck', () => {
  it('reads the entry bundle from the published page', () => {
    expect(mainBundleOf(page('BUyH-EXi'))).toBe('main-BUyH-EXi.js');
    expect(mainBundleOf('<html>no bundle</html>')).toBeNull();
  });

  it('says new only when the published entry differs from the loaded one', () => {
    expect(isNewerDeploy('/assets/main-OLD111.js', page('NEW222'))).toBe(true);
    expect(isNewerDeploy('/assets/main-SAME33.js', page('SAME33'))).toBe(false);
  });

  it('never asks to reload on missing information (error page, dev server)', () => {
    expect(isNewerDeploy(null, page('NEW222'))).toBe(false);
    expect(isNewerDeploy('/assets/main-OLD111.js', '<h1>502 Bad Gateway</h1>')).toBe(false);
    expect(isNewerDeploy('/src/main.tsx', page('NEW222'))).toBe(false);
  });
});
