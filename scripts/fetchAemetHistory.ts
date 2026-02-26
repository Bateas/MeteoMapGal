/**
 * fetchAemetHistory.ts
 *
 * Fetches daily climatological data from AEMET OpenData API for local stations
 * near Embalse de Castrelo / Ribadavia area.
 *
 * Key fields from AEMET daily data:
 *   - dir:        dominant wind direction (decadegrees: 01=N, 09=E, 18=S, 27=W, 36=N, 99=variable)
 *   - velmedia:   mean wind speed (m/s)
 *   - racha:      max gust speed (m/s)
 *   - horaracha:  time of max gust (HH:MM)
 *   - tmed/tmax/tmin: temperatures (°C)
 *   - horatmax:   time of max temperature (HH:MM)
 *   - hrMedia/hrMax/hrMin: humidity (%)
 *   - prec:       precipitation (mm)
 *
 * Usage: npx tsx scripts/fetchAemetHistory.ts
 */

import { writeFileSync, existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
dotenv.config({ path: join(__dirname, '..', '.env') });

const API_KEY = process.env.VITE_AEMET_API_KEY;
if (!API_KEY) {
  console.error('Missing VITE_AEMET_API_KEY in .env');
  process.exit(1);
}

const BASE_URL = 'https://opendata.aemet.es/opendata';

// Stations near Embalse de Castrelo / Ribadavia
const STATIONS = [
  { id: '1701X', name: 'Ribadavia' },
  { id: '1690A', name: 'Ourense' },
  { id: '1700X', name: 'O Carballiño' },
  { id: '1690B', name: 'Ourense Instituto' },
];

// Summer months (thermal wind season) - fetch June through September
const YEARS = [2022, 2023, 2024, 2025];
const SUMMER_RANGES = YEARS.flatMap(year => [
  { start: `${year}-06-01`, end: `${year}-06-10` },
  { start: `${year}-06-11`, end: `${year}-06-20` },
  { start: `${year}-06-21`, end: `${year}-06-30` },
  { start: `${year}-07-01`, end: `${year}-07-10` },
  { start: `${year}-07-11`, end: `${year}-07-20` },
  { start: `${year}-07-21`, end: `${year}-07-31` },
  { start: `${year}-08-01`, end: `${year}-08-10` },
  { start: `${year}-08-11`, end: `${year}-08-20` },
  { start: `${year}-08-21`, end: `${year}-08-31` },
  { start: `${year}-09-01`, end: `${year}-09-10` },
  { start: `${year}-09-11`, end: `${year}-09-20` },
  { start: `${year}-09-21`, end: `${year}-09-30` },
]);

interface AemetDailyRecord {
  fecha: string;
  indicativo: string;
  nombre: string;
  provincia: string;
  altitud: string;
  dir: string;         // dominant wind direction in decadegrees
  velmedia: string;    // mean wind speed
  racha: string;       // max gust
  horaracha: string;   // time of max gust
  tmed: string;        // mean temperature
  tmax: string;        // max temperature
  horatmax: string;    // time of max temperature
  tmin: string;        // min temperature
  hrMedia: string;     // mean humidity
  hrMax: string;       // max humidity
  hrMin: string;       // min humidity
  prec: string;        // precipitation
  [key: string]: string;
}

function parseSpanishFloat(s: string | undefined): number | null {
  if (!s || s === 'Ip' || s === 'Acum') return null;
  return parseFloat(s.replace(',', '.'));
}

/** Parse AEMET direction (decadegrees) → degrees
 *  01=N(360°), 09=E(90°), 18=S(180°), 27=W(270°), 36=N(360°), 99=variable
 */
function decadegreesToDeg(dir: string | undefined): number | null {
  if (!dir || dir === '99') return null; // variable wind
  const d = parseInt(dir, 10);
  if (isNaN(d) || d < 1 || d > 36) return null;
  return d * 10; // 01→10°, 09→90°, 18→180°, 27→270°, 36→360°
}

function parseTime(timeStr: string | undefined): number | null {
  if (!timeStr || timeStr === 'Varias') return null;
  const match = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return parseInt(match[1], 10) + parseInt(match[2], 10) / 60;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, retries = 3): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        console.log('  Rate limited, waiting 60s...');
        await sleep(60000);
        continue;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res.json();
    } catch (e: any) {
      if (i < retries - 1) {
        console.log(`  Retry ${i + 1}: ${e.message}`);
        await sleep(2000);
      } else {
        throw e;
      }
    }
  }
}

