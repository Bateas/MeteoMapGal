/**
 * EFFIS burnt-area parser tests.
 *
 * The fixture is a REAL response from
 * `maps.effis.emergency.copernicus.eu/effis` (WFS GetFeature,
 * `ms:modis.ba.poly.week`, Galicia bbox), captured 2026-07-27. Only the
 * `gml:posList` vertex runs were shortened — every tag, attribute, namespace
 * and value is untouched, so a change in the wire format breaks these tests
 * instead of silently emptying the fire layer in production.
 *
 * The three events kept are the ones that make the case for this fetcher:
 * two named Galician fires (Carnota and Pazos de Borben) that the
 * hotspot-based layer never showed, plus a Portuguese one just across the
 * border, which is why the bbox has a buffer.
 *
 * `runEffisCycle` is only shape-tested: like every other `run*Cycle` in the
 * ingestor it writes through `getPool()`, and there is no database here.
 */

import { describe, it, expect } from 'vitest';
import {
  parseEffisGml,
  parseEffisTimestamp,
  isGalicianProvince,
  normalizeProvince,
  runEffisCycle,
  EFFIS_ATTRIBUTION,
  type EffisFire,
} from './effisFetcher.js';

// ── Fixture: real EFFIS GML 3.1.1 (posList vertices trimmed) ──

const GML_HEADER = `<?xml version='1.0' encoding="UTF-8" ?>
<wfs:FeatureCollection
   xmlns:ms="http://mapserver.gis.umn.edu/mapserver"
   xmlns:gml="http://www.opengis.net/gml"
   xmlns:wfs="http://www.opengis.net/wfs"
   xmlns:ogc="http://www.opengis.net/ogc"
   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
   xsi:schemaLocation="http://mapserver.gis.umn.edu/mapserver http://maps.effis.emergency.copernicus.eu/effis?SERVICE=WFS&amp;VERSION=1.1.0&amp;REQUEST=DescribeFeatureType&amp;TYPENAME=ms:modis.ba.poly.week&amp;OUTPUTFORMAT=text/xml;%20subtype=gml/3.1.1  http://www.opengis.net/wfs http://schemas.opengis.net/wfs/1.1.0/wfs.xsd">
      <gml:boundedBy>
      	<gml:Envelope srsName="EPSG:4326">
      		<gml:lowerCorner>41.827721 -9.099190</gml:lowerCorner>
      		<gml:upperCorner>42.861167 -5.967806</gml:upperCorner>
      	</gml:Envelope>
      </gml:boundedBy>
`;

/** Portugal, Alto Minho — just across the border, inside the buffered bbox. */
const FEATURE_PT = `    <gml:featureMember>
      <ms:modis.ba.poly.week gml:id="modis.ba.poly.week.562633">
        <gml:boundedBy>
        	<gml:Envelope srsName="EPSG:4326">
        		<gml:lowerCorner>41.827721 -8.401160</gml:lowerCorner>
        		<gml:upperCorner>41.830553 -8.398640</gml:upperCorner>
        	</gml:Envelope>
        </gml:boundedBy>
        <ms:msGeometry>
          <gml:Polygon srsName="EPSG:4326">
            <gml:exterior>
              <gml:LinearRing>
                <gml:posList srsDimension="2">41.830540 -8.399237 41.830553 -8.399347 41.830546 -8.399443 41.830519 -8.399525</gml:posList>
              </gml:LinearRing>
            </gml:exterior>
          </gml:Polygon>
        </ms:msGeometry>
        <ms:id>562633</ms:id>
        <ms:FIREDATE>2026-07-20 15:37:00</ms:FIREDATE>
        <ms:LASTUPDATE>2026-07-23 09:22:20.067977</ms:LASTUPDATE>
        <ms:COUNTRY>PT</ms:COUNTRY>
        <ms:PROVINCE>Alto Minho</ms:PROVINCE>
        <ms:COMMUNE>Oliveira</ms:COMMUNE>
        <ms:AREA_HA>4</ms:AREA_HA>
        <ms:BROADLEA>0</ms:BROADLEA>
        <ms:CONIFER>99.99999999666667</ms:CONIFER>
        <ms:MIXED>0</ms:MIXED>
        <ms:SCLEROPH>0</ms:SCLEROPH>
        <ms:TRANSIT>0</ms:TRANSIT>
        <ms:OTHERNATLC>0</ms:OTHERNATLC>
        <ms:AGRIAREAS>0</ms:AGRIAREAS>
        <ms:ARTIFSURF>0</ms:ARTIFSURF>
        <ms:OTHERLC>0</ms:OTHERLC>
        <ms:PERCNA2K>0</ms:PERCNA2K>
        <ms:CLASS>30DAYS</ms:CLASS>
      </ms:modis.ba.poly.week>
    </gml:featureMember>
`;

