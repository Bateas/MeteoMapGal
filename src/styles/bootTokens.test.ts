/**
 * The loading screen is drawn before any of the app's code has run, so index.html repeats the colours of the V3
 * tokens by hand. If one changes without the other, the jump from the loading screen to the app shows.
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

const html = await read('index.html');
const tokens = await read('src/styles/v3tokens.css');

function blockOf(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
}
const value = (block: string, name: string) => new RegExp(`${name}:\\s*(#[0-9a-f]+)`).exec(block)?.[1];

describe('the colours of the loading screen', () => {
  const NAMES = ['--g-bg', '--g-ink', '--g-muted', '--g-hair', '--g-rule', '--g-s-flojo', '--g-s-navegable', '--g-s-bueno'];

  it.each(NAMES)('%s is the same as the V3 token, dark and light', (name) => {
    const dark = value(blockOf(tokens, ':root'), name);
    const light = value(blockOf(tokens, ':root[data-theme="light"]'), name);
    expect(dark).toBeTruthy();
    expect(light).toBeTruthy();
    expect(value(blockOf(html, ':root'), name)).toBe(dark);
    expect(value(blockOf(html, ':root[data-theme="light"]'), name)).toBe(light);
  });

  it('the bar of the browser and the installed app open with the same paper', async () => {
    const dark = value(blockOf(tokens, ':root'), '--g-bg');
    const light = value(blockOf(tokens, ':root[data-theme="light"]'), '--g-bg');
    expect(html.includes(`<meta name="theme-color" content="${dark}" />`)).toBe(true);
    expect(html.includes(`'content', '${light}'`)).toBe(true);
    const manifest = JSON.parse(await read('public/manifest.json'));
    expect(manifest.background_color).toBe(dark);
    expect(manifest.theme_color).toBe(dark);
  });

  it('reads the theme from where the store saves it', async () => {
    expect(await read('src/store/themeStore.ts')).toContain("name: 'meteomap-theme'");
    expect(html.includes("localStorage.getItem('meteomap-theme')")).toBe(true);
  });

  it('the app takes over with the classes the page has already drawn', async () => {
    const screen = await read('src/components/common/LoadingScreen.tsx');
    for (const cls of ['gc-boot-mark', 'gc-boot-name', 'gc-boot-state', 'gc-boot-bar']) {
      expect(html.includes(`.${cls}`), cls).toBe(true);
      expect(screen).toContain(cls);
    }
  });
});
