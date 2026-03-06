/**
 * App version — read from package.json at build time via Vite.
 * Single source of truth: only update version in package.json.
 */
import pkg from '../../package.json';

export const APP_VERSION: string = pkg.version;