/** Carnota, A Coruna — 2 ha, accented province name. */
const FEATURE_CARNOTA = `    <gml:featureMember>
      <ms:modis.ba.poly.week gml:id="modis.ba.poly.week.572483">
        <gml:boundedBy>
        	<gml:Envelope srsName="EPSG:4326">
        		<gml:lowerCorner>42.859518 -9.099190</gml:lowerCorner>
        		<gml:upperCorner>42.861167 -9.097110</gml:upperCorner>
        	</gml:Envelope>
        </gml:boundedBy>
        <ms:msGeometry>
          <gml:Polygon srsName="EPSG:4326">
            <gml:exterior>
              <gml:LinearRing>
                <gml:posList srsDimension="2">42.859880 -9.099190 42.859889 -9.099183 42.859902 -9.099176 42.859918 -9.099168</gml:posList>
              </gml:LinearRing>
            </gml:exterior>
          </gml:Polygon>
        </ms:msGeometry>
        <ms:id>572483</ms:id>
        <ms:FIREDATE>2026-07-21 13:55:00</ms:FIREDATE>
        <ms:LASTUPDATE>2026-07-27 13:23:51.595525</ms:LASTUPDATE>
        <ms:COUNTRY>ES</ms:COUNTRY>
        <ms:PROVINCE>A Coruña</ms:PROVINCE>
        <ms:COMMUNE>Carnota</ms:COMMUNE>
        <ms:AREA_HA>2</ms:AREA_HA>
        <ms:BROADLEA>0</ms:BROADLEA>
        <ms:CONIFER>66.66666666444443</ms:CONIFER>
        <ms:MIXED>0</ms:MIXED>
        <ms:SCLEROPH>0</ms:SCLEROPH>
        <ms:TRANSIT>0</ms:TRANSIT>
        <ms:OTHERNATLC>0</ms:OTHERNATLC>
        <ms:AGRIAREAS>33.33333333222222</ms:AGRIAREAS>
        <ms:ARTIFSURF>0</ms:ARTIFSURF>
        <ms:OTHERLC>0</ms:OTHERLC>
        <ms:PERCNA2K>0</ms:PERCNA2K>
        <ms:CLASS>7DAYS</ms:CLASS>
      </ms:modis.ba.poly.week>
    </gml:featureMember>
`;

/** Pazos de Borben, Pontevedra — 4 ha, ~15 km from Vigo. Fractional seconds. */
const FEATURE_PAZOS = `    <gml:featureMember>
      <ms:modis.ba.poly.week gml:id="modis.ba.poly.week.572484">
        <gml:boundedBy>
        	<gml:Envelope srsName="EPSG:4326">
        		<gml:lowerCorner>42.280288 -8.555897</gml:lowerCorner>
        		<gml:upperCorner>42.282384 -8.552089</gml:upperCorner>
        	</gml:Envelope>
        </gml:boundedBy>
        <ms:msGeometry>
          <gml:Polygon srsName="EPSG:4326">
            <gml:exterior>
              <gml:LinearRing>
                <gml:posList srsDimension="2">42.282313 -8.555061 42.282265 -8.554925 42.282230 -8.554801 42.282206 -8.554689</gml:posList>
              </gml:LinearRing>
            </gml:exterior>
          </gml:Polygon>
        </ms:msGeometry>
        <ms:id>572484</ms:id>
        <ms:FIREDATE>2026-07-22 15:25:56.99</ms:FIREDATE>
        <ms:LASTUPDATE>2026-07-27 13:26:06.748009</ms:LASTUPDATE>
        <ms:COUNTRY>ES</ms:COUNTRY>
        <ms:PROVINCE>Pontevedra</ms:PROVINCE>
        <ms:COMMUNE>Pazos de Borbén</ms:COMMUNE>
        <ms:AREA_HA>4</ms:AREA_HA>
        <ms:BROADLEA>99.9999999975</ms:BROADLEA>
        <ms:CONIFER>0</ms:CONIFER>
        <ms:MIXED>0</ms:MIXED>
        <ms:SCLEROPH>0</ms:SCLEROPH>
        <ms:TRANSIT>0</ms:TRANSIT>
        <ms:OTHERNATLC>0</ms:OTHERNATLC>
        <ms:AGRIAREAS>0</ms:AGRIAREAS>
        <ms:ARTIFSURF>0</ms:ARTIFSURF>
        <ms:OTHERLC>0</ms:OTHERLC>
        <ms:PERCNA2K>0</ms:PERCNA2K>
        <ms:CLASS>7DAYS</ms:CLASS>
      </ms:modis.ba.poly.week>
    </gml:featureMember>
`;

