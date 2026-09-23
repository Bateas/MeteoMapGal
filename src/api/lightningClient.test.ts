/**
 * The strikes url is asked for by every open tab, every minute or two, and it
 * is the one feed a delay could matter in. What these tests pin is the thing
 * that decides whether a crowd costs one request or one each: two people
 * asking at the same moment must ask for the SAME url, or no cache — ours or
 * the edge's — can ever answer either of them.
 */
import { describe, it, expect } from 'vitest';
import { buildStrikesUrl } from './lightningClient';

const at = (iso: string) => buildStrikesUrl(Date.parse(iso));
const param = (url: string, name: string) =>
  new URLSearchParams(url.slice(url.indexOf('?') + 1)).get(name)!;

describe('buildStrikesUrl', () => {
  it('gives the same url to everyone asking within the same half minute', () => {
    const a = at('2026-09-23T10:15:07.412Z');
    const b = at('2026-09-23T10:15:29.998Z');
    expect(a).toBe(b);
  });

  it('moves on to the next url once the half minute is over', () => {
    expect(at('2026-09-23T10:15:29.998Z')).not.toBe(at('2026-09-23T10:15:30.001Z'));
  });

  it('never carries milliseconds, which is what made every url unique', () => {
    const url = at('2026-09-23T10:15:07.412Z');
    expect(param(url, 'fechaInicio')).toBe('2026-09-23T10:15:00.000Z');
    expect(url).not.toContain('07.412');
  });

  it('still asks for the last twenty four hours, newest first', () => {
    // MeteoGalicia reads fechaInicio as the newer end of the range.
    const url = at('2026-09-23T10:15:07.412Z');
    const newer = Date.parse(param(url, 'fechaInicio'));
    const older = Date.parse(param(url, 'fechaFin'));
    expect(newer - older).toBe(24 * 60 * 60 * 1000);
  });

  it('rounds down, never forward into a future that has no strikes yet', () => {
    const now = Date.parse('2026-09-23T10:15:59.999Z');
    expect(Date.parse(param(buildStrikesUrl(now), 'fechaInicio'))).toBeLessThanOrEqual(now);
  });
});
