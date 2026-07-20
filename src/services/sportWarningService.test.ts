import { describe, it, expect } from 'vitest';
import {
  buildSportWarningNotice,
  sportWarningTexts,
  createSimulatedWarning,
  SPORT_WAVE_LIMIT_M,
  SPORT_WIND_LIMIT_KT,
} from './sportWarningService';
import type { MGWarning, MGWarningZone } from '../api/mgWarningsClient';

const NOW = new Date('2026-07-20T12:00:00Z');

/** Zone active around NOW unless overridden. */
function zone(level: number, over: Partial<MGWarningZone> = {}): MGWarningZone {
  return {
    name: 'Rías Baixas',
    id: 400,
    level,
    startTime: new Date(NOW.getTime() - 60 * 60_000),
    endTime: new Date(NOW.getTime() + 6 * 60 * 60_000),
    comment: '',
    ...over,
  };
}

function warning(type: string, level: number, zones?: MGWarningZone[]): MGWarning {
  const zs = zones ?? [zone(level)];
  return {
    type,
    typeId: 3,
    maxLevel: level,
    zones: zs,
    publishedAt: NOW,
    link: 'https://www.meteogalicia.gal/',
  };
}

function build(warnings: MGWarning[], waveHeightM: number | null, windKt: number | null) {
  return buildSportWarningNotice({
    warnings,
    sectorId: 'rias',
    waveHeightM,
    windKt,
    now: NOW,
  });
}

describe('buildSportWarningNotice — when it stays silent', () => {
  it('returns null with no warnings at all', () => {
    expect(build([], 2.1, 18)).toBeNull();
  });

  it('returns null for a yellow warning', () => {
    expect(build([warning('Ondas', 1)], 2.1, 18)).toBeNull();
  });

  it('returns null for an inland sector even with an orange marine warning', () => {
    const notice = buildSportWarningNotice({
      warnings: [warning('Ondas', 2)],
      sectorId: 'embalse',
      waveHeightM: 2.1,
      windKt: 18,
      now: NOW,
    });
    expect(notice).toBeNull();
  });

  it('returns null for a non-marine orange warning (heat)', () => {
    expect(build([warning('Calor', 2)], 2.1, 18)).toBeNull();
  });

  it('returns null when the orange window is not open yet', () => {
    const future = zone(2, {
      startTime: new Date(NOW.getTime() + 3 * 60 * 60_000),
      endTime: new Date(NOW.getTime() + 9 * 60 * 60_000),
    });
    expect(build([warning('Ondas', 2, [future])], 2.1, 18)).toBeNull();
  });
});

describe('buildSportWarningNotice — orange with both values', () => {
  it('reports the threshold and the current numbers when below it', () => {
    const notice = build([warning('Ondas', 2)], 2.1, 18);
    expect(notice).not.toBeNull();
    expect(notice!.level).toBe(2);
    expect(notice!.comparison).toBe('below');
    expect(notice!.exceeded).toEqual([]);
    expect(notice!.headline).toBe('Aviso naranja por oleaje');
    expect(notice!.thresholdText).toContain(`${SPORT_WAVE_LIMIT_M} m`);
    expect(notice!.thresholdText).toContain(`${SPORT_WIND_LIMIT_KT} kt`);
    // Spanish decimal comma, both magnitudes present.
    expect(notice!.currentText).toBe('Ahora mismo: 2,1 m de ola y 18 kt de viento.');
    // Below the threshold we say nothing extra — no verdict, no green light.
    expect(notice!.statusText).toBeNull();
  });

  it('states "por encima del umbral" for a 5 m sea without forbidding anything', () => {
    const notice = build([warning('Ondas', 2)], 5, 18);
    expect(notice!.comparison).toBe('above');
    expect(notice!.exceeded).toEqual(['ola']);
    expect(notice!.statusText).toBe('Por encima del umbral deportivo: ola.');
    expect(notice!.currentText).toContain('5,0 m de ola');
    const joined = sportWarningTexts(notice!).join(' ').toLowerCase();
    expect(joined).not.toContain('prohib');
    expect(joined).not.toContain('no salgas');
  });

  it('flags both magnitudes when wind also exceeds the limit', () => {
    const notice = build([warning('Vento', 2)], 4.5, 52);
    expect(notice!.headline).toBe('Aviso naranja por viento');
    expect(notice!.exceeded).toEqual(['ola', 'viento']);
    expect(notice!.statusText).toBe('Por encima del umbral deportivo: ola y viento.');
  });

  it('treats the exact limits as not exceeded', () => {
    const notice = build([warning('Ondas', 2)], SPORT_WAVE_LIMIT_M, SPORT_WIND_LIMIT_KT);
    expect(notice!.comparison).toBe('below');
    expect(notice!.exceeded).toEqual([]);
  });
});

