/**
 * Tests for swanGetFeatureInfo — XML parsing + URL builder.
 *
 * Network fetch is NOT tested (would require mock + CESGA dependency).
 * The parser/builder are pure functions and where the bugs live.
 */
import { describe, it, expect } from 'vitest';
import { parseSwanGfiXml, buildSwanGfiUrl } from './swanGetFeatureInfo';

describe('parseSwanGfiXml', () => {
  it('extracts hs from valid XML response', () => {
    const xml = `<?xml version="1.0"?>
<FeatureInfoResponse>
  <FeatureInfo>
    <time>2026-05-27T16:00:00Z</time>
    <value>1.84</value>
  </FeatureInfo>
</FeatureInfoResponse>`;
    const result = parseSwanGfiXml(xml);
    expect(result.hs).toBeCloseTo(1.84, 2);
    expect(result.time).toBe('2026-05-27T16:00:00Z');
  });

  it('handles integer wave height', () => {
    const xml = `<FeatureInfoResponse><FeatureInfo><value>3</value></FeatureInfo></FeatureInfoResponse>`;
    expect(parseSwanGfiXml(xml).hs).toBe(3);
  });

  it('returns null hs when value is "none" (out of domain)', () => {
    const xml = `<FeatureInfoResponse><FeatureInfo><value>none</value></FeatureInfo></FeatureInfoResponse>`;
    expect(parseSwanGfiXml(xml).hs).toBeNull();
  });

  it('returns null hs when value is NaN', () => {
    const xml = `<FeatureInfoResponse><FeatureInfo><value>NaN</value></FeatureInfo></FeatureInfoResponse>`;
    expect(parseSwanGfiXml(xml).hs).toBeNull();
  });

  it('returns null hs when no value tag', () => {
    const xml = `<FeatureInfoResponse><FeatureInfo><time>2026-05-27T16:00:00Z</time></FeatureInfo></FeatureInfoResponse>`;
    expect(parseSwanGfiXml(xml).hs).toBeNull();
  });

  it('returns null hs for empty XML', () => {
    expect(parseSwanGfiXml('').hs).toBeNull();
    expect(parseSwanGfiXml('<FeatureInfoResponse/>').hs).toBeNull();
  });

  it('sanity-caps absurd values (parse error → null)', () => {
    const xml = `<FeatureInfoResponse><FeatureInfo><value>99999</value></FeatureInfo></FeatureInfoResponse>`;
    // 99999m would be measurement/parse error. Cap at 30m max.
    expect(parseSwanGfiXml(xml).hs).toBeNull();
  });

  it('rejects negative values', () => {
    const xml = `<FeatureInfoResponse><FeatureInfo><value>-1.5</value></FeatureInfo></FeatureInfoResponse>`;
    // Wave height can't be negative — parse error.
    expect(parseSwanGfiXml(xml).hs).toBeNull();
  });

  it('handles whitespace in value tag', () => {
    const xml = `<FeatureInfoResponse><FeatureInfo><value>  2.1  </value></FeatureInfo></FeatureInfoResponse>`;
    expect(parseSwanGfiXml(xml).hs).toBeCloseTo(2.1, 1);
  });
});

describe('buildSwanGfiUrl', () => {
  it('builds well-formed URL with bbox centered on lat/lon', () => {
    const url = buildSwanGfiUrl({ lat: 42.3, lon: -8.8 });
    expect(url).toContain('SERVICE=WMS');
    expect(url).toContain('REQUEST=GetFeatureInfo');
    expect(url).toContain('LAYERS=hs');
    expect(url).toContain('QUERY_LAYERS=hs');
    expect(url).toContain('SRS=EPSG:4326');
    expect(url).toContain('INFO_FORMAT=text/xml');
    expect(url).toContain('WIDTH=2&HEIGHT=2');
    expect(url).toContain('X=0&Y=0');
  });

  it('includes encoded TIME parameter', () => {
    const url = buildSwanGfiUrl({ lat: 42.3, lon: -8.8 });
    expect(url).toContain('TIME=');
    // ISO timestamp with milliseconds zeroed
    expect(url).toMatch(/TIME=[^&]*T\d{2}%3A00%3A00.000Z/);
  });

  it('shifts time forward when hourOffset > 0', () => {
    const url0 = buildSwanGfiUrl({ lat: 42.3, lon: -8.8, hourOffset: 0 });
    const url6 = buildSwanGfiUrl({ lat: 42.3, lon: -8.8, hourOffset: 6 });
    expect(url0).not.toBe(url6);
  });

  it('builds bbox with ±0.01 degrees around the spot', () => {
    const url = buildSwanGfiUrl({ lat: 42.3, lon: -8.8 });
    expect(url).toContain('BBOX=-8.8100,42.2900,-8.7900,42.3100');
  });
});
