import { describe, it, expect } from 'vitest';
import { fireLine, buildConditionsList, buildFrostStrip, buildHourStrip, forecastLines, officialLines, worstIcaNear, type ConditionsInput } from './conditionsList';
import { dayWord, spanWords } from './whenText';
import type { UnifiedAlert } from './types';
import type { MGWarning } from '../../api/mgWarningsClient';
import type { IpmaWarning } from '../../api/ipmaWarningsClient';
import type { HourlyForecast } from '../../types/forecast';
import type { IcaReading } from '../../api/meteoGaliciaIcaClient';
import { classifyHaze } from '../hazeService';

const NOW = new Date(2026, 10, 4, 10, 0);

function input(over: Partial<ConditionsInput> = {}): ConditionsInput {
  return {
    alerts: [], mg: [], ipma: [], officialKnown: true, lightningKnown: true,
    hourly: [], convection: [], haze: null, ica: [], center: [-8.7, 42.3], radiusKm: 40, sectorName: 'Rías', now: NOW,
    ...over,
  };
}

function alert(over: Partial<UnifiedAlert>): UnifiedAlert {
  return { id: 'x', category: 'marine', severity: 'moderate', score: 40, icon: 'waves', title: 'T', detail: 'D', urgent: false, updatedAt: NOW, ...over };
}

function warning(maxLevel: number, type = 'Vento', from = new Date(2026, 10, 4, 12), to = new Date(2026, 10, 4, 20)): MGWarning {
  return { type, typeId: 3, maxLevel, publishedAt: NOW, link: '', zones: [{ name: 'Rías Baixas', id: 336, level: maxLevel, startTime: from, endTime: to, comment: 'Ráfagas' }] };
}

function hour(h: number, over: Partial<HourlyForecast> = {}, day = 4): HourlyForecast {
  return { time: new Date(2026, 10, day, h), precipitation: 0, precipProbability: 0, cape: 0, liftedIndex: null, cin: null, skyState: null, temperature: 12, cloudCover: 50, windSpeed: 3, ...over } as HourlyForecast;
}

describe('with nothing to say', () => {
  const list = buildConditionsList(input({ hourly: [hour(11)], convection: [hour(11)] }));

  it('says it without reassuring and the dot stays off', () => {
    expect(list.now).toEqual([]);
    expect(list.ahead).toEqual([]);
    expect(list.level).toBe('none');
    expect(list.activeCount).toBe(0);
    expect(list.emptyNow).toBe('Nada que avisar ahora en Rías.');
    expect(list.emptyAhead).toBe('Nada que avisar hoy ni mañana.');
    // No frost: the fold names what it holds, it does not announce the absence of frost.
    expect(list.emptyCampo).toBe('Luna y avisos de plagas');
  });

  it('never says «sin riesgo»', () => {
    expect(JSON.stringify(list).toLowerCase()).not.toContain('sin riesgo');
  });

  it('without a forecast it does not say the model gives nothing: it says it does not know', () => {
    const empty = buildConditionsList(input());
    expect(empty.emptyAhead).toMatch(/no sabemos/);
    expect(empty.emptyCampo).toBe('Luna y avisos de plagas');
  });

  it('a source that does not answer is said, not read as nothing', () => {
    const blind = buildConditionsList(input({ officialKnown: false, lightningKnown: false }));
    expect(blind.unknown).toHaveLength(2);
    expect(blind.unknown[0]).toContain('MeteoGalicia no responde');
    expect(blind.unknownShort).toBe('Sin datos de rayos');
    expect(blind.emptyNow).not.toContain('Nada que avisar');
  });
});

