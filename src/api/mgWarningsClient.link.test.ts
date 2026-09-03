import { describe, it, expect } from 'vitest';
import { safeWarningLink, MG_WARNINGS_HOME } from './mgWarningsClient';

describe('safeWarningLink — an href from a feed is still an href', () => {
  it('keeps an https link on the agency domain', () => {
    expect(safeWarningLink('https://www.meteogalicia.gal/web/avisos/123')).toBe('https://www.meteogalicia.gal/web/avisos/123');
    expect(safeWarningLink('https://servizos.meteogalicia.gal/rss/x')).toBe('https://servizos.meteogalicia.gal/rss/x');
  });

  it('falls back on javascript:, http, other hosts and lookalikes', () => {
    for (const bad of [
      'javascript:alert(1)',
      'http://www.meteogalicia.gal/web/avisos',
      'https://evil.example/meteogalicia.gal',
      'https://meteogalicia.gal.evil.example/',
      'not a url',
      '',
      null,
      undefined,
    ]) expect(safeWarningLink(bad)).toBe(MG_WARNINGS_HOME);
  });
});
