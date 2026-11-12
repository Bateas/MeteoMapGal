import { describe, it, expect } from 'vitest';
import { pointRainPanorama, type ModelHour, type WatchGauge } from './pointRainWatch';

const at = (hh: number, mm = 0) => new Date(`2026-11-09T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+01:00`).getTime();
const now = at(10, 10);

/** Rain the model gave for each local hour; the rest of the morning dry. */
function model(rain: Record<number, number>): ModelHour[] {
  return Array.from({ length: 24 }, (_, h) => ({ timeMs: at(h), mm: rain[h] ?? 0 }));
}

/** An official gauge reporting every 10 min from 02:00 to `until`, wet at the given [hour, minute]. */
function gauge(wet: [number, number, number][] = [], until = now, id = 'mg_1', name = 'Estación A'): WatchGauge {
  const samples = [];
  for (let t = at(2); t <= until; t += 600_000) {
    const hit = wet.find(([h, m]) => at(h, m) === t);
    samples.push({ t, mm: hit ? hit[2] : 0 });
  }
  return { id, name, samples };
}

const run = (rain: Record<number, number>, gauges: WatchGauge[], nowMs = now) =>
  pointRainPanorama({ model: model(rain), gauges, nowMs });

const wetNow = gauge([[10, 0, 0.6], [9, 50, 0.3]]);

describe('it is raining now', () => {
  it('as the model said', () => {
    const p = run({ 10: 2 }, [wetNow]);
    expect(p.state).toBe('coincide');
    expect(p.text).toBe('Llueve en Estación A (0,9 mm en la última hora), como daba el WRF.');
  });

  it('allows the model an hour either way', () => {
    expect(run({ 9: 2 }, [wetNow]).state).toBe('coincide');
    expect(run({ 11: 2 }, [wetNow]).state).toBe('coincide');
  });

  it('before the model had it: ahead', () => {
    const p = run({ 13: 2 }, [wetNow]);
    expect(p.state).toBe('adelanta');
    expect(p.text).toContain('no la daba hasta las 13 h: va unas 3 h adelantada');
  });

  it('after the model had it: behind', () => {
    const p = run({ 7: 2 }, [wetNow]);
    expect(p.state).toBe('retrasa');
    expect(p.text).toContain('la daba hacia las 7 h: va unas 3 h retrasada');
  });

  it('and the model had none near', () => {
    expect(run({}, [wetNow]).state).toBe('no-previsto');
  });
});

describe('dry now, and the model had rain for the last hours', () => {
  it('nothing has fallen: not here yet, or not coming', () => {
    const p = run({ 8: 3 }, [gauge()]);
    expect(p.state).toBe('no-llega');
    expect(p.text).toBe('El WRF daba lluvia a las 8 h y Estación A no ha medido nada: aún no ha llegado, no llegará o es tan débil que no marca.');
  });

  it('it rained before the model said: already gone', () => {
    const p = run({ 8: 3 }, [gauge([[6, 10, 0.8]])]);
    expect(p.state).toBe('ya-paso');
    expect(p.text).toContain('antes de las 8 h');
  });

  it('it rained when the model said: nothing to report', () => {
    expect(run({ 8: 3 }, [gauge([[8, 20, 1.2]])]).state).toBe('seco');
  });

  it('keeps the same key through the band', () => {
    const a = run({ 8: 3 }, [gauge()], at(9, 30));
    const b = run({ 8: 3 }, [gauge([], at(10, 30))], at(10, 30));
    expect(a.key).toBe(b.key);
    expect(a.key).not.toBe('');
  });

  it('dates the start of a band that lasted', () => {
    expect(run({ 7: 1, 8: 1, 9: 1 }, [gauge()]).text).toContain('lluvia a las 7 h');
  });
});

describe('a gauge that marks under the threshold is not «nothing»', () => {
  // 10-nov-2026 at the point: drizzle from 9 to 10, 0,1 mm at the gauge, and the card said «no ha medido nada».
  const drizzle = gauge([[9, 30, 0.1]]);

  it('says how little it measured when the model had rain', () => {
    const p = run({ 9: 2.6 }, [drizzle]);
    expect(p.state).toBe('no-llega');
    expect(p.text).toBe('El WRF daba lluvia a las 9 h y Estación A solo ha medido 0,1 mm: es llovizna, o lo que daba el modelo aún no ha llegado.');
  });

  it('calls it drizzle with rain ahead, and with none', () => {
    expect(run({ 12: 2 }, [drizzle]).text).toBe('Estación A marca llovizna (0,1 mm en la última hora). El WRF da lluvia hacia las 12 h.');
    expect(run({}, [drizzle]).text).toBe('Estación A marca llovizna (0,1 mm en la última hora) y el WRF no da lluvia.');
    expect(run({ 16: 2 }, [drizzle]).text).toBe('Estación A marca llovizna (0,1 mm en la última hora) y el WRF no da lluvia hasta las 16 h.');
  });

  it('keeps the state: under the threshold is still not rain for the watcher', () => {
    expect(run({}, [drizzle]).state).toBe('seco');
    expect(run({ 12: 2 }, [drizzle]).state).toBe('se-acerca');
  });
});

