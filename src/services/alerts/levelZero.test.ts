import { describe, expect, it } from 'vitest';
import type { ConditionLine } from './conditionsList';
import { linesNotSaidAbove, topStripPlan, SIMPLE_TOP_MAX } from './levelZero';

function line(id: string, tone: ConditionLine['tone'], icon = 'alert-triangle'): ConditionLine {
  return { id, icon, tone, origin: 'medido', text: id };
}

describe('level zero of simple mode: one voice per fact', () => {
  const lines = [
    line('official-mg-10-0', 'moderado'),
    line('official-ipma-0', 'moderado'),
    line('maritime-fog', 'alto', 'fog'),
    line('storm-main', 'critico', 'zap'),
    line('active-fires', 'alto', 'flame'),
    line('ahead-rain', null, 'cloud-rain'),
  ];

  it('the warnings of MeteoGalicia are left to the strip over the map', () => {
    const left = linesNotSaidAbove(lines, null).map((l) => l.id);
    expect(left).not.toContain('official-mg-10-0');
    // IPMA is not drawn above: it keeps its voice here
    expect(left).toContain('official-ipma-0');
    expect(left).toContain('maritime-fog');
  });

  it('a line of the forecast with no tone is not a warning: it waits in Condiciones', () => {
    expect(linesNotSaidAbove(lines, null).map((l) => l.id)).not.toContain('ahead-rain');
  });

  it('what the line over the map is saying is not repeated below', () => {
    expect(linesNotSaidAbove(lines, 'active-fires').map((l) => l.id)).not.toContain('active-fires');
    expect(linesNotSaidAbove(lines, 'lightning-measured').map((l) => l.id)).not.toContain('storm-main');
    // and with the line on something else, they stay
    const other = linesNotSaidAbove(lines, 'beach-day').map((l) => l.id);
    expect(other).toContain('active-fires');
    expect(other).toContain('storm-main');
  });

  it('nothing left to say: nothing to draw', () => {
    expect(linesNotSaidAbove([line('official-mg-1-0', 'alto'), line('ahead-fog', null)], null)).toEqual([]);
  });
});

describe('the strip over the map in simple mode: two entries at most', () => {
  const yellow = { level: 1, key: 'y' };
  const yellow2 = { level: 1, key: 'y2' };
  const orange = { level: 2, key: 'o' };
  const urgent = { priority: 10 };
  const mild = { priority: 8 };

  it('advanced draws everything', () => {
    const plan = topStripPlan([yellow, orange, yellow2], mild, false);
    expect(plan.warnings.length).toBe(3);
    expect(plan.line).toBe(true);
    expect(plan.hidden).toBe(0);
  });

  it('never more than two entries, whatever comes', () => {
    for (const ws of [[], [yellow], [yellow, orange], [yellow, orange, yellow2]]) {
      for (const l of [null, mild, urgent]) {
        const plan = topStripPlan(ws, l, true);
        expect(plan.warnings.length + (plan.line ? 1 : 0)).toBeLessThanOrEqual(SIMPLE_TOP_MAX);
        expect(plan.hidden).toBe(ws.length - plan.warnings.length);
      }
    }
  });

  it('on a phone: the gravest warning alone, the line only when urgent (18-nov, a lighter first screen)', () => {
    const two = topStripPlan([yellow, orange], mild, true, true);
    expect(two.warnings.map((w) => w.key)).toEqual(['o']);
    expect(two.hidden).toBe(1);
    expect(two.line).toBe(false);
    expect(topStripPlan([yellow, orange], urgent, true, true).line).toBe(true);
    expect(topStripPlan([yellow], mild, true, true).line).toBe(false);
    expect(topStripPlan([], mild, true, true).line).toBe(true);
    // Advanced keeps everything, phone or not
    expect(topStripPlan([yellow, orange], mild, false, true).warnings.length).toBe(2);
  });

  it('the gravest warning is always the first, an orange never gives way to a yellow', () => {
    expect(topStripPlan([yellow, yellow2, orange], urgent, true).warnings.map((w) => w.key)).toEqual(['o']);
    expect(topStripPlan([yellow, orange, yellow2], null, true).warnings.map((w) => w.key)).toEqual(['o', 'y']);
  });

  it('with two warnings a mild line waits; an urgent one (lightning, a near fire) takes the second place', () => {
    const waits = topStripPlan([yellow, orange], mild, true);
    expect(waits.line).toBe(false);
    expect(waits.warnings.length).toBe(2);
    const goes = topStripPlan([yellow, orange], urgent, true);
    expect(goes.line).toBe(true);
    expect(goes.hidden).toBe(1);
  });

  it('one warning and a line: both', () => {
    const plan = topStripPlan([yellow], mild, true);
    expect(plan.warnings.length).toBe(1);
    expect(plan.line).toBe(true);
    expect(plan.hidden).toBe(0);
  });
});
