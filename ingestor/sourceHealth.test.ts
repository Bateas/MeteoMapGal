import { describe, it, expect } from 'vitest';
import {
  POLLED_SOURCES,
  countBySource,
  formatHeartbeat,
  findSilentSources,
  describeSilence,
  findDeadSweep,
  describeSweep,
  describeDeadSweep,
  formatMinutes,
  type SweepStatus,
} from './sourceHealth';

const MIN = 60_000;

describe('countBySource — the source that brought nothing still appears', () => {
  it('reports a zero rather than omitting the source', () => {
    // This is the whole reason the module exists. On 18 August MeteoGalicia
    // printed no line at all and the absence read as "nothing to report".
    const counts = countBySource([
      { stationId: 'wu_ISANAM1' },
      { stationId: 'wu_ICRECE2' },
      { stationId: 'nt_28f26e' },
    ]);
    expect(counts.get('meteogalicia')).toBe(0);
    expect(counts.get('wunderground')).toBe(2);
    expect(counts.size).toBe(POLLED_SOURCES.length);
  });

  it('names every polled source even when the cycle came back empty', () => {
    const counts = countBySource([]);
    for (const s of POLLED_SOURCES) expect(counts.get(s)).toBe(0);
  });

  it('ignores a prefix that is not in the roster instead of inventing a row', () => {
    const counts = countBySource([{ stationId: 'xx_whatever' }]);
    expect(counts.size).toBe(POLLED_SOURCES.length);
  });

  it('derives the network from the station id prefix, not from a field', () => {
    // A NormalizedReading carries no source: the prefix is the only place it
    // survives normalisation. Getting this wrong is what the ingestor
    // typecheck caught — the frontend build and 2000 tests did not.
    const counts = countBySource([
      { stationId: 'mg_19044' },
      { stationId: 'aemet_1701X' },
      { stationId: 'mc_ESGAL3200000032455A' },
      { stationId: 'skyx_SKY100' },
    ]);
    expect(counts.get('meteogalicia')).toBe(1);
    expect(counts.get('aemet')).toBe(1);
    expect(counts.get('meteoclimatic')).toBe(1);
    expect(counts.get('skyx')).toBe(1);
    expect(counts.get('wunderground')).toBe(0);
  });
});

describe('formatHeartbeat', () => {
  it('always prints all six, so a missing one is visible as a zero', () => {
    const line = formatHeartbeat(countBySource([{ stationId: 'aemet_1701X' }]));
    expect(line).toContain('MG 0');
    expect(line).toContain('AEMET 1');
    for (const s of POLLED_SOURCES) expect(line).toMatch(/\S/);
    expect(line.split('·')).toHaveLength(POLLED_SOURCES.length);
  });
});

describe('findSilentSources — each source judged on its own clock', () => {
  const now = 10_000 * MIN;

  it('does not call an hourly network stale for being hourly', () => {
    // 90 minutes is punctual for AEMET, which publishes hourly and can run
    // two hours behind. Judging it by a five-minute yardstick is the mistake
    // that kept it out of every spot consensus until v2.136.0.
    const silent = findSilentSources({
      now,
      lastSeen: new Map([['aemet', now - 90 * MIN]]),
      lastWarnedAt: new Map(),
      reWarnAfterMs: 24 * 60 * MIN,
    });
    expect(silent).toEqual([]);
  });

  it('flags a five-minute network at an age that is fine for AEMET', () => {
    const silent = findSilentSources({
      now,
      lastSeen: new Map([['wunderground', now - 90 * MIN]]),
      lastWarnedAt: new Map(),
      reWarnAfterMs: 24 * 60 * MIN,
    });
    expect(silent.map((s) => s.source)).toEqual(['wunderground']);
  });

  it('catches the case it was written for: MeteoGalicia quiet two hours', () => {
    const silent = findSilentSources({
      now,
      lastSeen: new Map([
        ['meteogalicia', now - 120 * MIN],
        ['wunderground', now - 4 * MIN],
        ['netatmo', now - 5 * MIN],
      ]),
      lastWarnedAt: new Map(),
      reWarnAfterMs: 24 * 60 * MIN,
    });
    expect(silent.map((s) => s.source)).toEqual(['meteogalicia']);
    expect(silent[0].silentMs).toBe(120 * MIN);
  });

  it('says nothing about a source that has never reported', () => {
    // Unconfigured, or no stations in range. Alarming would cry wolf forever.
    const silent = findSilentSources({
      now,
      lastSeen: new Map(),
      lastWarnedAt: new Map(),
      reWarnAfterMs: 24 * 60 * MIN,
    });
    expect(silent).toEqual([]);
  });

  it('does not repeat a warning it already made', () => {
    const lastSeen = new Map([['meteogalicia' as const, now - 120 * MIN]]);
    const first = findSilentSources({ now, lastSeen, lastWarnedAt: new Map(), reWarnAfterMs: 24 * 60 * MIN });
    expect(first).toHaveLength(1);

    const again = findSilentSources({
      now,
      lastSeen,
      lastWarnedAt: new Map([['meteogalicia', now - 10 * MIN]]),
      reWarnAfterMs: 24 * 60 * MIN,
    });
    expect(again).toEqual([]);
  });

  it('speaks up again once the re-warn window has passed', () => {
    const silent = findSilentSources({
      now,
      lastSeen: new Map([['meteogalicia', now - 48 * 60 * MIN]]),
      lastWarnedAt: new Map([['meteogalicia', now - 25 * 60 * MIN]]),
      reWarnAfterMs: 24 * 60 * MIN,
    });
    expect(silent).toHaveLength(1);
  });

  it('leads with the worst offender', () => {
    const silent = findSilentSources({
      now,
      lastSeen: new Map([
        ['wunderground', now - 60 * MIN],
        ['meteogalicia', now - 300 * MIN],
      ]),
      lastWarnedAt: new Map(),
      reWarnAfterMs: 24 * 60 * MIN,
    });
    expect(silent[0].source).toBe('meteogalicia');
  });
});

