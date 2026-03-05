import { describe, it, expect } from 'vitest';
import { escapeCSV, escapeCSVNumber } from './csvUtils';

describe('escapeCSV', () => {
  // ── Formula injection prevention ─────────────────────────
  it('escapes values starting with = (formula prefix)', () => {
    expect(escapeCSV('=cmd|calc')).toBe('"=cmd|calc"');
  });

  it('escapes values starting with + (formula prefix)', () => {
    expect(escapeCSV('+SUM(A1:A10)')).toBe('"+SUM(A1:A10)"');
  });

  it('escapes values starting with - (formula prefix)', () => {
    expect(escapeCSV('-1+cmd|calc')).toBe('"-1+cmd|calc"');
  });

  it('escapes values starting with @ (formula prefix)', () => {
    expect(escapeCSV('@SUM(A1)')).toBe('"@SUM(A1)"');
  });

  it('escapes values starting with tab character', () => {
    expect(escapeCSV('\tdata')).toBe('"\tdata"');
  });

  it('escapes values starting with carriage return', () => {
    expect(escapeCSV('\rdata')).toBe('"\rdata"');
  });

  // ── Real-world CSV injection payloads ────────────────────
  it('blocks DDE attack payload', () => {
    const payload = '=cmd|"/c notepad"!A1';
    const result = escapeCSV(payload);
    // Inner quotes are doubled, whole value wrapped in quotes
    expect(result).toBe('"=cmd|""/c notepad""!A1"');
    expect(result.startsWith('"')).toBe(true);
  });

  it('blocks HYPERLINK injection', () => {
    const payload = '=HYPERLINK("https://evil.com","Click")';
    const result = escapeCSV(payload);
    expect(result.startsWith('"')).toBe(true);
  });

  // ── Structural character handling ────────────────────────
  it('escapes values containing comma (default delimiter)', () => {
    expect(escapeCSV('San Martín, Ourense')).toBe('"San Martín, Ourense"');
  });

  it('escapes values containing semicolon when delimiter is ;', () => {
    expect(escapeCSV('value;with;semis', ';')).toBe('"value;with;semis"');
  });

  it('does NOT escape semicolons with comma delimiter', () => {
    expect(escapeCSV('value;safe', ',')).toBe('value;safe');
  });

  it('escapes embedded double quotes', () => {
    expect(escapeCSV('said "hello"')).toBe('"said ""hello"""');
  });

  it('escapes embedded newlines', () => {
    expect(escapeCSV('line1\nline2')).toBe('"line1\nline2"');
  });

  // ── Safe values pass through ─────────────────────────────
  it('does not escape normal station names', () => {
    expect(escapeCSV('EVEGA Leiro')).toBe('EVEGA Leiro');
  });

  it('does not escape alphanumeric IDs', () => {
    expect(escapeCSV('aemet_1690B')).toBe('aemet_1690B');
  });

  it('does not escape numeric strings', () => {
    expect(escapeCSV('42.29')).toBe('42.29');
  });

  it('handles empty string', () => {
    expect(escapeCSV('')).toBe('');
  });

  it('handles single character safe values', () => {
    expect(escapeCSV('A')).toBe('A');
  });

  // ── Spanish station names with accents ───────────────────
  it('preserves accented characters', () => {
    expect(escapeCSV('Cequeliños')).toBe('Cequeliños');
  });

  it('preserves ñ and special chars', () => {
    expect(escapeCSV('Remuíño (MG)')).toBe('Remuíño (MG)');
  });
});

describe('escapeCSVNumber', () => {
  it('formats normal numbers with default decimals', () => {
    expect(escapeCSVNumber(12.345)).toBe('12.3');
  });

  it('formats with custom decimal places', () => {
    expect(escapeCSVNumber(12.345, 2)).toBe('12.35');
  });

  it('returns empty string for null', () => {
    expect(escapeCSVNumber(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(escapeCSVNumber(undefined)).toBe('');
  });

  it('returns empty string for NaN', () => {
    expect(escapeCSVNumber(NaN)).toBe('');
  });

  it('returns empty string for Infinity', () => {
    expect(escapeCSVNumber(Infinity)).toBe('');
  });

  it('returns empty string for -Infinity', () => {
    expect(escapeCSVNumber(-Infinity)).toBe('');
  });

  it('handles zero correctly', () => {
    expect(escapeCSVNumber(0)).toBe('0.0');
  });

  it('handles negative numbers', () => {
    expect(escapeCSVNumber(-5.67, 1)).toBe('-5.7');
  });
});
