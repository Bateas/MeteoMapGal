import { describe, it, expect } from 'vitest';
import { parseWarningsXML, parseMGDate } from '../src/api/mgWarningsClient';
import { describeLevels, warningInsertParts, warningRows, WARNING_COLS } from './mgWarningsArchiveLogic';

// The feed as it was on 10-nov-2026 (two zones of one rain warning), shortened.
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:adversos="adversos" version="2.0"><channel><title>Avisos</title>
<item>
  <title>Aviso de nivel máximo amarelo de Precipitación 12 horas</title>
  <link>https://www.meteogalicia.gal/web/predicion/avisos/0</link>
  <pubDate>Tue, 10 Nov 2026 11:05:43 GMT</pubDate>
  <adversos:TipoAlerta nome="Precipitación 12 horas" idtipoalerta="4" nivelMax="1">
    <zona nome="Sur de Ourense" id="331">
      <tramo>
        <dataIni descricion="Data e hora de inicio">11/11/2026 12:00</dataIni>
        <dataFin descricion="Data e hora de finalización">12/11/2026 00:00</dataFin>
        <nivel descricion="Nivel de alerta">1</nivel>
        <comentario>Acumulacións de máis de 40 l/m2 en 12 horas</comentario>
      </tramo>
    </zona>
    <zona nome="Montaña de Ourense" id="332">
      <tramo>
        <dataIni>11/11/2026 12:00</dataIni>
        <dataFin>12/11/2026 00:00</dataFin>
        <nivel>2</nivel>
        <comentario>Acumulacións de máis de 80 l/m2 en 12 horas</comentario>
      </tramo>
      <tramo>
        <dataIni>sen data</dataIni>
        <dataFin>12/11/2026 06:00</dataFin>
        <nivel>1</nivel>
        <comentario>x</comentario>
      </tramo>
    </zona>
  </adversos:TipoAlerta>
</item>
</channel></rss>`;

describe('parseMGDate: Galicia clock time, whatever the clock of the machine', () => {
  it('reads winter time as UTC+1 and summer time as UTC+2', () => {
    expect(parseMGDate('11/11/2026 12:00').toISOString()).toBe('2026-11-11T11:00:00.000Z');
    expect(parseMGDate('15/07/2026 12:00').toISOString()).toBe('2026-07-15T10:00:00.000Z');
    expect(parseMGDate('12/11/2026 00:00').toISOString()).toBe('2026-11-11T23:00:00.000Z');
  });
  it('holds across the change of hour', () => {
    expect(parseMGDate('25/10/2026 01:30').toISOString()).toBe('2026-10-24T23:30:00.000Z');
    expect(parseMGDate('25/10/2026 04:00').toISOString()).toBe('2026-10-25T03:00:00.000Z');
    expect(parseMGDate('29/03/2026 04:00').toISOString()).toBe('2026-03-29T02:00:00.000Z');
  });
});

describe('warningRows', () => {
  const { rows, skipped } = warningRows(parseWarningsXML(FEED));

  it('gives one row per zone and span, with its own level and times in UTC', () => {
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ type: 'Precipitación 12 horas', typeId: 4, zone: 'Sur de Ourense', zoneId: 331, level: 1 });
    expect(rows[0].start.toISOString()).toBe('2026-11-11T11:00:00.000Z');
    expect(rows[0].end.toISOString()).toBe('2026-11-11T23:00:00.000Z');
    expect(rows[0].publishedAt?.toISOString()).toBe('2026-11-10T11:05:43.000Z');
    expect(rows[1]).toMatchObject({ zoneId: 332, level: 2 });
  });

  it('leaves out a span whose date cannot be read, and counts it', () => {
    expect(skipped).toBe(1);
  });

  it('the same feed twice gives the same keys (no new row at every pass)', () => {
    const again = warningRows(parseWarningsXML(FEED)).rows;
    expect(again.map((r) => [r.start.getTime(), r.end.getTime()])).toEqual(rows.map((r) => [r.start.getTime(), r.end.getTime()]));
  });

  it('a repeated span in the feed is one row', () => {
    const twice = parseWarningsXML(FEED);
    expect(warningRows([...twice, ...twice]).rows).toHaveLength(2);
  });

  it('an empty feed is no rows', () => {
    expect(warningRows(parseWarningsXML('<rss><channel><title>Avisos</title></channel></rss>'))).toEqual({ rows: [], skipped: 0 });
  });
});

describe('warningInsertParts', () => {
  it('placeholders, values and columns add up', () => {
    const { rows } = warningRows(parseWarningsXML(FEED));
    const seenAt = new Date('2026-11-10T12:00:00Z');
    const { tuples, values } = warningInsertParts(rows, seenAt);
    expect(tuples).toHaveLength(2);
    expect(values).toHaveLength(2 * WARNING_COLS);
    expect(tuples[1]).toBe('($11,$12,$13,$14,$15,$16,$17,$18,$19,$20)');
    expect(values[0]).toBe(4);
    expect(values[9]).toBe(seenAt);
  });
});

describe('describeLevels', () => {
  it('names what there is', () => {
    expect(describeLevels(warningRows(parseWarningsXML(FEED)).rows)).toBe('1 naranja, 1 amarillo');
    expect(describeLevels([])).toBe('ninguno');
  });
});