describe('dry now, looking ahead', () => {
  it('rain soon', () => {
    const p = run({ 11: 2 }, [gauge()]);
    expect(p.state).toBe('se-acerca');
    expect(p.text).toBe('Estación A no mide lluvia. El WRF la da hacia las 11 h.');
    expect(p.key).not.toBe('');
  });

  it('rain the model has for this very hour', () => {
    expect(run({ 10: 2 }, [gauge()]).text).toBe('Estación A no mide lluvia. El WRF la da para esta hora.');
  });

  it('never says it is dry: only what the gauge measured', () => {
    const cases: Record<number, number>[] = [{}, { 11: 2 }, { 20: 2 }, { 8: 3 }];
    for (const rain of cases) expect(run(rain, [gauge()]).text).not.toMatch(/seco/i);
  });

  it('nothing soon is not worth a message, and says when', () => {
    const p = run({ 20: 2 }, [gauge()]);
    expect(p.state).toBe('seco');
    expect(p.key).toBe('');
    expect(p.text).toContain('hasta las 20 h');
  });

  it('ignores a trace in the model', () => {
    expect(run({ 11: 0.2 }, [gauge()]).state).toBe('seco');
  });

  it('says «la 1 h»', () => {
    const lateNow = new Date('2026-11-09T23:10:00+01:00').getTime();
    const next = at(23) + 2 * 3_600_000;
    const hours: ModelHour[] = [{ timeMs: at(23), mm: 0 }, { timeMs: next, mm: 2 }];
    const g = gauge([], lateNow);
    expect(pointRainPanorama({ model: hours, gauges: [g], nowMs: lateNow }).text).toContain('hacia la 1 h');
  });
});

describe('what the gauges can and cannot say', () => {
  it('a gauge that stopped reporting is no data, never dry', () => {
    const p = run({ 8: 3 }, [gauge([], at(8, 0))]);
    expect(p.state).toBe('sin-dato');
    expect(p.key).toBe('');
  });

  it('does not claim the model missed it before it has this hour stored', () => {
    const future: ModelHour[] = [{ timeMs: at(14), mm: 2 }];
    const p = pointRainPanorama({ model: future, gauges: [wetNow], nowMs: now });
    expect(p.state).toBe('sin-dato');
    expect(p.text).toContain('Aún no hay previsión guardada');
    expect(p.key).toBe('');
  });

  it('says nothing without a model', () => {
    expect(pointRainPanorama({ model: [], gauges: [gauge()], nowMs: now }).state).toBe('sin-dato');
  });

  it('an amateur gauge alone does not make it rain', () => {
    const amateur = { id: 'nt_1', name: 'Vecina', samples: [{ t: at(10, 0), mm: 2 }] };
    expect(run({}, [gauge(), amateur]).state).toBe('seco');
  });

  it('an amateur gauge alone cannot say it is dry or wet', () => {
    const amateur = { id: 'nt_1', name: 'Vecina', samples: [{ t: at(10, 0), mm: 2 }] };
    expect(run({}, [amateur]).state).toBe('sin-dato');
  });

  it('two amateur gauges together do', () => {
    const a = { id: 'nt_1', name: 'Vecina 1', samples: [{ t: at(10, 0), mm: 2 }] };
    const b = { id: 'nt_2', name: 'Vecina 2', samples: [{ t: at(10, 0), mm: 1 }] };
    expect(run({ 10: 1 }, [a, b]).text).toContain('Vecina 1');
  });

  it('names the nearest official gauge when dry', () => {
    const near = gauge([], now, 'mg_1', 'La cercana');
    const far = gauge([], now, 'aemet_2', 'La lejana');
    expect(run({}, [near, far]).text).toContain('La cercana');
  });
});

describe('a gauge that barely reports (12-nov: Amiudal, 1 reading of 6 an hour)', () => {
  // One reading in the last hour, at 10:00, 0 mm; nothing between 9:10 and 9:50.
  const sparse: WatchGauge = { id: 'mg_1', name: 'Amiudal', samples: [{ t: at(9, 0), mm: 0 }, { t: at(10, 0), mm: 0 }] };

  it('says how many readings came, not «no mide lluvia», and keeps the state', () => {
    const p = run({ 10: 2 }, [sparse]);
    expect(p.state).toBe('se-acerca');
    expect(p.text).toBe('Amiudal solo ha enviado 1 de sus 6 lecturas de la última hora: no se sabe cuánto llueve allí. El WRF da lluvia para esta hora.');
    expect(p.text).not.toContain('no mide lluvia');
  });

  it('with no rain in the model either', () => {
    const p = run({}, [sparse]);
    expect(p.state).toBe('seco');
    expect(p.text).toBe('Amiudal solo ha enviado 1 de sus 6 lecturas de la última hora: no se sabe cuánto llueve allí; el WRF no da lluvia.');
  });

  it('a complete gauge keeps the words it had', () => {
    expect(run({}, [gauge()]).text).toBe('Estación A no mide lluvia y el WRF tampoco la da.');
  });

  it('an hourly official gauge (AEMET) is never called sparse for its single reading', () => {
    const aemet: WatchGauge = { id: 'aemet_1696O', name: 'Beariz', samples: [{ t: at(10, 0), mm: 0 }] };
    expect(run({}, [aemet]).text).toBe('Beariz no mide lluvia y el WRF tampoco la da.');
  });
});
