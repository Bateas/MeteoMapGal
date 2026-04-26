/**
 * Tests for feedbackSanitize — XSS / SQLi / control-char defense for user feedback.
 *
 * SECURITY-CRITICAL: this is the last line of defense between user input and
 * the n8n webhook → Telegram. Bug here = XSS in admin Telegram, SQL injection
 * if downstream stores feedback in DB. Used by FeedbackModal + ingestor webhook.
 */

import { describe, it, expect } from 'vitest';
import { sanitize, MAX_CHARS, VALID_TYPES } from './feedbackSanitize';

// ── HTML / script injection ──────────────────────────────────

describe('sanitize — HTML/XSS defense', () => {
  it('strips simple HTML tags', () => {
    expect(sanitize('hola <script>alert(1)</script> mundo')).not.toContain('<');
    expect(sanitize('hola <script>alert(1)</script> mundo')).not.toContain('>');
  });

  it('strips img tag with onerror payload', () => {
    const out = sanitize('<img src=x onerror=alert(1)>');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('<');
  });

  it('strips iframe', () => {
    expect(sanitize('<iframe src="evil.com"></iframe>')).not.toContain('iframe');
  });

  it('removes javascript: protocol', () => {
    expect(sanitize('click javascript:alert(1)')).not.toContain('javascript:');
  });

  it('removes data: protocol', () => {
    expect(sanitize('a data:text/html,<script>')).not.toContain('data:');
  });

  it('case-insensitive javascript:', () => {
    expect(sanitize('JaVaScRiPt:foo')).not.toMatch(/javascript/i);
  });
});

// ── SQL injection patterns ───────────────────────────────────

describe('sanitize — SQL injection defense', () => {
  it('strips DROP TABLE pattern', () => {
    const out = sanitize("'; DROP TABLE users; --");
    expect(out.toUpperCase()).not.toContain('DROP TABLE');
  });

  it('strips DELETE FROM pattern', () => {
    const out = sanitize('DELETE FROM readings WHERE 1=1');
    expect(out.toUpperCase()).not.toContain('DELETE FROM');
  });

  it('strips UNION SELECT pattern', () => {
    const out = sanitize('UNION SELECT * FROM secrets');
    expect(out.toUpperCase()).not.toContain('UNION SELECT');
  });

  it('strips INSERT INTO', () => {
    expect(sanitize('INSERT INTO users VALUES (1)').toUpperCase()).not.toContain('INSERT INTO');
  });

  it('case-insensitive (Drop Table, drop table)', () => {
    expect(sanitize('Drop Table foo').toUpperCase()).not.toContain('DROP TABLE');
    expect(sanitize('drop table foo').toUpperCase()).not.toContain('DROP TABLE');
  });

  it('preserves the word "drop" alone (no false positive)', () => {
    // "drop" without the keyword TABLE/FROM/INTO etc. should NOT be sanitized
    expect(sanitize('we should drop this idea')).toContain('drop');
  });

  it('preserves "select" in normal context', () => {
    expect(sanitize('please select an option')).toContain('select');
  });
});

// ── Control characters ──────────────────────────────────────

describe('sanitize — control chars', () => {
  it('strips null bytes', () => {
    expect(sanitize('hola\x00mundo')).toBe('holamundo');
  });

  it('strips backspace + DEL', () => {
    expect(sanitize('a\x08b\x7Fc')).toBe('abc');
  });

  it('preserves newlines (\\n is in \\s of SAFE_CHARS)', () => {
    // \n is 0x0A — NOT in control-char strip range (0x00-0x08, 0x0B-0x1F)
    // AND \s in SAFE_CHARS regex includes \n → preserved
    expect(sanitize('line1\nline2')).toBe('line1\nline2');
  });

  it('preserves tabs (\\t is in \\s of SAFE_CHARS)', () => {
    // Tab \x09 — NOT in control range, AND \s allows it → preserved
    expect(sanitize('a\tb')).toBe('a\tb');
  });
});

// ── Character whitelist ─────────────────────────────────────

describe('sanitize — character whitelist', () => {
  it('preserves Spanish accented letters (ñ á é í ó ú ü)', () => {
    expect(sanitize('Niño año Coruña Vigo')).toBe('Niño año Coruña Vigo');
  });

  it('preserves basic punctuation .,!?¿¡:;()-/', () => {
    const out = sanitize('Hola, ¿qué tal? ¡Bien! (gracias) 1/2.');
    expect(out).toContain('¿');
    expect(out).toContain('¡');
    expect(out).toContain(',');
    expect(out).toContain('.');
    expect(out).toContain('?');
    expect(out).toContain('!');
  });

  it('strips emoji', () => {
    expect(sanitize('hola 🚀 mundo')).not.toContain('🚀');
  });

  it('strips backticks (potential template injection)', () => {
    expect(sanitize('hola `code` mundo')).not.toContain('`');
  });

  it('strips angle brackets even when not part of HTML', () => {
    // After HTML strip pass, angle brackets that survive are matched by
    // SAFE_CHARS regex. This catches "5 < 10".
    expect(sanitize('5 < 10 is true')).not.toContain('<');
  });

  it('strips dollar signs (template literal injection)', () => {
    expect(sanitize('cost $100 ${malicious}')).not.toContain('$');
  });
});

// ── Length limit ─────────────────────────────────────────────

describe('sanitize — length cap', () => {
  it(`enforces MAX_CHARS=${MAX_CHARS} ceiling`, () => {
    const longInput = 'a'.repeat(MAX_CHARS + 100);
    expect(sanitize(longInput).length).toBe(MAX_CHARS);
  });

  it('preserves shorter input as-is', () => {
    const input = 'hola mundo';
    expect(sanitize(input).length).toBe(input.length);
  });

  it('trims whitespace before applying length cap', () => {
    expect(sanitize('  hola  ')).toBe('hola');
  });
});

// ── Constants ───────────────────────────────────────────────

describe('feedbackSanitize — exported constants', () => {
  it('VALID_TYPES contains exactly 3 types', () => {
    expect(VALID_TYPES).toEqual(['sugerencia', 'bug', 'otro']);
  });

  it('MAX_CHARS is reasonable (>=100, <=1000)', () => {
    expect(MAX_CHARS).toBeGreaterThanOrEqual(100);
    expect(MAX_CHARS).toBeLessThanOrEqual(1000);
  });
});

// ── Combined attack vectors ─────────────────────────────────

describe('sanitize — defense in depth', () => {
  it('strips HTML + JS protocol + SQL in same input', () => {
    const out = sanitize('<a href="javascript:alert(1)">DROP TABLE x</a>');
    expect(out).not.toContain('<');
    expect(out).not.toContain('javascript');
    expect(out.toUpperCase()).not.toContain('DROP TABLE');
  });

  it('handles empty string', () => {
    expect(sanitize('')).toBe('');
  });

  it('handles whitespace-only input', () => {
    expect(sanitize('   \t  ')).toBe('');
  });

  it('returns string for any input (never undefined/null)', () => {
    expect(typeof sanitize('hola')).toBe('string');
    expect(typeof sanitize('')).toBe('string');
  });
});
