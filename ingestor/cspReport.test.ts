import { describe, it, expect } from 'vitest';
import { parseCspReports, blockedHostOf, CSP_MAX_PER_REQUEST } from './cspReport';

describe('parseCspReports', () => {
  it('reads the report-uri format and keeps only directive and host', () => {
    const body = JSON.stringify({
      'csp-report': {
        'document-uri': 'https://meteomapgal.navia3d.com/?spot=cesantes',
        'effective-directive': 'connect-src',
        'violated-directive': 'connect-src',
        'blocked-uri': 'https://tiles.example.org/7/62/47.png?key=secret',
        'script-sample': 'alert(1)',
      },
    });
    expect(parseCspReports(body)).toEqual([{ directive: 'connect-src', blocked: 'tiles.example.org' }]);
  });

  it('reads the Reporting API format and skips other report types', () => {
    const body = JSON.stringify([
      { type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: 'https://cams.example.es/a.jpg' } },
      { type: 'deprecation', body: { id: 'x' } },
      { type: 'csp-violation', body: { effectiveDirective: 'script-src-elem', blockedURL: 'inline' } },
    ]);
    expect(parseCspReports(body)).toEqual([
      { directive: 'img-src', blocked: 'cams.example.es' },
      { directive: 'script-src-elem', blocked: 'inline' },
    ]);
  });

  it('keeps only the directive name from an old full violated-directive', () => {
    const body = JSON.stringify({ 'csp-report': { 'violated-directive': "script-src 'self' https://x.org", 'blocked-uri': 'eval' } });
    expect(parseCspReports(body)).toEqual([{ directive: 'script-src', blocked: 'eval' }]);
  });

  it('drops what is not a report', () => {
    for (const bad of ['', 'null', '7', '[]', '{}', 'not json', '{"csp-report":null}', '{"csp-report":{"blocked-uri":"https://a.b"}}']) {
      expect(parseCspReports(bad)).toEqual([]);
    }
    const weird = JSON.stringify({ 'csp-report': { 'effective-directive': 'connect-src\n2026-10-30 OK forged', 'blocked-uri': 'https://a.b' } });
    expect(parseCspReports(weird)).toEqual([{ directive: 'connect-src', blocked: 'a.b' }]); // forged rest cut off
    const tag = JSON.stringify({ 'csp-report': { 'effective-directive': '<script>', 'blocked-uri': 'https://a.b' } });
    expect(parseCspReports(tag)).toEqual([]);
  });

  it('reads at most a few violations from one request', () => {
    const many = JSON.stringify(Array.from({ length: 50 }, () => ({ type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: 'https://a.b/x' } })));
    expect(parseCspReports(many)).toHaveLength(CSP_MAX_PER_REQUEST);
  });
});

describe('blockedHostOf', () => {
  it('gives the host, never the path, and marks schemes other than https', () => {
    expect(blockedHostOf('https://Tiles.Example.org:8443/a?b=c')).toBe('tiles.example.org:8443');
    expect(blockedHostOf('http://a.b/x')).toBe('http://a.b');
    expect(blockedHostOf('wss://a.b/socket')).toBe('wss://a.b');
    expect(blockedHostOf('data:image/png;base64,AAAA')).toBe('data');
    expect(blockedHostOf('blob:https://meteomapgal.navia3d.com/uuid')).toBe('blob');
    expect(blockedHostOf('javascript:alert(1)')).toBeNull();
    expect(blockedHostOf('not a url')).toBeNull();
    expect(blockedHostOf(42)).toBeNull();
  });
});