describe('official warnings', () => {
  it('go first, with day and hour, the origin and the zone', () => {
    const inForce = warning(2, 'Vento', new Date(2026, 10, 4, 9), new Date(2026, 10, 4, 20));
    const list = buildConditionsList(input({ mg: [inForce], alerts: [alert({ id: 'storm-main', category: 'storm', severity: 'critical', title: 'PELIGRO', icon: 'zap' })] }));
    expect(list.now[0].origin).toBe('oficial');
    expect(list.now[0].text).toBe('Aviso naranja de MeteoGalicia por viento');
    expect(list.now[0].sub).toBe('hasta las 20 h · Rías Baixas');
    expect(list.now[0].detail).toBe('Ráfagas');
  });

  it('one that starts later heads «Hoy y mañana», not «Ahora» (18-nov: from 18 h, said at 15 h)', () => {
    const list = buildConditionsList(input({ mg: [warning(1)] })); // 12 to 20 h, at 10 h
    expect(list.now.some((l) => l.origin === 'oficial')).toBe(false);
    expect(list.ahead[0].text).toBe('Aviso amarillo de MeteoGalicia por viento');
    expect(list.ahead[0].sub).toBe('hoy de 12 a 20 h · Rías Baixas');
    expect(list.level).not.toBe('none');
  });

  it('a warning for tomorrow says tomorrow', () => {
    const [l] = officialLines([warning(1, 'Choiva', new Date(2026, 10, 5, 6), new Date(2026, 10, 5, 14))], [], NOW);
    expect(l.sub).toContain('mañana de 6 a 14 h');
    expect(l.text).toBe('Aviso amarillo de MeteoGalicia por lluvia');
  });

  it('IPMA in Spanish, not «LARANJA»', () => {
    const ipma: IpmaWarning = { districtName: 'Viana', type: 'Agitação Marítima', level: 2, levelName: 'orange', startTime: new Date(2026, 10, 4, 9), endTime: new Date(2026, 10, 4, 18), description: '' } as IpmaWarning;
    const [l] = officialLines([], [ipma], NOW);
    expect(l.text).toBe('Aviso naranja de IPMA por oleaje');
    expect(l.sub).toContain('hasta las 18 h');
  });

  it('IPMA only adds what MeteoGalicia does not say (Cesantes, 18-nov)', () => {
    const base = { districtName: 'Viana', levelName: 'orange', startTime: new Date(2026, 10, 4, 9), endTime: new Date(2026, 10, 4, 18), description: '' };
    const sea = { ...base, type: 'Agitação Marítima', level: 2 } as IpmaWarning;
    const rain = { ...base, type: 'Precipitação', level: 1 } as IpmaWarning;
    const lines = officialLines([warning(2, 'Ondas', new Date(2026, 10, 4, 12), new Date(2026, 10, 5, 0))], [sea, rain], NOW);
    expect(lines.map((l) => l.text)).toEqual(['Aviso naranja de MeteoGalicia por oleaje', 'Aviso amarillo de IPMA por lluvia']);
  });

  it('a level-0 zone warns of nothing: no blank «Aviso  de», no later end (P3 review, 19-nov)', () => {
    const calm = warning(0, 'Vento');
    expect(officialLines([calm], [], NOW)).toEqual([]);
    const mixed = warning(1, 'Vento', new Date(2026, 10, 4, 12), new Date(2026, 10, 4, 18));
    mixed.zones.push({ name: 'Miño de Pontevedra', id: 323, level: 0, startTime: new Date(2026, 10, 4, 12), endTime: new Date(2026, 10, 5, 23), comment: '' });
    const [l] = officialLines([mixed], [], NOW);
    expect(l.text).toBe('Aviso amarillo de MeteoGalicia por viento');
    expect(l.sub).toBe('hoy de 12 a 18 h · Rías Baixas');
    expect(l.sub).not.toContain('Miño');
    const green = { districtName: 'Viana', type: 'Vento', level: 0, startTime: new Date(2026, 10, 4, 9), endTime: new Date(2026, 10, 4, 18), description: '' } as unknown as IpmaWarning;
    expect(officialLines([], [green], NOW)).toEqual([]);
  });

  it('«olas» is oleaje on both surfaces', () => {
    const [l] = officialLines([warning(1, 'Olas')], [], NOW);
    expect(l.text).toBe('Aviso amarillo de MeteoGalicia por oleaje');
  });

  it('light the dot: the very thing the old one missed', () => {
    expect(buildConditionsList(input({ mg: [warning(3)] })).level).toBe('critico');
    expect(buildConditionsList(input({ mg: [warning(2)] })).level).toBe('alto');
    expect(buildConditionsList(input({ mg: [warning(1)] })).level).toBe('riesgo');
  });
});

