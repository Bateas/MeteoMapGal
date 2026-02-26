/**
 * analyzeOpenMeteoArchive.ts
 *
 * Fetches historical hourly data from Open-Meteo Archive API for multiple
 * strategic points around Embalse de Castrelo de Miño, then analyzes
 * thermal wind patterns comparable to our AEMET station findings.
 *
 * Points include:
 *   - Embalse de Castrelo (110m) — our target sailing area
 *   - Ribadavia (105m) — AEMET reference station location
 *   - San Amaro / Anllo (400m) — Meteoclimatic station, uphill NE
 *   - O Carballiño (420m) — AEMET station, meseta west
 *   - Ourense city (140m) — AEMET station, urban valley
 *   - A Notaría / Padrenda (218m) — Meteoclimatic station, south
 *   - Montaña Norte (630m) — highland reference
 *
 * Compares with AEMET findings: SW dominant, HR 45-65%, ΔT>20°C = 42%
 *
 * Usage: npx tsx scripts/analyzeOpenMeteoArchive.ts
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Strategic points ────────────────────────────────────────

interface LocationPoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  altitude: number;
  type: 'valley' | 'hill' | 'mountain' | 'urban';
}

const POINTS: LocationPoint[] = [
  { id: 'embalse',    name: 'Embalse Castrelo',  lat: 42.295, lon: -8.115, altitude: 110, type: 'valley' },
  { id: 'ribadavia',  name: 'Ribadavia',         lat: 42.286, lon: -8.143, altitude: 105, type: 'valley' },
  { id: 'san_amaro',  name: 'San Amaro-Anllo',   lat: 42.383, lon: -8.083, altitude: 400, type: 'hill' },
  { id: 'carballino', name: 'O Carballiño',       lat: 42.417, lon: -8.067, altitude: 420, type: 'hill' },
  { id: 'ourense',    name: 'Ourense',            lat: 42.335, lon: -7.865, altitude: 140, type: 'urban' },
  { id: 'padrenda',   name: 'A Notaría-Padrenda', lat: 42.133, lon: -8.183, altitude: 218, type: 'valley' },
  { id: 'norte',      name: 'Montaña Norte',      lat: 42.420, lon: -8.300, altitude: 630, type: 'mountain' },
];

// ── Date range: Jun-Sep 2019-2025 (7 summers) ──────────────

const YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
const SUMMER_START = '06-01';
const SUMMER_END = '09-30';

// ── Types ───────────────────────────────────────────────────

interface HourlyData {
  time: string[];
  temperature_2m: number[];
  relative_humidity_2m: number[];
  wind_speed_10m: number[];
  wind_direction_10m: number[];
  wind_gusts_10m: number[];
}

interface DayAnalysis {
  date: string;
  tmax: number;
  tmin: number;
  deltaT: number;
  hrMean: number;
  hrMin: number;
  // Afternoon (13-19h) wind analysis
  pmWindDir: number | null;    // dominant direction
  pmWindSpeed: number;         // mean speed
  pmMaxGust: number;           // max gust
  pmGustHour: number;          // hour of max gust
  // Morning (06-12h) wind
  amWindDir: number | null;
  amWindSpeed: number;
  // Is thermal candidate?
  isThermal: boolean;
  thermalDir: string;
}

// ── Utilities ───────────────────────────────────────────────

function degToCardinal(deg: number): string {
  if (deg >= 337.5 || deg < 22.5) return 'N';
  if (deg < 67.5) return 'NE';
  if (deg < 112.5) return 'E';
  if (deg < 157.5) return 'SE';
  if (deg < 202.5) return 'S';
  if (deg < 247.5) return 'SW';
  if (deg < 292.5) return 'W';
  return 'NW';
}

/** Circular mean of wind directions (degrees) */
function circularMeanDir(directions: number[], speeds: number[]): number | null {
  if (directions.length === 0) return null;
  let sinSum = 0, cosSum = 0;
  for (let i = 0; i < directions.length; i++) {
    const weight = speeds[i] || 1;
    const rad = (directions[i] * Math.PI) / 180;
    sinSum += Math.sin(rad) * weight;
    cosSum += Math.cos(rad) * weight;
  }
  let mean = (Math.atan2(sinSum, cosSum) * 180) / Math.PI;
  if (mean < 0) mean += 360;
  return mean;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Open-Meteo Archive fetch ────────────────────────────────

async function fetchArchive(point: LocationPoint, startDate: string, endDate: string): Promise<HourlyData | null> {
  const url = `https://archive-api.open-meteo.com/v1/archive` +
    `?latitude=${point.lat}&longitude=${point.lon}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
    `&wind_speed_unit=ms&timezone=Europe%2FMadrid`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`  HTTP ${res.status} for ${point.id} ${startDate}`);
      return null;
    }
    const json = await res.json();
    return json.hourly || null;
  } catch (e: any) {
    console.error(`  Error: ${e.message}`);
    return null;
  }
}

// ── Day analysis ────────────────────────────────────────────

function analyzeDay(hourly: HourlyData, dayIndex: number): DayAnalysis | null {
  const baseIdx = dayIndex * 24;
  if (baseIdx + 23 >= hourly.time.length) return null;

  const date = hourly.time[baseIdx].split('T')[0];

  // Full day temp/humidity
  let tmax = -999, tmin = 999;
  let hrSum = 0, hrMin = 999, hrCount = 0;

  for (let h = 0; h < 24; h++) {
    const i = baseIdx + h;
    const t = hourly.temperature_2m[i];
    const hr = hourly.relative_humidity_2m[i];
    if (t != null) {
      if (t > tmax) tmax = t;
      if (t < tmin) tmin = t;
    }
    if (hr != null) {
      hrSum += hr;
      hrCount++;
      if (hr < hrMin) hrMin = hr;
    }
  }

  if (tmax === -999 || tmin === 999) return null;
  const deltaT = tmax - tmin;
  const hrMean = hrCount > 0 ? hrSum / hrCount : 50;

  // Afternoon wind (13-19h local)
  const pmDirs: number[] = [];
  const pmSpeeds: number[] = [];
  let pmMaxGust = 0, pmGustHour = 15;

  for (let h = 13; h <= 19; h++) {
    const i = baseIdx + h;
    const speed = hourly.wind_speed_10m[i];
    const dir = hourly.wind_direction_10m[i];
    const gust = hourly.wind_gusts_10m[i];

    if (speed != null && speed >= 1 && dir != null) {
      pmDirs.push(dir);
      pmSpeeds.push(speed);
    }
    if (gust != null && gust > pmMaxGust) {
      pmMaxGust = gust;
      pmGustHour = h;
    }
  }

  const pmWindDir = circularMeanDir(pmDirs, pmSpeeds);
  const pmWindSpeed = pmSpeeds.length > 0
    ? pmSpeeds.reduce((a, b) => a + b, 0) / pmSpeeds.length
    : 0;

  // Morning wind (06-12h)
  const amDirs: number[] = [];
  const amSpeeds: number[] = [];

  for (let h = 6; h <= 12; h++) {
    const i = baseIdx + h;
    const speed = hourly.wind_speed_10m[i];
    const dir = hourly.wind_direction_10m[i];
    if (speed != null && speed >= 1 && dir != null) {
      amDirs.push(dir);
      amSpeeds.push(speed);
    }
  }

  const amWindDir = circularMeanDir(amDirs, amSpeeds);
  const amWindSpeed = amSpeeds.length > 0
    ? amSpeeds.reduce((a, b) => a + b, 0) / amSpeeds.length
    : 0;

  // Thermal candidate: T>25, HR<85, afternoon gust>5 m/s, direction W-SW-S (180-300°)
  const isWesterly = pmWindDir !== null && pmWindDir >= 180 && pmWindDir <= 310;
  const isWarm = tmax >= 25;
  const hasGust = pmMaxGust >= 5;
  const notTooHumid = hrMean < 85;
  const isThermal = isWesterly && isWarm && hasGust && notTooHumid;

  const thermalDir = pmWindDir !== null ? degToCardinal(pmWindDir) : 'calm';

  return {
    date, tmax, tmin, deltaT, hrMean, hrMin,
    pmWindDir, pmWindSpeed, pmMaxGust, pmGustHour,
    amWindDir, amWindSpeed,
    isThermal, thermalDir,
  };
}

// ── Main analysis ───────────────────────────────────────────

async function main() {
  console.log('=== Open-Meteo Archive: Multi-Point Thermal Analysis ===');
  console.log(`Points: ${POINTS.map(p => `${p.name} (${p.altitude}m)`).join(', ')}`);
  console.log(`Years: ${YEARS.join(', ')} (Jun-Sep)\n`);

  const allResults: Map<string, DayAnalysis[]> = new Map();

  for (const point of POINTS) {
    console.log(`\n--- Fetching ${point.name} (${point.lat}, ${point.lon}, ${point.altitude}m) ---`);
    const days: DayAnalysis[] = [];

    for (const year of YEARS) {
      const startDate = `${year}-${SUMMER_START}`;
      const endDate = `${year}-${SUMMER_END}`;

      // Open-Meteo Archive allows fetching whole summer at once
      process.stdout.write(`  ${year}...`);
      const hourly = await fetchArchive(point, startDate, endDate);

      if (!hourly || !hourly.time || hourly.time.length === 0) {
        console.log(' no data');
        continue;
      }

      const totalDays = Math.floor(hourly.time.length / 24);
      let thermalCount = 0;

      for (let d = 0; d < totalDays; d++) {
        const day = analyzeDay(hourly, d);
        if (day) {
          days.push(day);
          if (day.isThermal) thermalCount++;
        }
      }

      console.log(` ${totalDays} days, ${thermalCount} thermal`);
      await sleep(500); // Rate limiting
    }

    allResults.set(point.id, days);
  }

  // ── Analysis output ─────────────────────────────────────

  console.log('\n\n' + '='.repeat(70));
  console.log('  THERMAL PROBABILITY ANALYSIS — ALL POINTS');
  console.log('='.repeat(70));

  for (const point of POINTS) {
    const days = allResults.get(point.id) || [];
    if (days.length === 0) continue;

    const thermalDays = days.filter(d => d.isThermal);

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`  ${point.name} (${point.altitude}m, ${point.type}) — ${days.length} days`);
    console.log(`${'─'.repeat(60)}`);

    // By month
    console.log('\n  BY MONTH:');
    for (const m of [6, 7, 8, 9]) {
      const monthName = ['Jun', 'Jul', 'Ago', 'Sep'][m - 6];
      const monthDays = days.filter(d => parseInt(d.date.split('-')[1]) === m);
      const monthThermal = monthDays.filter(d => d.isThermal);
      const avgGust = monthThermal.length > 0
        ? monthThermal.reduce((s, d) => s + d.pmMaxGust, 0) / monthThermal.length
        : 0;
      const avgHour = monthThermal.length > 0
        ? monthThermal.reduce((s, d) => s + d.pmGustHour, 0) / monthThermal.length
        : 0;
      console.log(`    ${monthName}: ${monthThermal.length}/${monthDays.length} (${(monthThermal.length / monthDays.length * 100).toFixed(1)}%) | racha ${avgGust.toFixed(1)} m/s a las ${avgHour.toFixed(1)}h`);
    }

    // By humidity
    console.log('\n  BY HUMIDITY:');
    const hrBuckets = [
      { label: 'HR <45%',   min: 0, max: 45 },
      { label: 'HR 45-55%', min: 45, max: 55 },
      { label: 'HR 55-65%', min: 55, max: 65 },
      { label: 'HR 65-75%', min: 65, max: 75 },
      { label: 'HR 75-85%', min: 75, max: 85 },
      { label: 'HR >85%',   min: 85, max: 200 },
    ];
    for (const bucket of hrBuckets) {
      const inBucket = days.filter(d => d.hrMean >= bucket.min && d.hrMean < bucket.max);
      const thermal = inBucket.filter(d => d.isThermal);
      const pct = inBucket.length > 0 ? (thermal.length / inBucket.length * 100).toFixed(1) : '0.0';
      // Direction distribution
      const dirCounts: Record<string, number> = {};
      for (const d of thermal) {
        dirCounts[d.thermalDir] = (dirCounts[d.thermalDir] || 0) + 1;
      }
      const topDirs = Object.entries(dirCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([d, n]) => `${d}(${n})`)
        .join(', ');
      console.log(`    ${bucket.label.padEnd(12)}: ${thermal.length}/${inBucket.length} (${pct.padStart(5)}%) | ${topDirs}`);
    }

    // By temperature
    console.log('\n  BY MAX TEMPERATURE:');
    const tBuckets = [
      { label: 'T <25°C',   min: -10, max: 25 },
      { label: 'T 25-28°C', min: 25, max: 28 },
      { label: 'T 28-32°C', min: 28, max: 32 },
      { label: 'T 32-36°C', min: 32, max: 36 },
      { label: 'T >36°C',   min: 36, max: 60 },
    ];
    for (const bucket of tBuckets) {
      const inBucket = days.filter(d => d.tmax >= bucket.min && d.tmax < bucket.max);
      const thermal = inBucket.filter(d => d.isThermal);
      const pct = inBucket.length > 0 ? (thermal.length / inBucket.length * 100).toFixed(1) : '0.0';
      const avgGust = thermal.length > 0
        ? thermal.reduce((s, d) => s + d.pmMaxGust, 0) / thermal.length
        : 0;
      console.log(`    ${bucket.label.padEnd(12)}: ${thermal.length}/${inBucket.length} (${pct.padStart(5)}%) | racha ${avgGust.toFixed(1)} m/s`);
    }

    // By ΔT
    console.log('\n  BY ΔT (diurnal range):');
    const dtBuckets = [
      { label: 'ΔT <8°C',    min: 0, max: 8 },
      { label: 'ΔT 8-12°C',  min: 8, max: 12 },
      { label: 'ΔT 12-16°C', min: 12, max: 16 },
      { label: 'ΔT 16-20°C', min: 16, max: 20 },
      { label: 'ΔT >20°C',   min: 20, max: 50 },
    ];
    for (const bucket of dtBuckets) {
      const inBucket = days.filter(d => d.deltaT >= bucket.min && d.deltaT < bucket.max);
      const thermal = inBucket.filter(d => d.isThermal);
      const pct = inBucket.length > 0 ? (thermal.length / inBucket.length * 100).toFixed(1) : '0.0';
      console.log(`    ${bucket.label.padEnd(14)}: ${thermal.length}/${inBucket.length} (${pct.padStart(5)}%)`);
    }

    // Wind direction distribution on thermal days
    console.log('\n  WIND DIRECTION (thermal days):');
    const dirCounts: Record<string, number> = {};
    for (const d of thermalDays) {
      dirCounts[d.thermalDir] = (dirCounts[d.thermalDir] || 0) + 1;
    }
    for (const [dir, count] of Object.entries(dirCounts).sort((a, b) => b[1] - a[1])) {
      const pct = (count / thermalDays.length * 100).toFixed(0);
      const bar = '█'.repeat(Math.round(count / thermalDays.length * 30));
      console.log(`    ${dir.padEnd(4)}: ${String(count).padStart(3)} (${pct.padStart(2)}%) ${bar}`);
    }

    // Gust strength
    console.log('\n  GUST STRENGTH (thermal days):');
    const gustBuckets = [
      { label: '<5 m/s (10kt)',     min: 0, max: 5 },
      { label: '5-8 m/s (10-16kt)', min: 5, max: 8 },
      { label: '8-11 m/s (16-21kt)',min: 8, max: 11 },
      { label: '11-14 m/s (21-27kt)',min: 11, max: 14 },
      { label: '>14 m/s (27+kt)',   min: 14, max: 100 },
    ];
    for (const bucket of gustBuckets) {
      const inBucket = thermalDays.filter(d => d.pmMaxGust >= bucket.min && d.pmMaxGust < bucket.max);
      const pct = thermalDays.length > 0 ? (inBucket.length / thermalDays.length * 100).toFixed(0) : '0';
      const bar = '█'.repeat(Math.round(inBucket.length / Math.max(thermalDays.length, 1) * 30));
      console.log(`    ${bucket.label.padEnd(24)}: ${String(inBucket.length).padStart(3)} (${pct.padStart(2)}%) ${bar}`);
    }

    // Morning vs Afternoon wind rotation
    console.log('\n  MORNING→AFTERNOON WIND ROTATION (thermal days):');
    let rotationCW = 0, rotationCCW = 0, rotationSmall = 0;
    for (const d of thermalDays) {
      if (d.amWindDir === null || d.pmWindDir === null) continue;
      let diff = d.pmWindDir - d.amWindDir;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      if (Math.abs(diff) < 30) rotationSmall++;
      else if (diff > 0) rotationCW++;
      else rotationCCW++;
    }
    const rotTotal = rotationCW + rotationCCW + rotationSmall;
    if (rotTotal > 0) {
      console.log(`    Clockwise (veering):     ${rotationCW} (${(rotationCW / rotTotal * 100).toFixed(0)}%)`);
      console.log(`    Counter-CW (backing):    ${rotationCCW} (${(rotationCCW / rotTotal * 100).toFixed(0)}%)`);
      console.log(`    Stable (<30° change):    ${rotationSmall} (${(rotationSmall / rotTotal * 100).toFixed(0)}%)`);
    }
  }

  // ── Cross-point comparison ──────────────────────────────

  console.log('\n\n' + '='.repeat(70));
  console.log('  CROSS-POINT COMPARISON');
  console.log('='.repeat(70));

  // Summary table
  console.log('\n  THERMAL PROBABILITY SUMMARY:');
  console.log('  ' + 'Location'.padEnd(22) + 'Alt'.padStart(5) + '  Total'.padStart(7) + ' Therm'.padStart(6) + '    %'.padStart(7) + '  Top Dir'.padStart(10) + '  Avg Gust'.padStart(10));
  console.log('  ' + '─'.repeat(67));

  for (const point of POINTS) {
    const days = allResults.get(point.id) || [];
    const thermal = days.filter(d => d.isThermal);
    const pct = days.length > 0 ? (thermal.length / days.length * 100).toFixed(1) : '0';

    // Top direction
    const dirCounts: Record<string, number> = {};
    for (const d of thermal) {
      dirCounts[d.thermalDir] = (dirCounts[d.thermalDir] || 0) + 1;
    }
    const topDir = Object.entries(dirCounts).sort((a, b) => b[1] - a[1])[0];
    const topDirStr = topDir ? `${topDir[0]} ${(topDir[1] / thermal.length * 100).toFixed(0)}%` : '-';

    const avgGust = thermal.length > 0
      ? (thermal.reduce((s, d) => s + d.pmMaxGust, 0) / thermal.length).toFixed(1)
      : '-';

    console.log(`  ${point.name.padEnd(22)} ${String(point.altitude + 'm').padStart(5)}  ${String(days.length).padStart(5)}  ${String(thermal.length).padStart(5)}  ${(pct + '%').padStart(6)}  ${topDirStr.padStart(9)}  ${(avgGust + ' m/s').padStart(9)}`);
  }

  // Same-day cross analysis: when embalse is thermal, what happens at each point?
  console.log('\n  WHEN EMBALSE IS THERMAL → OTHER POINTS:');
  const embalseDays = allResults.get('embalse') || [];
  const embalseThermalDates = new Set(embalseDays.filter(d => d.isThermal).map(d => d.date));

  for (const point of POINTS) {
    if (point.id === 'embalse') continue;
    const days = allResults.get(point.id) || [];

    let alsoThermal = 0;
    let totalMatched = 0;
    const dirOnThermalDay: Record<string, number> = {};

    for (const d of days) {
      if (embalseThermalDates.has(d.date)) {
        totalMatched++;
        if (d.isThermal) alsoThermal++;
        if (d.pmWindDir !== null) {
          const dir = degToCardinal(d.pmWindDir);
          dirOnThermalDay[dir] = (dirOnThermalDay[dir] || 0) + 1;
        }
      }
    }

    const pct = totalMatched > 0 ? (alsoThermal / totalMatched * 100).toFixed(0) : '0';
    const topDirs = Object.entries(dirOnThermalDay)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([d, n]) => `${d}(${n})`)
      .join(', ');

    console.log(`    ${point.name.padEnd(22)}: ${alsoThermal}/${totalMatched} also thermal (${pct}%) | PM dirs: ${topDirs}`);
  }

  // Altitude gradient analysis
  console.log('\n  ALTITUDE GRADIENT (thermal probability by altitude):');
  const sortedByAlt = [...POINTS].sort((a, b) => a.altitude - b.altitude);
  for (const point of sortedByAlt) {
    const days = allResults.get(point.id) || [];
    const thermal = days.filter(d => d.isThermal);
    const pct = days.length > 0 ? (thermal.length / days.length * 100).toFixed(1) : '0';
    const bar = '█'.repeat(Math.round(parseFloat(pct) / 2));
    console.log(`    ${String(point.altitude + 'm').padStart(5)} ${point.name.padEnd(22)} ${(pct + '%').padStart(6)} ${bar}`);
  }

  // ── Save results ────────────────────────────────────────

  const outputData: Record<string, any> = {};
  for (const point of POINTS) {
    const days = allResults.get(point.id) || [];
    const thermal = days.filter(d => d.isThermal);

    // Monthly breakdown
    const monthly: Record<string, { total: number; thermal: number; pct: number }> = {};
    for (const m of [6, 7, 8, 9]) {
      const monthDays = days.filter(d => parseInt(d.date.split('-')[1]) === m);
      const monthThermal = monthDays.filter(d => d.isThermal);
      monthly[String(m)] = {
        total: monthDays.length,
        thermal: monthThermal.length,
        pct: monthDays.length > 0 ? Math.round(monthThermal.length / monthDays.length * 100) : 0,
      };
    }

    // Direction counts
    const dirCounts: Record<string, number> = {};
    for (const d of thermal) {
      dirCounts[d.thermalDir] = (dirCounts[d.thermalDir] || 0) + 1;
    }

    outputData[point.id] = {
      name: point.name,
      altitude: point.altitude,
      totalDays: days.length,
      thermalDays: thermal.length,
      thermalPct: days.length > 0 ? Math.round(thermal.length / days.length * 1000) / 10 : 0,
      avgGust: thermal.length > 0
        ? Math.round(thermal.reduce((s, d) => s + d.pmMaxGust, 0) / thermal.length * 10) / 10
        : 0,
      monthly,
      directionDistribution: dirCounts,
    };
  }

  const outputFile = join(__dirname, '..', 'src', 'config', 'openMeteoArchiveAnalysis.json');
  writeFileSync(outputFile, JSON.stringify({
    version: 1,
    generatedAt: new Date().toISOString(),
    years: YEARS,
    months: 'Jun-Sep',
    points: outputData,
  }, null, 2));

  console.log(`\nResults saved to ${outputFile}`);
}

main().catch(console.error);
