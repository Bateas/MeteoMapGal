import { describe, it, expect } from 'vitest';
import { sanitize, VALID_TYPES } from '../../services/feedbackSanitize';

describe('FeedbackModal sanitize()', () => {
  // ── HTML injection ────────────────────────────
  it('strips HTML tags', () => {
    expect(sanitize('<script>alert("xss")</script>Hola')).toBe('alert(xss)Hola');
  });

  it('strips nested HTML', () => {
    expect(sanitize('<div><b>bold</b></div>')).toBe('bold');
  });

  it('strips event handler attributes', () => {
    expect(sanitize('<img onerror="alert(1)" src=x>')).toBe('');
  });

  it('strips SVG injection', () => {
    expect(sanitize('<svg onload="alert(1)"></svg>')).toBe('');
  });

  // ── Protocol injection ────────────────────────
  it('strips javascript: protocol', () => {
    expect(sanitize('javascript:alert(1)')).not.toContain('javascript:');
  });

  it('strips javascript: with spaces', () => {
    expect(sanitize('javascript :alert(1)')).not.toContain('javascript');
  });

  it('strips data: protocol', () => {
    const result = sanitize('data:text/html,<script>alert(1)</script>');
    expect(result).not.toContain('data:');
    expect(result).not.toContain('<script>');
  });

  // ── Control characters ────────────────────────
  it('removes null bytes', () => {
    expect(sanitize('Hola\x00mundo')).toBe('Holamundo');
  });

  it('removes bell and other control chars', () => {
    expect(sanitize('test\x07\x08\x0B\x1F')).toBe('test');
  });

  // ── Dangerous characters stripped by SAFE_CHARS ──
  it('strips curly braces (template literals)', () => {
    expect(sanitize('${process.env.SECRET}')).not.toContain('${');
  });

  it('strips backticks', () => {
    expect(sanitize('`rm -rf /`')).not.toContain('`');
  });

  it('strips angle brackets outside tags', () => {
    const result = sanitize('a > b && c < d');
    expect(result).not.toContain('>');
    expect(result).not.toContain('<');
  });

  it('strips pipe and ampersand', () => {
    const result = sanitize('cmd | cat && echo');
    expect(result).not.toContain('|');
    expect(result).not.toContain('&');
  });

  it('strips square brackets', () => {
    expect(sanitize('[constructor]')).not.toContain('[');
  });

  // ── SQL injection patterns ────────────────────
  it('neutralizes DROP TABLE', () => {
    expect(sanitize('DROP TABLE users')).not.toContain('DROP TABLE');
  });

  it('neutralizes UNION SELECT', () => {
    expect(sanitize("' UNION SELECT * FROM passwords --")).not.toContain('UNION SELECT');
  });

  it('neutralizes DELETE FROM', () => {
    expect(sanitize('DELETE FROM sessions WHERE 1=1')).not.toContain('DELETE FROM');
  });

  it('neutralizes INSERT INTO', () => {
    expect(sanitize("INSERT INTO admin VALUES('hack')")).not.toContain('INSERT INTO');
  });

  it('neutralizes case-insensitive SQL', () => {
    expect(sanitize('drop table Users')).not.toContain('drop table');
  });

  // ── Length limits ─────────────────────────────
  it('truncates to 300 chars', () => {
    expect(sanitize('A'.repeat(500))).toHaveLength(300);
  });

  it('trims whitespace', () => {
    expect(sanitize('  Hola mundo  ')).toBe('Hola mundo');
  });

  // ── Safe content preservation ─────────────────
  it('preserves Spanish accented characters', () => {
    expect(sanitize('El viento está fuerte en la ría')).toBe('El viento está fuerte en la ría');
  });

  it('preserves French/Portuguese accents', () => {
    expect(sanitize('café résumé naïve')).toBe('café résumé naïve');
  });

  it('preserves basic punctuation', () => {
    expect(sanitize('Hola! ¿Que tal? Bien, gracias.')).toBe('Hola! ¿Que tal? Bien, gracias.');
  });

  it('preserves numbers and colons', () => {
    expect(sanitize('Viento 15kt a las 14:30')).toBe('Viento 15kt a las 14:30');
  });

  it('preserves parentheses and hyphens', () => {
    expect(sanitize('Bug (critico) - no funciona')).toBe('Bug (critico) - no funciona');
  });

  it('preserves apostrophe', () => {
    expect(sanitize("l'eau c'est la vie")).toBe("l'eau c'est la vie");
  });

  // ── Honeypot field ────────────────────────────
  it('empty honeypot passes (real user)', () => {
    const honeypot = '';
    expect(honeypot).toBe('');
    expect(honeypot).toBeFalsy();
  });

  it('filled honeypot is detected (bot)', () => {
    const honeypot = 'spam@evil.com';
    expect(honeypot).toBeTruthy();
  });

  // ── Type validation ───────────────────────────
  it('validates allowed feedback types', () => {
    expect(VALID_TYPES).toContain('sugerencia');
    expect(VALID_TYPES).toContain('bug');
    expect(VALID_TYPES).toContain('otro');
    expect(VALID_TYPES).not.toContain('admin');
    expect(VALID_TYPES).not.toContain('<script>');
  });

  // ── Edge cases ────────────────────────────────
  it('handles empty string', () => {
    expect(sanitize('')).toBe('');
  });

  it('handles only whitespace', () => {
    expect(sanitize('   ')).toBe('');
  });

  it('handles only dangerous chars', () => {
    expect(sanitize('<>{}[]|&$`~@#%^*=+')).toBe('');
  });

  it('handles mixed attack vectors', () => {
    const result = sanitize('<script>alert("XSS")</script>"; DROP TABLE users--${env}');
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('DROP TABLE');
    expect(result).not.toContain('${');
  });

  it('handles repeated injection attempts', () => {
    expect(sanitize('javascript:javascript:alert(1)')).not.toContain('javascript:');
  });
});