describe('the order of Ahora and the origin of each line', () => {
  const alerts = [
    alert({ id: 'pressure-trend', category: 'pressure', title: 'Presión en descenso' }),
    alert({ id: 'wind-trend-a', category: 'wind-front', title: 'Cambio brusco', severity: 'high' }),
    alert({ id: 'cross-sea', category: 'marine', title: 'Mar cruzada' }),
    alert({ id: 'rain-now', category: 'rain', title: 'Lloviendo ahora', severity: 'info' }),
    alert({ id: 'maritime-fog', category: 'fog', title: 'Riesgo de niebla marítima', severity: 'info' }),
    alert({ id: 'storm-main', category: 'storm', title: 'AVISO — Tormenta acercándose', severity: 'high', detail: '20 km, 5 rayos recientes' }),
  ];
  const list = buildConditionsList(input({ alerts }));

  it('rayos, niebla, lluvia medida, mar cruzada, rachas', () => {
    expect(list.now.map((l) => l.id)).toEqual(['storm-main', 'maritime-fog', 'rain-now', 'cross-sea', 'wind-trend-a', 'pressure-trend']);
  });

  it('each one says where it comes from', () => {
    const origin = Object.fromEntries(list.now.map((l) => [l.id, l.origin]));
    expect(origin['storm-main']).toBe('medido');
    expect(origin['maritime-fog']).toBe('modelo');
    expect(origin['rain-now']).toBe('medido');
    expect(origin['cross-sea']).toBe('medido');
  });

  it('distance and strikes are visible, not folded', () => {
    expect(list.now[0].sub).toBe('20 km, 5 rayos recientes');
  });

  it('rain measured under the forecast alert id still goes in Ahora', () => {
    const l = buildConditionsList(input({ alerts: [alert({ id: 'rain-forecast', category: 'rain', title: 'Lluvia moderada ahora' })] }));
    expect(l.now[0].origin).toBe('medido');
    expect(l.ahead).toEqual([]);
  });

  it('an info line does not light the dot', () => {
    const l = buildConditionsList(input({ alerts: [alert({ id: 'fog-alert', category: 'fog', severity: 'info', title: 'Riesgo de niebla' })] }));
    expect(l.now).toHaveLength(1);
    expect(l.level).toBe('none');
  });
});

describe('storm: measured lightning only', () => {
  it('without a measured alert there is no storm line: no percentage, no horizon', () => {
    const list = buildConditionsList(input());
    expect(list.now).toEqual([]);
    expect(JSON.stringify(list)).not.toMatch(/Probabilidad|inminente|probable|Riesgo de tormenta/i);
  });

  it('with measured lightning it is one line, with the distance and count in sight and nothing folded', () => {
    const list = buildConditionsList(input({
      alerts: [alert({ id: 'storm-main', category: 'storm', severity: 'high', title: 'AVISO — Tormenta cerca', detail: 'Rayos a 12 km, 4 en 30 min' })],
    }));
    expect(list.now).toHaveLength(1);
    expect(list.now[0].sub).toBe('Rayos a 12 km, 4 en 30 min');
    expect(list.now[0].detail).toBeUndefined();
    expect(JSON.stringify(list)).not.toMatch(/%|ETA|Probabilidad/);
  });
});

describe('Hoy y mañana', () => {
  it('one sentence per thing, with day and hour, from the model', () => {
    const hourly = [14, 15, 16].map((h) => hour(h, { precipitation: 3 })).concat([6, 7].map((h) => hour(h, { precipitation: 1.5 }, 5)));
    const [rain] = forecastLines(hourly, hourly, NOW);
    expect(rain.text).toBe('Lluvia moderada hoy de 14 a 17 h; mañana de 6 a 8 h');
    expect(rain.origin).toBe('modelo');
    expect(rain.detail).toContain('Hasta 3,0 mm/h');
  });

  it('rain the model does not put in mm is not a sentence, however high the probability', () => {
    expect(forecastLines([hour(14, { precipitation: 0, precipProbability: 90 })], [], NOW)).toEqual([]);
  });

  it('storm risk uses the one rule (CAPE, LI and CIN), not CAPE alone', () => {
    const capeOnly = [hour(15, { cape: 900, liftedIndex: 1, cin: 10 })];
    expect(forecastLines([], capeOnly, NOW)).toEqual([]);
    const rule = [hour(15, { cape: 400, liftedIndex: -3, cin: 10 }), hour(16, { cape: 400, liftedIndex: -3, cin: 10 })];
    expect(forecastLines([], rule, NOW)[0].text).toBe('Riesgo de tormenta hoy de 15 a 17 h');
  });

  it('an official storm warning already says it', () => {
    const rule = [hour(15, { cape: 400, liftedIndex: -3, cin: 10 })];
    const list = buildConditionsList(input({ convection: rule, mg: [warning(1, 'Tormenta')] }));
    expect(list.ahead.find((l) => l.id === 'ahead-storm')).toBeUndefined();
  });

  it('fog from the sky of the WRF', () => {
    expect(forecastLines([hour(6, { skyState: 'FOG' }, 5), hour(7, { skyState: 'FOG' }, 5)], [], NOW)[0].text).toBe('Niebla mañana de 6 a 8 h');
  });

  it('several patches read «a ratos», and past hours do not count', () => {
    const hourly = [8, 12, 15, 18].map((h) => hour(h, { precipitation: 1.5 }));
    expect(forecastLines(hourly, hourly, NOW)[0].text).toBe('Lluvia hoy a ratos, de 12 a 19 h');
  });

  it('calima: a line with classifyHaze, from the model, without colour', () => {
    const list = buildConditionsList(input({ haze: classifyHaze(30, 0.1), dust: 30, aod: 0.1 }));
    expect(list.ahead[0].text).toBe('Calima prevista');
    expect(list.ahead[0].origin).toBe('modelo');
    expect(list.ahead[0].tone).toBeNull();
    expect(list.ahead[0].detail).toContain('30 µg/m³');
    expect(buildConditionsList(input({ haze: classifyHaze(120, 0.1) })).ahead[0].text).toBe('Calima fuerte prevista');
    expect(buildConditionsList(input({ haze: classifyHaze(1, 0.02) })).ahead).toEqual([]);
  });

  it('the rain alert of the next hours colours the sentence, and speaks itself if the WRF says nothing', () => {
    const hourly = [hour(14, { precipitation: 3 })];
    const a = alert({ id: 'rain-forecast', category: 'rain', severity: 'moderate', title: 'Lluvia moderada prevista en ~4h' });
    const withHours = buildConditionsList(input({ alerts: [a], hourly, convection: hourly }));
    expect(withHours.ahead[0].id).toBe('ahead-rain');
    expect(withHours.ahead[0].tone).toBe('moderado');
    expect(withHours.level).toBe('riesgo');
    const alone = buildConditionsList(input({ alerts: [a] }));
    expect(alone.ahead[0].text).toBe('Lluvia moderada prevista en ~4h');
  });
});