describe('buildSportWarningNotice — missing data', () => {
  it('shows the known wind and names the missing wave — the ria case', () => {
    // Inside a ria there is rarely a spot-local wave reading, but the wind is
    // measured and is the number that decides anything there. It must show,
    // with the missing magnitude named so nobody assumes it was checked.
    const notice = build([warning('Ondas', 2)], null, 18);
    expect(notice!.comparison).toBe('unknown');
    expect(notice!.currentText).toBe('Ahora mismo: 18 kt de viento.');
    expect(notice!.thresholdText).toContain('4 m de ola');
    expect(notice!.statusText).toContain('No hay dato de ola');
    // No wave number is invented anywhere.
    expect(sportWarningTexts(notice!).join(' ')).not.toMatch(/\d+,\d+ m de ola/);
  });

  it('shows no numbers when both values are unknown', () => {
    const notice = build([warning('Ondas', 2)], null, null);
    expect(notice!.comparison).toBe('unknown');
    expect(notice!.currentText).toBeNull();
    expect(notice!.statusText).toContain('de ola ni de viento');
  });

  it('shows the known wave and names the missing wind', () => {
    const notice = build([warning('Ondas', 2)], 2.1, null);
    expect(notice!.currentText).toBe('Ahora mismo: 2,1 m de ola.');
    expect(notice!.statusText).toContain('No hay dato de viento');
  });

  it('ignores a negative or non-finite reading as missing', () => {
    const notice = build([warning('Ondas', 2)], Number.NaN, 18);
    expect(notice!.comparison).toBe('unknown');
    // NaN wave = missing wave: the wind still shows, the wave never does.
    expect(notice!.currentText).toBe('Ahora mismo: 18 kt de viento.');
    expect(sportWarningTexts(notice!).join(' ')).not.toContain('NaN');
  });
});

describe('buildSportWarningNotice — red', () => {
  it('does not apply the exception and shows neither threshold nor numbers', () => {
    const notice = build([warning('Ondas', 3)], 5.8, 40);
    expect(notice!.level).toBe(3);
    expect(notice!.exceptionApplies).toBe(false);
    expect(notice!.thresholdText).toBeNull();
    expect(notice!.currentText).toBeNull();
    expect(notice!.waveHeightM).toBeNull();
    expect(notice!.statusText).toContain('no se aplica');
  });

  it('lets red win over a coexisting orange warning', () => {
    const notice = build([warning('Ondas', 2), warning('Vento', 3)], 2.1, 18);
    expect(notice!.level).toBe(3);
    expect(notice!.exceptionApplies).toBe(false);
    // The orange threshold framing must not leak into a red situation.
    expect(sportWarningTexts(notice!).join(' ')).not.toContain('umbral deportivo son');
  });
});