async function fetchDailyData(stationId: string, startDate: string, endDate: string): Promise<AemetDailyRecord[]> {
  const startISO = `${startDate}T00%3A00%3A00UTC`;
  const endISO = `${endDate}T23%3A59%3A59UTC`;
  const url = `${BASE_URL}/api/valores/climatologicos/diarios/datos/fechaini/${startISO}/fechafin/${endISO}/estacion/${stationId}?api_key=${API_KEY}`;

  try {
    const meta = await fetchWithRetry(url);
    if (meta.estado !== 200 || !meta.datos) {
      if (meta.estado === 404) {
        // No data for this range
        return [];
      }
      console.log(`  Warning: ${meta.descripcion} (${meta.estado})`);
      return [];
    }

    // Step 2: fetch actual data
    const data = await fetchWithRetry(meta.datos);
    return Array.isArray(data) ? data : [];
  } catch (e: any) {
    console.log(`  Error fetching ${stationId} ${startDate}-${endDate}: ${e.message}`);
    return [];
  }
}

async function main() {
  const outputFile = join(__dirname, '..', 'src', 'config', 'aemetDailyHistory.json');

  // Check if we already have cached data
  let existingData: AemetDailyRecord[] = [];
  if (existsSync(outputFile)) {
    try {
      existingData = JSON.parse(readFileSync(outputFile, 'utf-8')).records || [];
      console.log(`Found ${existingData.length} existing records in cache`);
    } catch {
      existingData = [];
    }
  }

  const existingKeys = new Set(
    existingData.map(r => `${r.indicativo}_${r.fecha}`)
  );

  console.log('=== AEMET Daily Climatological Data Fetcher ===\n');
  console.log(`Stations: ${STATIONS.map(s => `${s.id} (${s.name})`).join(', ')}`);
  console.log(`Date ranges: ${SUMMER_RANGES.length} chunks (${YEARS.join(', ')}) x ${STATIONS.length} stations`);
  console.log(`Total requests needed: ~${SUMMER_RANGES.length * STATIONS.length * 2} (2-step API)\n`);

  const allRecords: AemetDailyRecord[] = [...existingData];
  let newRecords = 0;
  let requestCount = 0;

  for (const station of STATIONS) {
    console.log(`\n--- ${station.name} (${station.id}) ---`);

    for (const range of SUMMER_RANGES) {
      // Check if we already have data for this range
      const rangeStart = new Date(range.start);
      const rangeEnd = new Date(range.end);
      const daysInRange = Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / 86400000) + 1;

      let existingInRange = 0;
      for (let d = 0; d < daysInRange; d++) {
        const dt = new Date(rangeStart);
        dt.setDate(dt.getDate() + d);
        const key = `${station.id}_${dt.toISOString().slice(0, 10)}`;
        if (existingKeys.has(key)) existingInRange++;
      }

      if (existingInRange >= daysInRange - 1) {
        // Already have most data for this range
        continue;
      }

      process.stdout.write(`  ${range.start} → ${range.end}...`);

      const data = await fetchDailyData(station.id, range.start, range.end);
      requestCount += 2; // 2-step API

      let added = 0;
      for (const record of data) {
        const key = `${record.indicativo}_${record.fecha}`;
        if (!existingKeys.has(key)) {
          allRecords.push(record);
          existingKeys.add(key);
          added++;
          newRecords++;
        }
      }

      console.log(` ${data.length} records (${added} new)`);

      // Rate limiting: max 50 req/min → wait 2.5s between requests
      await sleep(2500);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total records: ${allRecords.length} (${newRecords} new)`);
  console.log(`API requests made: ${requestCount}`);

  // Save raw data
  writeFileSync(outputFile, JSON.stringify({
    version: 1,
    fetchedAt: new Date().toISOString(),
    stations: STATIONS,
    totalRecords: allRecords.length,
    records: allRecords,
  }, null, 2));
  console.log(`Saved to ${outputFile}`);

  // Quick analysis
  console.log('\n=== Quick Thermal Pattern Analysis ===\n');

  for (const station of STATIONS) {
    const stationData = allRecords.filter(r => r.indicativo === station.id);
    if (stationData.length === 0) {
      console.log(`${station.name}: No data`);
      continue;
    }

    console.log(`\n--- ${station.name} (${stationData.length} days) ---`);

    // Filter for potential thermal days:
    // - Wind direction W or SW (dir 24-30 = 240°-300°)
    // - Gust in afternoon (14-18h)
    // - Temperature > 25°C
    // - Low/no precipitation
    let thermalDays = 0;
    let totalSummerDays = 0;
    const gustTimeByDir: Record<string, number[]> = {};

    for (const r of stationData) {
      const dir = decadegreesToDeg(r.dir);
      const velmedia = parseSpanishFloat(r.velmedia);
      const racha = parseSpanishFloat(r.racha);
      const gustTime = parseTime(r.horaracha);
      const tmax = parseSpanishFloat(r.tmax);
      const tmaxTime = parseTime(r.horatmax);
      const hrMedia = parseSpanishFloat(r.hrMedia);
      const prec = parseSpanishFloat(r.prec);

      totalSummerDays++;

      // Classify direction
      let dirLabel = 'calm';
      if (dir !== null) {
        if (dir >= 350 || dir <= 10) dirLabel = 'N';
        else if (dir > 10 && dir <= 80) dirLabel = 'NE';
        else if (dir > 80 && dir <= 100) dirLabel = 'E';
        else if (dir > 100 && dir <= 170) dirLabel = 'SE';
        else if (dir > 170 && dir <= 190) dirLabel = 'S';
        else if (dir > 190 && dir <= 260) dirLabel = 'SW';
        else if (dir > 260 && dir <= 280) dirLabel = 'W';
        else if (dir > 280 && dir <= 350) dirLabel = 'NW';
      }

      if (gustTime !== null) {
        if (!gustTimeByDir[dirLabel]) gustTimeByDir[dirLabel] = [];
        gustTimeByDir[dirLabel].push(gustTime);
      }

      // Thermal day criteria:
      const isWesterly = dir !== null && dir >= 200 && dir <= 300; // SW-W-NW
      const isAfternoonGust = gustTime !== null && gustTime >= 13 && gustTime <= 19;
      const isWarm = tmax !== null && tmax >= 25;
      const isDry = prec === null || prec <= 0.5;
      const goodHumidity = hrMedia !== null && hrMedia >= 40 && hrMedia <= 80;

      if (isWesterly && isAfternoonGust && isWarm && isDry) {
        thermalDays++;
      }
    }

    console.log(`Summer days: ${totalSummerDays}`);
    console.log(`Thermal days (W/SW + afternoon gust + T>25 + dry): ${thermalDays} (${(thermalDays / totalSummerDays * 100).toFixed(1)}%)`);

    // Show gust time distribution by direction
    console.log('\nGust time by wind direction:');
    for (const [dir, times] of Object.entries(gustTimeByDir).sort((a, b) => b[1].length - a[1].length)) {
      const avgTime = times.reduce((s, t) => s + t, 0) / times.length;
      const afternoonPct = times.filter(t => t >= 13 && t <= 19).length / times.length * 100;
      console.log(`  ${dir.padEnd(4)}: ${times.length} days, avg gust at ${avgTime.toFixed(1)}h, afternoon ${afternoonPct.toFixed(0)}%`);
    }
  }
}

main().catch(console.error);
