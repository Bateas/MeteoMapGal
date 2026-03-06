/**
 * App version — read from package.json at build time via Vite.
 * Single source of truth: only update version in package.json.
 */

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — Vite resolves this at build time
import pkg from '../../package.json';

export const APP_VERSION: string = pkg.version;
