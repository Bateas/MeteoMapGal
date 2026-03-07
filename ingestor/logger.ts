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
  return new Date().toISOString().slice(11, 19); // HH:MM:SS
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
