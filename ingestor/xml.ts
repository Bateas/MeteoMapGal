/**
 * Server-side Meteoclimatic XML parser.
 * Replaces browser DOMParser with regex-based extraction.
 * The XML structure is simple and stable — no need for a full XML library.
 */

import type { MeteoclimaticRawStation } from '../src/types/meteoclimatic.js';

/** HTML entity decoding (Meteoclimatic uses these in station names) */
const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
  '&ntilde;': 'ñ', '&Ntilde;': 'Ñ',
  '&aacute;': 'á', '&eacute;': 'é', '&iacute;': 'í', '&oacute;': 'ó', '&uacute;': 'ú',
  '&Aacute;': 'Á', '&Eacute;': 'É', '&Iacute;': 'Í', '&Oacute;': 'Ó', '&Uacute;': 'Ú',
  '&uuml;': 'ü', '&Uuml;': 'Ü',
};

function decodeEntities(text: string): string {
  return text.replace(/&[a-zA-Z]+;/g, (match) => ENTITIES[match] ?? match);
}

/** Extract text content of an XML tag */
function tag(xml: string, name: string): string | null {
  const re = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`);
  const m = xml.match(re);
  return m ? decodeEntities(m[1].trim()) : null;
}

/** Extract numeric value from tag, null if missing or NaN */
function num(xml: string, name: string): number | null {
  const v = tag(xml, name);
  if (v === null || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

/**
 * Parse Meteoclimatic XML feed into raw station data.
 * Expected structure per station:
 * ```xml
 * <station>
 *   <id>ESGAL3200000032003A</id>
 *   <location>Ourense - Centro</location>
 *   <pubDate>Wed, 05 Mar 2026 14:32:08 +0000</pubDate>
 *   <QOS>3</QOS>
 *   <stationdata>
 *     <temperature><now>18.5</now></temperature>
 *     <humidity><now>65</now></humidity>
 *     <barometre><now>1013.2</now></barometre>
 *     <wind><now>3.5</now><azimuth>180</azimuth><max>5.2</max></wind>
 *     <rain><total>0.2</total></rain>
 *   </stationdata>
 * </station>
 * ```
 */
export function parseMeteoclimaticXml(xml: string): MeteoclimaticRawStation[] {
  const stations: MeteoclimaticRawStation[] = [];

  // Split by <station> blocks
  const blocks = xml.split('<station>').slice(1); // skip before first <station>

  for (const block of blocks) {
    const stationXml = block.split('</station>')[0];
    if (!stationXml) continue;

    const id = tag(stationXml, 'id');
    const location = tag(stationXml, 'location');
    const pubDate = tag(stationXml, 'pubDate');

    if (!id || !location || !pubDate) continue;

    // Extract stationdata block
    const dataBlock = tag(stationXml, 'stationdata') ?? stationXml;

    // Temperature
    const tempBlock = tag(dataBlock, 'temperature') ?? '';
    const temperature = num(tempBlock, 'now');

    // Humidity
    const humBlock = tag(dataBlock, 'humidity') ?? '';
    const humidity = num(humBlock, 'now');

    // Pressure
    const baroBlock = tag(dataBlock, 'barometre') ?? '';
    const pressure = num(baroBlock, 'now');

    // Wind
    const windBlock = tag(dataBlock, 'wind') ?? '';
    const windSpeed = num(windBlock, 'now');
    const windAzimuth = num(windBlock, 'azimuth');
    const windGust = num(windBlock, 'max');

    // Rain
    const rainBlock = tag(dataBlock, 'rain') ?? '';
    const rain = num(rainBlock, 'total');

    const qos = num(stationXml, 'QOS') ?? 0;

    stations.push({
      id,
      location,
      pubDate,
      qos,
      temperature,
      humidity,
      pressure,
      windSpeed,       // km/h (normalizer converts to m/s)
      windAzimuth,
      windGust,        // km/h
      rain,
    });
  }

  return stations;
}
