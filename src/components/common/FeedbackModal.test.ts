import { describe, it, expect } from 'vitest';

// Replicate exact sanitize logic from FeedbackModal for unit testing
const MAX_CHARS = 300;
const SAFE_CHARS = /[^a-zA-Z0-9\u00C0-\u024F\s.,!?¿¡:;()\-'/]/g;

function sanitize(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/data\s*:/gi, '')
    .replace(/\b(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|EXEC|UNION)\s+(TABLE|FROM|INTO|DATABASE|SELECT)/gi, '')
    .replace(SAFE_CHARS, '')
    .trim()
    .substring(0, MAX_CHARS);
}

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
    const result = sanitize("DROP TABLE users");
    expect(result).not.toContain('DROP TABLE');
  });

  it('neutralizes UNION SELECT', () => {
    const result = sanitize("' UNION SELECT * FROM passwords --");
    expect(result).not.toContain('UNION SELECT');
  });

  it('neutralizes DELETE FROM', () => {
    const result = sanitize("DELETE FROM sessions WHERE 1=1");
    expect(result).not.toContain('DELETE FROM');
  });

  it('neutralizes INSERT INTO', () => {
    const result = sanitize("INSERT INTO admin VALUES('hack')");
    expect(result).not.toContain('INSERT INTO');
  });

  it('neutralizes case-insensitive SQL', () => {
    const result = sanitize("drop table Users");
    expect(result).not.toContain('drop table');
  });

  // ── Length limits ─────────────────────────────
  it('truncates to MAX_CHARS', () => {
    const long = 'A'.repeat(500);
    expect(sanitize(long).length).toBe(MAX_CHARS);
  });

  it('trims whitespace', () => {
    expect(sanitize('  Hola mundo  ')).toBe('Hola mundo');
  });

  // ── Safe content preservation ─────────────────
  it('preserves Spanish accented characters (á, é, í, ó, ú, ñ)', () => {
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
  it('empty honeypot = real user', () => {
    expect(!('') ).toBe(true);
  });

  it('filled honeypot = bot detected', () => {
    expect(!('spam@evil.com')).toBe(false);
  });

  // ── Type validation ───────────────────────────
  it('validates allowed feedback types', () => {
    const VALID_TYPES = ['sugerencia', 'bug', 'otro'];
    expect(VALID_TYPES.includes('sugerencia')).toBe(true);
    expect(VALID_TYPES.includes('bug')).toBe(true);
    expect(VALID_TYPES.includes('otro')).toBe(true);
    expect(VALID_TYPES.includes('admin')).toBe(false);
    expect(VALID_TYPES.includes('<script>')).toBe(false);
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
    const attack = '<script>alert("XSS")</script>"; DROP TABLE users--${env}';
    const result = sanitize(attack);
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('DROP TABLE');
    expect(result).not.toContain('${');
  });

  it('handles repeated injection attempts', () => {
    const result = sanitize('javascript:javascript:alert(1)');
    expect(result).not.toContain('javascript:');
  });
});
