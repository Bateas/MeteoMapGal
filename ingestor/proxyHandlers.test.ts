/**
 * Real users got a 502 for the AEMET station inventory: AEMET failed, and the
 * "serve the last good copy" path had nothing to serve, because every cache
 * here was pruned at its freshness TTL. These pin the three pieces that make
 * the last good copy exist and be the right one.
 */
import { describe, it, expect } from 'vitest';
import { aemetTtlFor, aemetAnswerOk, aemetDataPaths, AEMET_INVENTORY_TTL, isMeteoSixErrorEnvelope } from './proxyHandlers';

const b = (s: string) => Buffer.from(s, 'utf8');

/** A step-one answer exactly as AEMET sent it on 23-sep. */
const STEP_ONE = b(`{
  "descripcion" : "exito",
  "estado" : 200,
  "datos" : "https://opendata.aemet.es/opendata/sh/a9ce101b",
  "metadatos" : "https://opendata.aemet.es/opendata/sh/0556af7a"
}`);

describe('aemetTtlFor', () => {
  it('keeps the station inventory for hours: it barely changes', () => {
    expect(aemetTtlFor('/api/valores/climatologicos/inventarioestaciones/todasestaciones'))
      .toBe(AEMET_INVENTORY_TTL);
  });

  it('keeps observations short: they change every few minutes', () => {
    expect(aemetTtlFor('/api/observacion/convencional/todas')).toBeLessThan(10 * 60_000);
  });
});

describe('aemetAnswerOk', () => {
  it('accepts a real step-one answer', () => {
    expect(aemetAnswerOk(STEP_ONE)).toBe(true);
  });

  it('rejects AEMET failures dressed as a 200', () => {
    // Caching this under a twelve-hour TTL would serve it to everyone all day.
    expect(aemetAnswerOk(b('{"descripcion":"Limite de peticiones","estado":429}'))).toBe(false);
    expect(aemetAnswerOk(b('{ "descripcion" : "No hay datos", "estado" : 404 }'))).toBe(false);
  });

  it('accepts data payloads, which are arrays', () => {
    expect(aemetAnswerOk(b('[{"indicativo":"1484C","nombre":"PONTEVEDRA"}]'))).toBe(true);
    expect(aemetAnswerOk(b('  \n[ ]'))).toBe(true);
  });

  it('reads Latin-1 bodies without choking (AEMET data is ISO-8859-1)', () => {
    expect(aemetAnswerOk(Buffer.from('[{"nombre":"OURENSE, A CORUÑA"}]', 'latin1'))).toBe(true);
  });
});

describe('aemetDataPaths', () => {
  it('returns both step-two paths in the form the data route receives them', () => {
    expect(aemetDataPaths(STEP_ONE)).toEqual(['/opendata/sh/a9ce101b', '/opendata/sh/0556af7a']);
  });

  it('ignores anything that does not point at AEMET', () => {
    expect(aemetDataPaths(b('{"estado":200,"datos":"https://example.com/opendata/sh/x"}'))).toEqual([]);
  });

  it('returns nothing for a body that is not a step-one answer', () => {
    expect(aemetDataPaths(b('[1,2,3]'))).toEqual([]);
    expect(aemetDataPaths(b('no es json'))).toEqual([]);
  });
});

describe('isMeteoSixErrorEnvelope', () => {
  it('spots the error answer MeteoSIX sends with a 200', () => {
    expect(isMeteoSixErrorEnvelope(b('{"exception":{"code":"000","message":"Mmmm... algo ha ido mal."}}'))).toBe(true);
    expect(isMeteoSixErrorEnvelope(b(' { "exception" : {"message":"No se puede obtener la informacion"}}'))).toBe(true);
  });

  it('lets a real table through, even one that mentions the word later on', () => {
    expect(isMeteoSixErrorEnvelope(b('{"type":"FeatureCollection","features":[{"properties":{"note":"exception"}}]}'))).toBe(false);
    expect(isMeteoSixErrorEnvelope(b(''))).toBe(false);
  });
});
