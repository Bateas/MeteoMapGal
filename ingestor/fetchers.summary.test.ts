/**
 * The per-cycle summary of what Wunderground and Meteoclimatic left out (21-oct audit,
 * finding 15): a 204 or a provider error page used to count only as «one reading less».
 */
import { describe, it, expect } from 'vitest';
import { rejectionReason, countBreakdown } from './fetchers';

describe('rejectionReason', () => {
  it('keeps the HTTP status and the known labels', () => {
    expect(rejectionReason(new Error('HTTP 204'))).toBe('HTTP 204');
    expect(rejectionReason(new Error('HTTP 503'))).toBe('HTTP 503');
    expect(rejectionReason(new Error('no observation'))).toBe('no observation');
  });

  it('names timeouts and bodies that are not JSON, and lumps the rest as no answer', () => {
    expect(rejectionReason(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))).toBe('timeout');
    expect(rejectionReason(new SyntaxError('Unexpected end of JSON input'))).toBe('not JSON');
    expect(rejectionReason(new TypeError('fetch failed'))).toBe('no answer');
  });
});

describe('countBreakdown', () => {
  it('lists the most frequent first, and nothing when nothing was left out', () => {
    expect(countBreakdown(new Map([['timeout', 1], ['HTTP 204', 3]]))).toBe('3× HTTP 204, 1× timeout');
    expect(countBreakdown(new Map())).toBe('');
  });
});