describe('air quality', () => {
  const reading = (over: Partial<IcaReading>): IcaReading => ({ station: 'Coia', ica: 3, dominantPollutant: 'O3', categoryEs: 'Deficiente', color: '#f00', lat: 42.3, lon: -8.7, timestamp: NOW, ...over });

  it('one line: the worst station near the sector, with its distance', () => {
    const list = buildConditionsList(input({ ica: [reading({ ica: 3 }), reading({ station: 'Coia 2', ica: 4, categoryEs: 'Mala', lat: 42.4 })] }));
    const lines = list.now.filter((l) => l.id === 'air-quality');
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toMatch(/^Calidad del aire mala en Coia 2, a \d+ km del centro de la zona$/);
    expect(lines[0].origin).toBe('medido');
  });

  it('a station far from the sector or with good air says nothing', () => {
    expect(worstIcaNear([reading({ lat: 43.0, lon: -7.55 })], [-8.7, 42.3], 40)).toBeNull();
    expect(worstIcaNear([reading({ ica: 1 })], [-8.7, 42.3], 40)).toBeNull();
  });

  it('deficient does not light the dot on its own', () => {
    expect(buildConditionsList(input({ ica: [reading({ ica: 3 })] })).level).toBe('none');
    expect(buildConditionsList(input({ ica: [reading({ ica: 4 })] })).level).toBe('riesgo');
  });
});

describe('En el campo', () => {
  const frost = alert({ id: 'frost-forecast', category: 'frost', severity: 'moderate', title: 'Riesgo de helada', detail: 'Mín prevista -1.0°C', icon: 'snowflake' });

  it('frost goes there, without colour, and does not light the dot', () => {
    const list = buildConditionsList(input({ alerts: [frost] }));
    expect(list.campo[0].text).toBe('Riesgo de helada');
    expect(list.campo[0].tone).toBeNull();
    expect(list.campo[0].sub).toContain('-1.0°C');
    expect(list.now).toEqual([]);
    expect(list.level).toBe('none');
  });
});

