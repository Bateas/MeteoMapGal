/**
 * Tests for the Weather Underground pause.
 *
 * What it must guarantee:
 *   - nothing happens until a whole batch is refused (401/403/429);
 *   - once open, the poll is silent for 60 min, then ONE probe, and a refusal
 *     of the probe doubles the pause up to 4 h;
 *   - any answer that is not a refusal (even a 204) closes it;
 *   - a burst of refusals inside an open pause counts once.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  planCycle,
  isRefusal,
  judgeBatch,
  reportRefused,
  reportAnswered,
  cooldownMinutes,
  _resetWuBreaker,
} from './wuBreaker';

const MIN = 60_000;
const T0 = 1_000_000_000_000;

describe('wuBreaker', () => {
  beforeEach(() => _resetWuBreaker());

  it('starts closed: every station is asked', () => {
    expect(planCycle(T0)).toBe('all');
  });

  it('knows which answers are about the key', () => {
    for (const r of ['HTTP 401', 'HTTP 403', 'HTTP 429']) expect(isRefusal(r)).toBe(true);
    for (const r of ['HTTP 204', 'HTTP 500', 'timeout', 'no observation', 'not JSON']) expect(isRefusal(r)).toBe(false);
  });

  it('judges a batch: all refused opens, any answer does not, empty is nothing', () => {
    expect(judgeBatch(129, 129)).toBe('refused');
    expect(judgeBatch(129, 128)).toBe('answered');
    expect(judgeBatch(129, 0)).toBe('answered');
    expect(judgeBatch(0, 0)).toBe('none');
  });

  it('a refused batch opens a 60 min pause and the poll goes silent', () => {
    expect(reportRefused(T0)).toBe(true);
    expect(cooldownMinutes()).toBe(60);
    expect(planCycle(T0 + 5 * MIN)).toBe('skip');
    expect(planCycle(T0 + 59 * MIN)).toBe('skip');
  });

  it('after the pause there is ONE probe, until something answers', () => {
    reportRefused(T0);
    expect(planCycle(T0 + 60 * MIN)).toBe('probe');
    expect(planCycle(T0 + 90 * MIN)).toBe('probe');
  });

  it('a refused probe doubles the pause: 60 -> 120 -> 240 -> stays at 240', () => {
    reportRefused(T0);
    expect(cooldownMinutes()).toBe(60);
    expect(reportRefused(T0 + 61 * MIN)).toBe(true);
    expect(cooldownMinutes()).toBe(120);
    expect(planCycle(T0 + 61 * MIN + 119 * MIN)).toBe('skip');
    expect(planCycle(T0 + 61 * MIN + 120 * MIN)).toBe('probe');
    expect(reportRefused(T0 + 200 * MIN)).toBe(true);
    expect(cooldownMinutes()).toBe(240);
    expect(reportRefused(T0 + 500 * MIN)).toBe(true);
    expect(cooldownMinutes()).toBe(240);
  });

  it('a burst of refusals inside an open pause counts once', () => {
    expect(reportRefused(T0)).toBe(true);
    for (let i = 0; i < 12; i++) expect(reportRefused(T0 + i * 1000)).toBe(false);
    expect(cooldownMinutes()).toBe(60);
  });

  it('an answer closes the pause and the full poll resumes', () => {
    reportRefused(T0);
    expect(reportAnswered()).toBe(true);
    expect(planCycle(T0 + 61 * MIN)).toBe('all');
    expect(planCycle(T0 + 1 * MIN)).toBe('all');
  });

  it('an answer when it was never open changes nothing', () => {
    expect(reportAnswered()).toBe(false);
    expect(planCycle(T0)).toBe('all');
  });

  it('after closing, the next refusal starts again from 60 min, not from the doubled pause', () => {
    reportRefused(T0);
    reportRefused(T0 + 61 * MIN);
    expect(cooldownMinutes()).toBe(120);
    reportAnswered();
    reportRefused(T0 + 300 * MIN);
    expect(cooldownMinutes()).toBe(60);
  });
});
