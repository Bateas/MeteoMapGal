/**
 * The strip beside the map tools says ONE sentence. It read «Aviso 3 · Aviso amarillo de… · Aviso
 * amarillo de… +1»: three cut pieces that began the same (seen on 11-nov).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { AlertPanel, worstLine, lightningRiskLine, stripWord } from './AlertPanel';
import type { SpotLightningRisk } from '../../services/lightningProximityService';

const risks = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock('../../hooks/useSpotLightningRisk', () => ({ useSpotLightningRisk: () => risks.list }));
const risk = (spotName: string, level: 'peligro' | 'aviso', nearestKm: number): SpotLightningRisk =>
  ({ spotId: spotName, spotName, level, nearestKm, countNear: 2, count25: 3, approaching: false, etaMin: null }) as unknown as SpotLightningRisk;
import { useAlertStore } from '../../store/alertStore';
import { useSpotStore } from '../../store/spotStore';
import { namedFirst } from '../../services/lightningProximityService';
import { useUIStore } from '../../store/uiStore';
import { useLevelZeroStore } from '../../store/levelZeroStore';
import { useWarningsStore } from '../../hooks/useWarnings';
import { useForecastStore } from '../../hooks/useForecastTimeline';
import type { MGWarning } from '../../api/mgWarningsClient';
import type { ConditionLine } from '../../services/alerts/conditionsList';

function warning(type: string, typeId: number, level: number, zone: string): MGWarning {
  const start = new Date(); start.setHours(start.getHours() + 1, 0, 0, 0);
  const end = new Date(start.getTime() + 2 * 3_600_000);
  return { type, typeId, maxLevel: level, publishedAt: new Date(), link: '', zones: [{ name: zone, id: 336, level, startTime: start, endTime: end, comment: '' }] };
}
const line = (id: string, tone: ConditionLine['tone']): ConditionLine => ({ id, icon: 'info', tone, origin: 'medido', text: id });

beforeEach(() => {
  cleanup();
  useAlertStore.setState({ alerts: [] });
  useWarningsStore.setState({ sectorWarnings: [], ipmaSectorWarnings: [], lastFetch: null });
  useForecastStore.setState({ hourly: [], convectionData: [] });
  // The sentence is what advanced shows; simple mode has its own rule, at the end.
  useUIStore.setState({ isMobile: false, fieldDrawerOpen: false, simpleMode: false });
  useLevelZeroStore.setState({ tickerKey: null });
  risks.list = [];
});

describe('the gravest line leads', () => {
  it('by tone, and among equals the first of the list', () => {
    expect(worstLine([])).toBeNull();
    expect(worstLine([line('a', null), line('b', 'moderado'), line('c', 'alto'), line('d', 'alto')])!.id).toBe('c');
    expect(worstLine([line('a', 'riesgo'), line('b', 'critico'), line('c', 'alto')])!.id).toBe('b');
    expect(worstLine([line('a', null), line('b', null)])!.id).toBe('a');
  });
});

describe('the word of the strip (18-nov: «Aviso» is the word of MeteoGalicia)', () => {
  it('the lowest level says «Aviso» only for an official line', () => {
    expect(stripWord('riesgo', { ...line('rain-now', 'riesgo'), origin: 'medido' })).toBe('Atención');
    expect(stripWord('riesgo', { ...line('fog', 'riesgo'), origin: 'modelo' })).toBe('Atención');
    expect(stripWord('riesgo', null)).toBe('Atención');
    expect(stripWord('riesgo', { ...line('official-ipma-0', 'riesgo'), origin: 'oficial' })).toBe('Aviso');
  });
  it('«Alerta» and «Peligro» do not change', () => {
    expect(stripWord('alto', line('x', 'alto'))).toBe('Alerta');
    expect(stripWord('critico', line('x', 'critico'))).toBe('Peligro');
  });
});

describe('the strip says one sentence', () => {
  it('one line with where and until when, and the rest as a count', () => {
    useWarningsStore.setState({ sectorWarnings: [warning('Choiva', 1, 1, 'Sur de Ourense'), warning('Vento', 3, 1, 'Miño de Ourense'), warning('Vento', 3, 2, 'Rías Baixas')] });
    const { container } = render(<AlertPanel />);
    const sentences = container.querySelectorAll('.gc-alertline');
    expect(sentences.length).toBe(1);
    // The orange one leads over the two yellow ones, with its level in a word and its place
    expect(sentences[0].textContent).toMatch(/Aviso naranja/);
    expect(sentences[0].textContent).toContain('Rías Baixas');
    expect(container.textContent).toContain('Alerta');
    expect(container.textContent).toContain('y 2 más');
    expect(container.querySelectorAll('.gc-alertchip').length).toBe(0);
    // The whole of it for a screen reader, and it still opens Condiciones
    const name = container.querySelector('button')!.getAttribute('aria-label')!;
    expect(name).toMatch(/^Alerta: Aviso naranja/);
    expect(name).toMatch(/y 2 más\. Ver condiciones$/);
  });

  it('a single warning carries no count', () => {
    useWarningsStore.setState({ sectorWarnings: [warning('Choiva', 1, 1, 'Sur de Ourense')] });
    const { container } = render(<AlertPanel />);
    expect(container.textContent).not.toMatch(/y \d+ más/);
    expect(container.querySelector('.gc-alertline')!.textContent).toContain('Sur de Ourense');
  });

  it('on the phone the place is left to the list: the sentence has to fit', () => {
    useUIStore.setState({ isMobile: true });
    useWarningsStore.setState({ sectorWarnings: [warning('Choiva', 1, 1, 'Sur de Ourense')] });
    const { container } = render(<AlertPanel />);
    expect(container.querySelector('.gc-alertline-sub')).toBeNull();
    expect(container.querySelector('button')!.getAttribute('aria-label')).toContain('Sur de Ourense');
  });
});

describe('simple mode: one voice per fact', () => {
  const fog = { id: 'maritime-fog', category: 'fog', severity: 'high', score: 80, icon: 'fog', title: 'Niebla en la ría', detail: '', urgent: false, updatedAt: new Date() };

  it('with only official warnings of MeteoGalicia it is not drawn: the strip over the map says them', () => {
    useUIStore.setState({ simpleMode: true });
    useWarningsStore.setState({ sectorWarnings: [warning('Choiva', 10, 1, 'Rías Baixas'), warning('Vento', 3, 2, 'Rías Baixas')] });
    const { container } = render(<AlertPanel />);
    expect(container.innerHTML).toBe('');
  });

  it('says what the upper strip does not, with the level of that line and not of the warning above', () => {
    useUIStore.setState({ simpleMode: true });
    useWarningsStore.setState({ sectorWarnings: [warning('Vento', 3, 3, 'Rías Baixas')] });
    useAlertStore.setState({ alerts: [fog as never] });
    const { container } = render(<AlertPanel />);
    const strip = container.querySelector('.gc-alertstrip')!;
    expect(strip.textContent).toContain('Niebla en la ría');
    expect(strip.textContent).not.toContain('MeteoGalicia');
    // a red warning above does not paint this line as «Peligro»
    expect(strip.querySelector('.gc-alertstrip-risk')!.textContent).toBe('Alerta');
    expect(strip.textContent).not.toContain('más');
  });

  it('what the line over the map is already saying is not said again', () => {
    useUIStore.setState({ simpleMode: true });
    useAlertStore.setState({ alerts: [{ ...fog, id: 'storm-main', category: 'storm', icon: 'zap', title: 'Tormenta cerca' } as never] });
    useLevelZeroStore.setState({ tickerKey: 'lightning-measured' });
    expect(render(<AlertPanel />).container.innerHTML).toBe('');
    cleanup();
    useLevelZeroStore.setState({ tickerKey: null });
    expect(render(<AlertPanel />).container.textContent).toContain('Tormenta cerca');
  });

  it('advanced keeps the whole list in its sentence', () => {
    useWarningsStore.setState({ sectorWarnings: [warning('Choiva', 10, 1, 'Rías Baixas')] });
    const { container } = render(<AlertPanel />);
    expect(container.textContent).toContain('MeteoGalicia');
  });
});

describe('lightning near a spot (F35: the strip said «Nada activo» under the band «Rayo a 6 km»)', () => {
  it('with nothing in the list, the strip says the danger and where', () => {
    risks.list = [risk('Castrelo', 'peligro', 5.6)];
    const { container } = render(<AlertPanel />);
    expect(container.textContent).not.toContain('Nada activo');
    expect(container.querySelector('.gc-alertstrip-risk')!.textContent).toBe('Peligro');
    expect(container.querySelector('.gc-alertline')!.textContent).toContain('Rayos a 6 km de Castrelo');
  });
  it('in simple mode it is drawn too, though the list is empty', () => {
    useUIStore.setState({ simpleMode: true });
    risks.list = [risk('Castrelo', 'aviso', 18)];
    const { container } = render(<AlertPanel />);
    expect(container.querySelector('.gc-alertstrip-risk')!.textContent).toBe('Alerta');
  });
  it('a graver line of the list keeps the lead; the lightning does not lower it', () => {
    risks.list = [risk('Castrelo', 'aviso', 18)];
    useWarningsStore.setState({ sectorWarnings: [warning('Vento', 3, 3, 'Rías Baixas')] });
    const { container } = render(<AlertPanel />);
    expect(container.querySelector('.gc-alertline')!.textContent).not.toContain('Rayos');
  });
  // The list comes from the service with the gravest and closest first; the simulation puts its spot first.
  it('the first spot in danger names the line; a warning alone is «alto»', () => {
    expect(lightningRiskLine([])).toBeNull();
    const two = lightningRiskLine([risk('Lourido', 'peligro', 4), risk('Cesantes', 'peligro', 8), risk('Vao', 'aviso', 3)])!;
    expect(two.level).toBe('critico');
    expect(two.line.text).toBe('Rayos a 4 km de Lourido');
    expect(two.line.sub).toBe('y otro spot');
    expect(lightningRiskLine([risk('Vao', 'aviso', 20)])!.level).toBe('alto');
  });
  // 25-nov, on a phone with ?simstrike=cesantes: the band said «Rayo a 6 km — Cesantes» and the strip
  // «Rayos a 6 km de Lourido». One rule for both: the same function, on the same list.
  it('names the same spot as the safety band, whatever the list', () => {
    const lists = [
      [risk('Cesantes', 'peligro', 6.2), risk('Lourido', 'peligro', 5.8), risk('Vao', 'aviso', 14)],
      [risk('Lourido', 'peligro', 5.8), risk('Cesantes', 'peligro', 6.2)],
      [risk('Vao', 'aviso', 14), risk('Bocana', 'aviso', 16)],
    ];
    for (const list of lists) {
      for (const [active, favourite] of [[null, null], ['Cesantes', null], [null, 'Lourido'], ['Vao', 'Cesantes'], ['Bocana', null]] as const) {
        const band = namedFirst(list, active, favourite);
        expect(lightningRiskLine(list, active, favourite)!.line.text, `${active}/${favourite}`).toContain(` de ${band.spotName}`);
      }
    }
  });
  it('the spot whose card is open names the line when it is in danger too; never over a graver one', () => {
    const list = [risk('Lourido', 'peligro', 5.8), risk('Cesantes', 'peligro', 6.2), risk('Vao', 'aviso', 14)];
    expect(lightningRiskLine(list, 'Cesantes', null)!.line.text).toBe('Rayos a 6 km de Cesantes');
    expect(lightningRiskLine(list, 'Vao', null)!.line.text).toBe('Rayos a 6 km de Lourido');
  });
  it('the strip on screen follows the open card', () => {
    risks.list = [risk('Lourido', 'peligro', 5.8), risk('Cesantes', 'peligro', 6.2)];
    useSpotStore.setState({ activeSpotId: 'Cesantes' } as never);
    const { container } = render(<AlertPanel />);
    expect(container.querySelector('.gc-alertline')!.textContent).toContain('Rayos a 6 km de Cesantes');
    useSpotStore.setState({ activeSpotId: '' } as never);
  });
});
