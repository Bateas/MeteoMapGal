/**
 * The service logs are kept for a year, one file per day. A line has to say which day it is
 * from and must not carry terminal colour codes when it goes to a file.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { log } from './logger';

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
