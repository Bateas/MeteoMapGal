/**
 * CSV security utilities — shared escaping for all CSV exports.
 *
 * Prevents CSV injection attacks where cell values starting with
 * =, +, -, @, \t, \r are interpreted as formulas by spreadsheet apps
 * (Excel, LibreOffice Calc, Google Sheets).
 *
 * @see https://owasp.org/www-community/attacks/CSV_Injection
 */

/**
 * Escape a single CSV field to prevent formula injection and handle
 * embedded delimiters (commas, semicolons, quotes, newlines).
 *
 * Strategy: wrap in double-quotes and escape inner quotes when the
 * value contains dangerous prefixes or structural characters.
 */
export function escapeCSV(value: string, delimiter: ',' | ';' = ','): string {
  // Dangerous formula prefixes — spreadsheet apps treat these as executable
  const FORMULA_PREFIX = /^[=+\-@\t\r]/;

  if (FORMULA_PREFIX.test(value) || value.includes(delimiter) || /["\n\r]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/**
 * Escape a numeric value for CSV. Numbers are safe from injection,
 * but we guard NaN/Infinity → empty string.
 */
export function escapeCSVNumber(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return value.toFixed(decimals);
}