const GML_FOOTER = '</wfs:FeatureCollection>\n';

const REAL_GML = GML_HEADER + FEATURE_PT + FEATURE_CARNOTA + FEATURE_PAZOS + GML_FOOTER;

function byId(fires: EffisFire[], id: string): EffisFire {
  const found = fires.find((f) => f.effisId === id);
  if (!found) throw new Error(`fixture event ${id} was not parsed`);
  return found;
}

// ── Tests ─────────────────────────────────────────────

describe('parseEffisGml — real EFFIS payload', () => {
  it('parses every feature of a multi-feature collection', () => {
    const fires = parseEffisGml(REAL_GML);
    expect(fires).toHaveLength(3);
    expect(fires.map((f) => f.effisId)).toEqual(['562633', '572483', '572484']);
    // The collection-level gml:boundedBy must not be mistaken for a feature.
    expect(fires.every((f) => f.lat > 41 && f.lat < 44)).toBe(true);
  });

  it('reads a complete feature field by field', () => {
    const pazos = byId(parseEffisGml(REAL_GML), '572484');

    expect(pazos.country).toBe('ES');
    expect(pazos.province).toBe('Pontevedra');
    expect(pazos.commune).toBe('Pazos de Borbén');
    expect(pazos.areaHa).toBe(4);
    expect(pazos.fireClass).toBe('7DAYS');
    expect(pazos.pctNatura).toBe(0);

    // Envelope centre, latitude-first as GML 3.1.1 / EPSG:4326 declares.
    expect(pazos.lat).toBeCloseTo((42.280288 + 42.282384) / 2, 6);
    expect(pazos.lon).toBeCloseTo((-8.555897 + -8.552089) / 2, 6);

    // Timestamps are UTC despite carrying no zone marker; a naive parse would
    // shift these by the host offset.
    expect(pazos.fireDate?.toISOString()).toBe('2026-07-22T15:25:56.990Z');
    expect(pazos.lastUpdate?.toISOString()).toBe('2026-07-27T13:26:06.748Z');
  });

  it('keeps accented place names intact and flags Galician provinces', () => {
    const fires = parseEffisGml(REAL_GML);

    const carnota = byId(fires, '572483');
    expect(carnota.province).toBe('A Coruña');
    expect(carnota.commune).toBe('Carnota');
    expect(carnota.areaHa).toBe(2);
    expect(isGalicianProvince(carnota.province)).toBe(true);

    const portugal = byId(fires, '562633');
    expect(portugal.country).toBe('PT');
    expect(isGalicianProvince(portugal.province)).toBe(false);

    expect(fires.filter((f) => isGalicianProvince(f.province))).toHaveLength(2);
  });

  it('emits null — not NaN or a bogus zero — for a missing AREA_HA', () => {
    const withoutArea = REAL_GML.replace('<ms:AREA_HA>2</ms:AREA_HA>', '');
    const carnota = byId(parseEffisGml(withoutArea), '572483');

    expect(carnota.areaHa).toBeNull();
    // The rest of the event must still land: an unknown size is not a reason
    // to drop a fire that has a place and a date.
    expect(carnota.commune).toBe('Carnota');
    expect(carnota.lat).toBeGreaterThan(42);
  });

  it('survives a malformed date without dropping the event', () => {
    const broken = REAL_GML.replace(
      '<ms:FIREDATE>2026-07-21 13:55:00</ms:FIREDATE>',
      '<ms:FIREDATE>not-a-date</ms:FIREDATE>',
    );
    const carnota = byId(parseEffisGml(broken), '572483');

    expect(carnota.fireDate).toBeNull();
    expect(carnota.lastUpdate?.toISOString()).toBe('2026-07-27T13:23:51.595Z');
    expect(carnota.commune).toBe('Carnota');
  });

  it('falls back to the polygon when a feature carries no envelope', () => {
    const noEnvelope = FEATURE_CARNOTA.replace(
      /<gml:boundedBy>[\s\S]*?<\/gml:boundedBy>/,
      '',
    );
    const fires = parseEffisGml(GML_HEADER + noEnvelope + GML_FOOTER);

    expect(fires).toHaveLength(1);
    // posList bbox centre — still inside the real burnt area.
    expect(fires[0].lat).toBeCloseTo(42.8599, 3);
    expect(fires[0].lon).toBeCloseTo(-9.0992, 3);
  });

  it('drops a feature that has no usable geometry', () => {
    const noGeometry = FEATURE_CARNOTA
      .replace(/<gml:boundedBy>[\s\S]*?<\/gml:boundedBy>/, '')
      .replace(/<ms:msGeometry>[\s\S]*?<\/ms:msGeometry>/, '');
    const fires = parseEffisGml(GML_HEADER + noGeometry + FEATURE_PAZOS + GML_FOOTER);

    // An unplaceable fire is discarded, the placeable one still gets through.
    expect(fires.map((f) => f.effisId)).toEqual(['572484']);
  });
});

