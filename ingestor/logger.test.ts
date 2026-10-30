/**
 * The service logs are kept for a year, one file per day. A line has to say which day it is
 * from and must not carry terminal colour codes when it goes to a file.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { log, cleanForLog, LOG_TEXT_MAX } from './logger';

afterEach(() => vi.restoreAllMocks());

describe('log line format', () => {
  it('starts with the local date and time, then the level, with no escape codes off a terminal', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.info('prueba');
    const line = String(spy.mock.calls[0][0]);
    expect(line).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} INFO {2}prueba$/);
    expect(line).not.toContain('\x1b');
  });

  it('writes warnings the same way', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    log.warn('aviso');
    expect(String(spy.mock.calls[0][0])).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} WARN {2}aviso$/);
  });
});

describe('text from outside cannot forge entries', () => {
  it('writes line breaks and control characters as escapes, in the message and in the arguments', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const forged = 'Unexpected token\n2026-10-30 12:00:00 OK    login ok\r\x1b[31m';
    log.error(`[x] ${forged}`, forged);
    const [line, arg] = spy.mock.calls[0].map(String);
    expect(line).not.toMatch(/[\r\n\x1b]/);
    expect(arg).toBe('Unexpected token\\n2026-10-30 12:00:00 OK    login ok\\r\\u001b[31m');
  });

  it('leaves ordinary text and non-text arguments alone', () => {
    expect(cleanForLog('Cesantes 12 kt del SW (ñ, á)')).toBe('Cesantes 12 kt del SW (ñ, á)');
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const obj = { n: 1 };
    log.info('x', obj, 5);
    expect(spy.mock.calls[0][1]).toBe(obj);
    expect(spy.mock.calls[0][2]).toBe(5);
  });

  it('cuts very long text and says how much was left out', () => {
    const out = cleanForLog('a'.repeat(LOG_TEXT_MAX + 50));
    expect(out.startsWith('a'.repeat(LOG_TEXT_MAX))).toBe(true);
    expect(out.endsWith('... (50 more)')).toBe(true);
  });
});
