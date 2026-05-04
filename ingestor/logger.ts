/**
 * Simple timestamped logger for the ingestor.
 * Prefixes all messages with ISO timestamp + level.
 */

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
} as const;

function ts(): string {
  // Local time HH:MM:SS — matches the host TZ (Europe/Madrid in prod).
  // Avoids the UTC vs CEST mismatch when grepping logs against `date`.
  const d = new Date();
  return [
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
    String(d.getSeconds()).padStart(2, '0'),
  ].join(':');
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
};