describe('legal guardrail — the notice informs, it never authorises', () => {
  /**
   * This is the load-bearing test of the feature: the app may not emit
   * anything a reader could take as permission to go out. If a copy change
   * ever trips this, the copy is wrong, not the test.
   */
  const FORBIDDEN = [
    'puedes',
    'puede salir',
    'podés',
    'permitido',
    'permitida',
    'se permite',
    'apto',
    'vía libre',
    'via libre',
    'luz verde',
    'adelante',
    'autoriza',
    'autorizado',
    'sal ',
    'prohibido',
    'prohibida',
  ];

  const cases: Array<[string, ReturnType<typeof build>]> = [
    ['below threshold', build([warning('Ondas', 2)], 2.1, 18)],
    ['above threshold', build([warning('Ondas', 2)], 5.2, 55)],
    ['missing wave', build([warning('Ondas', 2)], null, 18)],
    ['missing both', build([warning('Ondas', 2)], null, null)],
    ['red warning', build([warning('Ondas', 3)], 5.8, 40)],
    ['wind warning', build([warning('Vento', 2)], 1.2, 30)],
  ];

  for (const [name, notice] of cases) {
    it(`uses no authorisation wording — ${name}`, () => {
      expect(notice).not.toBeNull();
      const text = sportWarningTexts(notice!).join(' | ').toLowerCase();
      for (const word of FORBIDDEN) {
        expect(text, `"${word}" found in: ${text}`).not.toContain(word);
      }
    });
  }

  it('always carries the source attribution', () => {
    for (const [, notice] of cases) {
      expect(notice!.sourceText).toContain('Xunta');
      expect(notice!.sourceText).toContain('1 de junio de 2026');
    }
  });
});

describe('createSimulatedWarning', () => {
  it('feeds each demo case through the real service', () => {
    const below = createSimulatedWarning('below', NOW);
    const n1 = buildSportWarningNotice({ ...below, sectorId: 'rias', now: NOW });
    expect(n1!.comparison).toBe('below');

    const above = createSimulatedWarning('above', NOW);
    const n2 = buildSportWarningNotice({ ...above, sectorId: 'rias', now: NOW });
    expect(n2!.comparison).toBe('above');

    const missing = createSimulatedWarning('missing', NOW);
    const n3 = buildSportWarningNotice({ ...missing, sectorId: 'rias', now: NOW });
    expect(n3!.comparison).toBe('unknown');

    const red = createSimulatedWarning('red', NOW);
    const n4 = buildSportWarningNotice({ ...red, sectorId: 'rias', now: NOW });
    expect(n4!.exceptionApplies).toBe(false);
  });
});

describe('binding threshold — which limit actually decides here', () => {
  it('an inner-ria spot lands on the wind: 4m of wave cannot happen there', () => {
    // Cesantes-like: a real orange blow, but the sheltered wave stays tiny.
    // Quoting "4 m" as the thing to watch would compare against water that
    // never arrives and hide the number that does matter.
    const n = buildSportWarningNotice({
      warnings: [warning('Ondas', 2)], sectorId: 'rias',
      waveHeightM: 0.3, windKt: 28, now: NOW,
    })!;
    expect(n.binding).toBe('viento');
    expect(n.bindingText).toContain('viento');
    expect(sportWarningTexts(n).join(' ')).toContain('no se acerca al umbral');
  });

  it('an exposed beach lands on the wave', () => {
    const n = buildSportWarningNotice({
      warnings: [warning('Ondas', 2)], sectorId: 'rias',
      waveHeightM: 3.6, windKt: 15, now: NOW,
    })!;
    expect(n.binding).toBe('ola');
  });

  it('still names a binding threshold when both sit below the limits', () => {
    const n = buildSportWarningNotice({
      warnings: [warning('Ondas', 2)], sectorId: 'rias',
      waveHeightM: 1.0, windKt: 20, now: NOW,
    })!;
    expect(n.comparison).toBe('below');
    expect(n.binding).not.toBeNull();
  });

  it('names no binding threshold when a value is missing', () => {
    const n = buildSportWarningNotice({
      warnings: [warning('Ondas', 2)], sectorId: 'rias',
      waveHeightM: null, windKt: 20, now: NOW,
    })!;
    expect(n.binding).toBeNull();
    expect(n.bindingText).toBeNull();
  });

  it('the binding sentence never turns into permission', () => {
    const n = buildSportWarningNotice({
      warnings: [warning('Ondas', 2)], sectorId: 'rias',
      waveHeightM: 0.2, windKt: 10, now: NOW,
    })!;
    const all = sportWarningTexts(n).join(' ').toLowerCase();
    for (const word of ['puedes', 'permitido', 'apto', 'via libre', 'vía libre', 'adelante']) {
      expect(all).not.toContain(word);
    }
  });
});