describe('parseEffisGml — hostile input', () => {
  it('returns [] for an empty document', () => {
    expect(parseEffisGml('')).toEqual([]);
    expect(parseEffisGml(GML_HEADER + GML_FOOTER)).toEqual([]);
  });

  it('returns [] for an OGC exception served with HTTP 200', () => {
    const fault = `<?xml version="1.0"?><ServiceExceptionReport version="1.2.0">
      <ServiceException code="InvalidParameterValue">msWFSGetFeature(): typename</ServiceException>
    </ServiceExceptionReport>`;
    expect(parseEffisGml(fault)).toEqual([]);
  });

  it('returns [] when the response is cut mid-feature, without throwing', () => {
    const truncated = (GML_HEADER + FEATURE_CARNOTA).slice(0, GML_HEADER.length + 400);

    expect(() => parseEffisGml(truncated)).not.toThrow();
    expect(parseEffisGml(truncated)).toEqual([]);
  });

  it('keeps the complete features when only the tail is cut', () => {
    const whole = GML_HEADER + FEATURE_CARNOTA + FEATURE_PAZOS;
    const cut = whole.slice(0, whole.length - 300);

    const fires = parseEffisGml(cut);
    expect(fires.map((f) => f.effisId)).toEqual(['572483']);
  });

  it('returns [] for plain text and for HTML error pages', () => {
    expect(parseEffisGml('upstream is down')).toEqual([]);
    expect(parseEffisGml('<html><body>502 Bad Gateway</body></html>')).toEqual([]);
  });
});

describe('parseEffisTimestamp', () => {
  it('reads EFFIS timestamps as UTC', () => {
    expect(parseEffisTimestamp('2026-07-20 15:37:00')?.toISOString())
      .toBe('2026-07-20T15:37:00.000Z');
  });

  it('truncates sub-millisecond precision instead of guessing', () => {
    expect(parseEffisTimestamp('2026-07-23 09:22:20.067977')?.toISOString())
      .toBe('2026-07-23T09:22:20.067Z');
    // Two fractional digits are hundredths, so 0.99 s is 990 ms.
    expect(parseEffisTimestamp('2026-07-22 15:25:56.99')?.toISOString())
      .toBe('2026-07-22T15:25:56.990Z');
  });

  it('returns null for anything it cannot read', () => {
    expect(parseEffisTimestamp(null)).toBeNull();
    expect(parseEffisTimestamp('')).toBeNull();
    expect(parseEffisTimestamp('not-a-date')).toBeNull();
    expect(parseEffisTimestamp('2026-13-45 99:99:99')).toBeNull();
  });
});

describe('province matching', () => {
  it('matches the four Galician provinces regardless of accent or case', () => {
    for (const name of ['A Coruña', 'a coruna', 'LA CORUÑA', 'Lugo', 'Ourense', 'Orense', 'Pontevedra']) {
      expect(isGalicianProvince(name)).toBe(true);
    }
  });

  it('rejects everything else', () => {
    for (const name of ['León', 'Zamora', 'Alto Minho', 'Asturias', '', null, undefined]) {
      expect(isGalicianProvince(name)).toBe(false);
    }
  });

  it('normalizes to a comparable key', () => {
    expect(normalizeProvince('  A Coruña ')).toBe('a coruna');
    expect(normalizeProvince(null)).toBe('');
  });
});

describe('runEffisCycle', () => {
  // Shape only: the cycle writes through getPool(), and there is no DB here.
  it('is an async entry point', () => {
    expect(typeof runEffisCycle).toBe('function');
    expect(runEffisCycle.constructor.name).toBe('AsyncFunction');
  });
});

describe('EFFIS_ATTRIBUTION', () => {
  it('names the European Union and the licence, as CC BY 4.0 requires', () => {
    expect(EFFIS_ATTRIBUTION).toContain('EFFIS');
    expect(EFFIS_ATTRIBUTION).toContain('Unión Europea');
    expect(EFFIS_ATTRIBUTION).toContain('CC BY 4.0');
  });
});