describe('describeSilence — the line says why this counts as silent', () => {
  it('names the source, how long, and the gate it broke', () => {
    const line = describeSilence({ source: 'meteogalicia', silentMs: 125 * MIN, gateMin: 40 });
    expect(line).toContain('meteogalicia');
    expect(line).toContain('2h');
    expect(line).toContain('40min');
  });
});

describe('findDeadSweep — NT 18 between sweeps is not NT 18 because the sweep died', () => {
  const INTERVAL = 30 * MIN;
  const judge = (status: SweepStatus, now: number, lastWarnedAt: number | null = null) =>
    findDeadSweep({ now, status, intervalMs: INTERVAL, lastWarnedAt, reWarnAfterMs: 6 * 60 * MIN });

  it('says nothing before the first sweep has been attempted', () => {
    expect(judge({ firstAttemptAt: null, attemptedAt: null, productiveAt: null, readings: 0 }, 10 * 60 * MIN)).toBeNull();
  });

  it('tolerates one empty sweep — a rate limit or a timeout is weather', () => {
    // Productive at t=0, empty at t=30; at t=35 we are still inside the grace.
    const status = { firstAttemptAt: 0, attemptedAt: 30 * MIN, productiveAt: 0, readings: 0 };
    expect(judge(status, 35 * MIN)).toBeNull();
    expect(judge(status, 74 * MIN)).toBeNull();
  });

  it('fires once two sweeps in a row have brought nothing', () => {
    // Productive at t=0, empty at t=30 and t=60; the check at t=80 fires.
    const status = { firstAttemptAt: 0, attemptedAt: 60 * MIN, productiveAt: 0, readings: 0 };
    const dead = judge(status, 80 * MIN);
    expect(dead).not.toBeNull();
    expect(dead!.silentMs).toBe(80 * MIN);
  });

  it('measures from the FIRST attempt when no sweep has ever produced', () => {
    // The boot case: token accepted, every box empty since start. The last
    // attempt keeps moving, so measured from it this could never fire.
    const status = { firstAttemptAt: 0, attemptedAt: 60 * MIN, productiveAt: null, readings: 0 };
    expect(judge(status, 60 * MIN)).toBeNull();
    expect(judge(status, 80 * MIN)?.silentMs).toBe(80 * MIN);
  });

  it('is quiet while the last sweep was productive, whatever the cycle count says', () => {
    // The whole point: between sweeps the heartbeat shows the sector count only.
    const status = { firstAttemptAt: 0, attemptedAt: 100 * MIN, productiveAt: 100 * MIN, readings: 78 };
    expect(judge(status, 125 * MIN)).toBeNull();
  });

  it('does not repeat the warning inside the re-warn window', () => {
    const status = { firstAttemptAt: 0, attemptedAt: 60 * MIN, productiveAt: 0, readings: 0 };
    expect(judge(status, 80 * MIN, 79 * MIN)).toBeNull();
    expect(judge(status, 80 * MIN + 6 * 60 * MIN, 79 * MIN)).not.toBeNull();
  });
});

describe('describeSweep / describeDeadSweep — the line tells a reader which kind of cycle this was', () => {
  it('before any sweep', () => {
    expect(describeSweep({ firstAttemptAt: null, attemptedAt: null, productiveAt: null, readings: 0 }, 0)).toBe('no sweep yet');
  });

  it('after a productive sweep, how much and how long ago', () => {
    const line = describeSweep({ firstAttemptAt: 0, attemptedAt: 100 * MIN, productiveAt: 100 * MIN, readings: 78 }, 112 * MIN);
    expect(line).toBe('last sweep 78 readings 12min ago');
  });

  it('after an empty sweep, when it last produced — or that it never did', () => {
    expect(describeSweep({ firstAttemptAt: 0, attemptedAt: 60 * MIN, productiveAt: 0, readings: 0 }, 65 * MIN))
      .toBe('last sweep brought nothing 5min ago, last productive 1h05 ago');
    expect(describeSweep({ firstAttemptAt: 0, attemptedAt: 60 * MIN, productiveAt: null, readings: 0 }, 65 * MIN))
      .toBe('last sweep brought nothing 5min ago, never productive');
  });

  it('the alarm names the silence in minutes and the cadence it broke', () => {
    expect(describeDeadSweep(95 * MIN, 30 * MIN))
      .toBe('Netatmo Galicia sweep has brought nothing for 1h35 (it runs every 30min)');
  });

  it('formatMinutes keeps minutes below two days', () => {
    expect(formatMinutes(0)).toBe('0min');
    expect(formatMinutes(59 * MIN)).toBe('59min');
    expect(formatMinutes(60 * MIN)).toBe('1h00');
    expect(formatMinutes(3 * 24 * 60 * MIN)).toBe('3d');
  });
});
