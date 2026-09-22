import { describe, it, expect } from 'vitest';
import { isMeteoSixErrorEnvelope } from './proxyHandlers';

describe('isMeteoSixErrorEnvelope', () => {
  const b = (s: string) => Buffer.from(s, 'utf8');

  it('spots the error answer MeteoSIX sends with a 200', () => {
    expect(isMeteoSixErrorEnvelope(b('{"exception":{"code":"000","message":"Mmmm... algo ha ido mal."}}'))).toBe(true);
    expect(isMeteoSixErrorEnvelope(b(' { "exception" : {"message":"No se puede obtener la informacion"}}'))).toBe(true);
  });

  it('lets a real table through, even one that mentions the word later on', () => {
    expect(isMeteoSixErrorEnvelope(b('{"type":"FeatureCollection","features":[{"properties":{"note":"exception"}}]}'))).toBe(false);
    expect(isMeteoSixErrorEnvelope(b(''))).toBe(false);
  });
});