describe('the strip by hours', () => {
  const hourly = Array.from({ length: 30 }, (_, i) => ({ time: new Date(2026, 10, 4, 10 + i), precipitation: i < 3 ? 12 : 0, precipProbability: 0, cape: 0, liftedIndex: null, cin: null, temperature: 12, cloudCover: 50, windSpeed: 3 } as HourlyForecast));

  it('only the rows with something', () => {
    const strip = buildHourStrip(hourly, hourly, NOW, null);
    expect(strip.rows.map((r) => r.id)).toEqual(['rain']);
    expect(strip.rows[0].cells[0].level).toBe('alto');
    expect(strip.rows[0].summary).toContain('probable');
    expect(strip.labels[0]).toBe('10 h');
  });

  it('nothing to draw when nothing is expected', () => {
    const dry = hourly.map((h) => ({ ...h, precipitation: 0 }));
    expect(buildHourStrip(dry, dry, NOW, null).rows).toEqual([]);
  });

  it('storm with the one rule', () => {
    const conv = hourly.map((h, i) => ({ ...h, precipitation: 0, cape: i === 4 ? 900 : 0, liftedIndex: i === 4 ? 1 : null }));
    expect(buildHourStrip(conv, conv, NOW, null).rows).toEqual([]);
    const real = hourly.map((h, i) => ({ ...h, precipitation: 0, cape: i === 4 ? 400 : 0, liftedIndex: i === 4 ? -3 : null, cin: 10 }));
    expect(buildHourStrip(real, real, NOW, null).rows[0].id).toBe('storm');
  });

  it('the blocks start at the hour in course, so the rain measured now has its block (review, 18-nov)', () => {
    const day = Array.from({ length: 30 }, (_, i) => hour(i % 24, { precipitation: 0 }, 4 + Math.floor(i / 24)));
    const at = new Date(2026, 10, 4, 13, 10);
    const strip = buildHourStrip(day, day, at, 'alto');
    expect(strip.labels[0]).toBe('13 h');
    expect(strip.rows[0].cells[0].label).toContain('medida ahora');
  });

  it('the probability alone is not rain in the strip either: the sentence and the strip agree', () => {
    const likely = hourly.map((h) => ({ ...h, precipitation: 0, precipProbability: 85 }));
    expect(buildHourStrip(likely, likely, NOW, null).rows).toEqual([]);
    expect(forecastLines(likely, [], NOW).some((l) => l.id === 'ahead-rain')).toBe(false);
  });

  it('measured rain wins in the block that holds now, and says so', () => {
    const dry = hourly.map((h) => ({ ...h, precipitation: 0 }));
    const strip = buildHourStrip(dry, dry, NOW, 'alto');
    expect(strip.rows[0].cells[0].level).toBe('alto');
    expect(strip.rows[0].cells[0].label).toContain('medida ahora');
  });

  it('frost: one neutral colour, only if it can freeze', () => {
    const cold = hourly.map((h) => ({ ...h, temperature: -1, cloudCover: 10, windSpeed: 1 }));
    const strip = buildFrostStrip(cold, NOW);
    expect(strip.rows[0].cells.some((c) => c.level === 'frost')).toBe(true);
    expect(buildFrostStrip(hourly, NOW).rows).toEqual([]);
  });
});

describe('day and hour in words', () => {
  it('today, tomorrow and another day', () => {
    expect(dayWord(new Date(2026, 10, 4, 23), NOW)).toBe('hoy');
    expect(dayWord(new Date(2026, 10, 5, 1), NOW)).toBe('mañana');
    expect(dayWord(new Date(2026, 10, 6, 1), NOW)).toMatch(/^el \S+ 6$/);
  });

  it('a span that already started says until when', () => {
    expect(spanWords(new Date(2026, 10, 4, 8), new Date(2026, 10, 4, 20), NOW)).toBe('hasta las 20 h');
    expect(spanWords(new Date(2026, 10, 4, 8), new Date(2026, 10, 5, 8), NOW)).toBe('hasta mañana a las 8 h');
  });

  it('a span across days says both', () => {
    expect(spanWords(new Date(2026, 10, 4, 22), new Date(2026, 10, 5, 8), NOW)).toBe('desde hoy a las 22 h hasta mañana a las 8 h');
  });
});

describe('fires in the list', () => {
  const near = {
    severity: 'alerta',
    fireCount: 1,
    nearest: { distanceKm: 12, bearing: 90, cluster: { lat: 42.3, lon: -8.5, latestAt: new Date(Date.now() - 60 * 60_000), frpMw: 40 } },
  } as unknown as Parameters<typeof fireLine>[0];

  it('names the zone, comes from the satellite and colours only when near', () => {
    const line = fireLine(near)!;
    expect(line.origin).toBe('medido');
    expect(line.tone).toBe('alto');
    expect(line.text).toMatch(/^Incendio /);
    expect(line.sub).toMatch(/^Satélite/);
    expect(fireLine({ ...near, severity: 'mencion' } as never)!.tone).toBeNull();
  });

  it('says nothing past the mention range', () => {
    expect(fireLine({ severity: 'none', fireCount: 0, nearest: null } as never)).toBeNull();
  });

  it('a fire on the far side of the range does not light the dot', () => {
    const list = buildConditionsList(input({ fires: { ...near, severity: 'mencion' } as never }));
    expect(list.now.some((l) => l.id === 'active-fires')).toBe(true);
    expect(list.level).toBe('none');
  });
});
