/**
 * Simple timestamped logger for the ingestor and the API.
 * Prefixes all messages with the local date and time + level.
 */

// Colour only on a terminal. In production the services append to a file, where the escape
// codes are noise for grep and for anything that parses the lines.
const USE_COLOR = process.stdout.isTTY === true;
const c = (code: string) => (USE_COLOR ? code : '');
const COLORS = {
  reset: c('\x1b[0m'),
  dim: c('\x1b[2m'),
  green: c('\x1b[32m'),
  yellow: c('\x1b[33m'),
  red: c('\x1b[31m'),
  cyan: c('\x1b[36m'),
} as const;

// Debug logs are off by default to keep journalctl quiet on routine
// no-activity polls (e.g. "0 strikes in window" on calm winter nights).
// Set INGESTOR_DEBUG=true in the systemd Environment block to re-enable
// when investigating a specific issue.
const DEBUG_ENABLED = process.env.INGESTOR_DEBUG === 'true';

function ts(): string {
  // Local date and time, YYYY-MM-DD HH:MM:SS — matches the host TZ (Europe/Madrid in prod), so
  // it greps against `date` without a UTC/CEST shift. The date matters: the files are kept for
  // months, and a bare HH:MM:SS cannot tell one day from another.
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export const log = {
  info(msg: string, ...args: unknown[]) {
    console.log(`${COLORS.dim}${ts()}${COLORS.reset} ${COLORS.cyan}INFO${COLORS.reset}  ${msg}`, ...args);
  },
  ok(msg: string, ...args: unknown[]) {
    console.log(`${COLORS.dim}${ts()}${COLORS.reset} ${COLORS.green}OK${COLORS.reset}    ${msg}`, ...args);
  },
  warn(msg: string, ...args: unknown[]) {
    console.warn(`${COLORS.dim}${ts()}${COLORS.reset} ${COLORS.yellow}WARN${COLORS.reset}  ${msg}`, ...args);
  },
  error(msg: string, ...args: unknown[]) {
    console.error(`${COLORS.dim}${ts()}${COLORS.reset} ${COLORS.red}ERROR${COLORS.reset} ${msg}`, ...args);
  },
  debug(msg: string, ...args: unknown[]) {
    if (!DEBUG_ENABLED) return;
    console.log(`${COLORS.dim}${ts()} DEBUG ${msg}${COLORS.reset}`, ...args);
  },
};
