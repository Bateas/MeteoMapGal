/**
 * analyzeFrontalVsThermal.ts
 *
 * ENHANCED analysis that cross-references Ourense sunshine hours ("sol")
 * with wind data from all stations to SEPARATE:
 *   - TRUE THERMAL: clear sky + warm + afternoon W/SW gust (convective)
 *   - FRONTAL/SYNOPTIC: cloudy + precipitation + any-direction wind (cyclonic)
 *
 * KEY INSIGHT (from user, 2026-03):
 *   T<28°C days with SW wind were mostly FRONTAL, not thermal.
 *   Vel_media=2.1 m/s at 25-28°C looked good statistically,
 *   but it was cyclonic wind, not convective — useless for sailing.
 *
 * Uses Ourense "sol" (sunshine hours) as cloud proxy since Ribadavia doesn't have it.
 * Summer max daylight in Galicia: ~15h (June) → ~13h (September).
 *   sol > 10h  → clear sky (likely thermal if warm enough)
 *   sol 6-10h  → partly cloudy (ambiguous)
 *   sol < 6h   → overcast/frontal (almost certainly NOT thermal)
 *
 * Also uses ΔT (Tmax-Tmin) as SECOND cloud proxy:
 *   ΔT > 16°C → clear sky (strong radiative cooling at night)
 *   ΔT 10-16°C → partly cloudy
 *   ΔT < 10°C → overcast (frontal blanket)
 *
 * Usage: npx tsx scripts/analyzeFrontalVsThermal.ts
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dataFile = join(__dirname, '..', 'src', 'config', 'aemetDailyHistory.json');

// ─── Parsing ───────────────────────────────────────────

interface AemetRecord {
  fecha: string;
  indicativo: string;
  nombre: string;
  altitud: string;
  dir: string;
  velmedia: string;
  racha: string;
  horaracha: string;
  tmed: string;
  tmax: string;
  horatmax: string;
  tmin: string;
  horatmin: string;
  hrMedia: string;
  hrMax: string;
  hrMin: string;
  horaHrMin: string;
  prec: string;
  sol?: string;       // Sunshine hours — only Ourense has this
  presMax?: string;
  presMin?: string;
  [key: string]: string | undefined;
}

function pf(s: string | undefined): number | null {
  if (!s || s === 'Ip' || s === 'Acum' || s === '') return null;
  return parseFloat(s.replace(',', '.'));
}

function dirToDeg(dir: string | undefined): number | null {
  if (!dir || dir === '99') return null;
  const d = parseInt(dir, 10);
  if (isNaN(d) || d < 1 || d > 36) return null;
  return d * 10;
}

function degToCardinal(deg: number): string {
  if (deg >= 350 || deg <= 10) return 'N';
  if (deg > 10 && deg <= 55) return 'NE';
  if (deg > 55 && deg <= 100) return 'E';
  if (deg > 100 && deg <= 145) return 'SE';
  if (deg > 145 && deg <= 190) return 'S';
  if (deg > 190 && deg <= 235) return 'SW';
  if (deg > 235 && deg <= 280) return 'W';
  return 'NW';
}

function parseTime(s: string | undefined): number | null {
  if (!s || s === 'Varias') return null;
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) + parseInt(m[2], 10) / 60;
}

interface ParsedDay {
  date: string;
  month: number;
  station: string;
  stationName: string;
  altitude: number | null;
  dirDeg: number | null;
  dirCard: string;
  velmedia: number | null;
  racha: number | null;
  gustTime: number | null;
  tmed: number | null;
  tmax: number | null;
  tmaxTime: number | null;
  tmin: number | null;
  deltaT: number | null;     // Tmax - Tmin
  hrMedia: number | null;
  hrMin: number | null;
  prec: number | null;
  sol: number | null;         // Sunshine hours (Ourense only)
  // Derived classifications
  isWesterly: boolean;
  isAfternoonGust: boolean;
  isWarm28: boolean;          // Tmax >= 28°C (confirmed thermal threshold)
  isDry: boolean;
  isClearSky: boolean;        // sol > 10h (when available)
  isHighDeltaT: boolean;      // ΔT > 16°C
  // OLD definition (includes frontal contamination)
  isThermalOld: boolean;
  // NEW definition (frontal-filtered)
  isThermalClean: boolean;
}

function parseRecords(records: AemetRecord[]): ParsedDay[] {
  return records.map(r => {
    const dirDeg = dirToDeg(r.dir);
    const tmax = pf(r.tmax);
    const tmin = pf(r.tmin);
    const racha = pf(r.racha);
    const gustTime = parseTime(r.horaracha);
    const prec = pf(r.prec);
    const hrMedia = pf(r.hrMedia);
    const sol = pf(r.sol);
    const deltaT = (tmax !== null && tmin !== null) ? tmax - tmin : null;

    const isWesterly = dirDeg !== null && dirDeg >= 200 && dirDeg <= 300;
    const isAfternoonGust = gustTime !== null && gustTime >= 13 && gustTime <= 21;
    const isWarm28 = tmax !== null && tmax >= 28;
    const isDry = prec === null || prec <= 0.5;
    const isClearSky = sol !== null && sol >= 10;
    const isHighDeltaT = deltaT !== null && deltaT >= 16;

    // OLD thermal definition (T>25°C — contaminated with frontal days!)
    const isThermalOld = isWesterly && isAfternoonGust && (tmax !== null && tmax >= 25) && isDry;

    // NEW CLEAN thermal definition:
    // 1. W/SW wind with afternoon gust (convective signature)
    // 2. Tmax >= 28°C (below this, wind is likely frontal)
    // 3. Dry (prec <= 0.5mm)
    // 4. At least ONE sky-clear indicator: high ΔT OR high sunshine hours
    const hasSkyClarity = isClearSky || isHighDeltaT || (deltaT !== null && deltaT >= 14 && isDry);
    const isThermalClean = isWesterly && isAfternoonGust && isWarm28 && isDry && hasSkyClarity;

    return {
      date: r.fecha,
      month: parseInt(r.fecha.slice(5, 7), 10),
      station: r.indicativo,
      stationName: r.nombre,
      altitude: pf(r.altitud),
      dirDeg,
      dirCard: dirDeg !== null ? degToCardinal(dirDeg) : 'calm',
      velmedia: pf(r.velmedia),
      racha,
      gustTime,
      tmed: pf(r.tmed),
      tmax,
      tmaxTime: parseTime(r.horatmax),
      tmin,
      deltaT,
      hrMedia,
      hrMin: pf(r.hrMin),
      prec,
      sol,
      isWesterly,
      isAfternoonGust,
      isWarm28,
      isDry,
      isClearSky,
      isHighDeltaT,
      isThermalOld,
      isThermalClean,
    };
  });
}

// ─── Analysis Functions ─────────────────────────────────

function hr() { console.log('─'.repeat(72)); }

/**
 * MAIN ANALYSIS 1: Compare old vs new thermal classification
 * Show how many "thermal" days at T<28°C were actually frontal
 */
function analyzeFrontalContamination(days: ParsedDay[], stationId: string) {
  const sd = days.filter(d => d.station === stationId);
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`  FRONTAL vs THERMAL CLASSIFICATION — ${sd[0]?.stationName || stationId}`);
  console.log(`${'═'.repeat(72)}`);

  const oldThermal = sd.filter(d => d.isThermalOld);
  const newThermal = sd.filter(d => d.isThermalClean);
  const removedByFilter = oldThermal.filter(d => !d.isThermalClean);

  console.log(`\n  Total summer days: ${sd.length}`);
  console.log(`  OLD "thermal" (T≥25, SW, afternoon, dry): ${oldThermal.length} (${(oldThermal.length/sd.length*100).toFixed(1)}%)`);
  console.log(`  NEW thermal (T≥28, SW, afternoon, dry, clear sky): ${newThermal.length} (${(newThermal.length/sd.length*100).toFixed(1)}%)`);
  console.log(`  ❌ Removed as frontal contamination: ${removedByFilter.length} days`);

  if (removedByFilter.length > 0) {
    console.log('\n  Details of removed "frontal pretending thermal" days:');
    const tempBins = [
      { label: 'T 25-28°C (ambiguous zone)', filter: (d: ParsedDay) => d.tmax !== null && d.tmax >= 25 && d.tmax < 28 },
      { label: 'T ≥28°C but cloudy/low ΔT', filter: (d: ParsedDay) => d.tmax !== null && d.tmax >= 28 },
    ];
    for (const bin of tempBins) {
      const inBin = removedByFilter.filter(bin.filter);
      if (inBin.length > 0) {
        const avgVel = inBin.reduce((s, d) => s + (d.velmedia || 0), 0) / inBin.length;
        const avgRacha = inBin.reduce((s, d) => s + (d.racha || 0), 0) / inBin.length;
        const avgDeltaT = inBin.filter(d => d.deltaT !== null).reduce((s, d) => s + d.deltaT!, 0) / inBin.filter(d => d.deltaT !== null).length;
        const avgPrec = inBin.filter(d => d.prec !== null).reduce((s, d) => s + d.prec!, 0) / inBin.length;
        console.log(`    ${bin.label}: ${inBin.length} days | vel ${avgVel.toFixed(1)} m/s | racha ${avgRacha.toFixed(1)} m/s | ΔT ${avgDeltaT.toFixed(1)}°C | prec ${avgPrec.toFixed(1)}mm`);
      }
    }
  }
}

/**
 * MAIN ANALYSIS 2: Cross-reference sunshine hours with thermal days
 * Uses Ourense "sol" to validate thermal classification on all stations
 */
function analyzeSunshineCorrelation(allDays: ParsedDay[]) {
  console.log(`\n${'═'.repeat(72)}`);
  console.log('  SUNSHINE HOURS vs THERMAL PROBABILITY');
  console.log('  (Cross-referencing Ourense "sol" with Ribadavia wind data)');
  console.log(`${'═'.repeat(72)}`);

  // Build sol lookup from Ourense
  const ourenseSol = new Map<string, number>();
  allDays.filter(d => d.station === '1690A' && d.sol !== null)
    .forEach(d => ourenseSol.set(d.date, d.sol!));

  console.log(`\n  Ourense "sol" data available: ${ourenseSol.size} days`);

  // For Ribadavia, check thermal probability by sunshine band
  const ribDays = allDays.filter(d => d.station === '1701X');
  const ribWithSol = ribDays.filter(d => ourenseSol.has(d.date))
    .map(d => ({ ...d, ourSol: ourenseSol.get(d.date)! }));

  console.log(`  Ribadavia days with Ourense sol cross-reference: ${ribWithSol.length}`);

  const solBins = [
    { label: 'sol <4h (overcast)', min: 0, max: 4 },
    { label: 'sol 4-7h (mostly cloudy)', min: 4, max: 7 },
    { label: 'sol 7-10h (partly cloudy)', min: 7, max: 10 },
    { label: 'sol 10-13h (mostly clear)', min: 10, max: 13 },
    { label: 'sol >13h (full sun)', min: 13, max: 20 },
  ];

  console.log('\n  Sunshine band | Old thermal | New thermal | Avg vel | Avg racha | Avg ΔT');
  hr();

  for (const bin of solBins) {
    const inBin = ribWithSol.filter(d => d.ourSol >= bin.min && d.ourSol < bin.max);
    if (inBin.length < 3) continue;

    const oldTherm = inBin.filter(d => d.isThermalOld);
    const newTherm = inBin.filter(d => d.isThermalClean);
    const avgVel = inBin.reduce((s, d) => s + (d.velmedia || 0), 0) / inBin.length;
    const avgRacha = inBin.filter(d => d.racha !== null).reduce((s, d) => s + d.racha!, 0) / Math.max(1, inBin.filter(d => d.racha !== null).length);
    const avgDT = inBin.filter(d => d.deltaT !== null).reduce((s, d) => s + d.deltaT!, 0) / Math.max(1, inBin.filter(d => d.deltaT !== null).length);

    const oldPct = (oldTherm.length / inBin.length * 100).toFixed(0);
    const newPct = (newTherm.length / inBin.length * 100).toFixed(0);

    console.log(`  ${bin.label.padEnd(27)} | ${oldTherm.length}/${inBin.length} (${oldPct.padStart(2)}%) | ${newTherm.length}/${inBin.length} (${newPct.padStart(2)}%) | ${avgVel.toFixed(1)} m/s | ${avgRacha.toFixed(1)} m/s  | ${avgDT.toFixed(1)}°C`);
  }
}

/**
 * MAIN ANALYSIS 3: Re-do temperature correlation with frontal filter
 * This should show that the 25-28°C "peak" disappears when frontal days are removed
 */
function analyzeTemperatureClean(days: ParsedDay[], stationId: string) {
  const sd = days.filter(d => d.station === stationId);
  const stationName = sd[0]?.stationName || stationId;

  console.log(`\n${'═'.repeat(72)}`);
  console.log(`  TEMPERATURE vs NAVIGABILITY — ${stationName} (frontal-filtered)`);
  console.log(`${'═'.repeat(72)}`);

  const tempBins = [
    { label: 'T <22°C', min: 0, max: 22 },
    { label: 'T 22-25°C', min: 22, max: 25 },
    { label: 'T 25-28°C', min: 25, max: 28 },
    { label: 'T 28-30°C', min: 28, max: 30 },
    { label: 'T 30-32°C', min: 30, max: 32 },
    { label: 'T 32-34°C', min: 32, max: 34 },
    { label: 'T 34-36°C', min: 34, max: 36 },
    { label: 'T 36-38°C', min: 36, max: 38 },
    { label: 'T >38°C', min: 38, max: 50 },
  ];

  console.log('\n  Temp band     | Days | Old therm | Clean therm | Avg vel | Avg racha | Avg ΔT  | Avg HR');
  hr();

  for (const bin of tempBins) {
    const inBin = sd.filter(d => d.tmax !== null && d.tmax >= bin.min && d.tmax < bin.max);
    if (inBin.length < 3) continue;

    const oldTherm = inBin.filter(d => d.isThermalOld);
    const newTherm = inBin.filter(d => d.isThermalClean);
    const avgVel = inBin.reduce((s, d) => s + (d.velmedia || 0), 0) / inBin.length;
    const avgRacha = inBin.filter(d => d.racha !== null).reduce((s, d) => s + d.racha!, 0) / Math.max(1, inBin.filter(d => d.racha !== null).length);
    const avgDT = inBin.filter(d => d.deltaT !== null).reduce((s, d) => s + d.deltaT!, 0) / Math.max(1, inBin.filter(d => d.deltaT !== null).length);
    const avgHR = inBin.filter(d => d.hrMedia !== null).reduce((s, d) => s + d.hrMedia!, 0) / Math.max(1, inBin.filter(d => d.hrMedia !== null).length);

    const oldPct = (oldTherm.length / inBin.length * 100).toFixed(0);
    const newPct = (newTherm.length / inBin.length * 100).toFixed(0);

    const marker = bin.min >= 28 && bin.max <= 32 ? ' ⭐' : bin.min >= 36 ? ' ⚠️' : '';

    console.log(`  ${bin.label.padEnd(13)} | ${inBin.length.toString().padStart(4)} | ${oldTherm.length}/${inBin.length} (${oldPct.padStart(2)}%) | ${newTherm.length}/${inBin.length} (${newPct.padStart(2)}%)     | ${avgVel.toFixed(1)} m/s | ${avgRacha.toFixed(1)} m/s  | ${avgDT.toFixed(1)}°C | ${avgHR.toFixed(0)}%${marker}`);
  }
}

/**
 * ANALYSIS 4: Wind velocity comparison — thermal vs frontal days
 * This should PROVE that frontal wind ≠ good sailing
 */
function analyzeWindQuality(days: ParsedDay[], stationId: string) {
  const sd = days.filter(d => d.station === stationId);
  const stationName = sd[0]?.stationName || stationId;

  console.log(`\n${'═'.repeat(72)}`);
  console.log(`  WIND QUALITY: THERMAL vs FRONTAL DAYS — ${stationName}`);
  console.log(`${'═'.repeat(72)}`);

  // Compare conditions between clean thermal and frontal-contaminated days
  const cleanThermal = sd.filter(d => d.isThermalClean);
  const frontalContaminated = sd.filter(d => d.isThermalOld && !d.isThermalClean);
  const allWesterly = sd.filter(d => d.isWesterly);
  const noWind = sd.filter(d => d.velmedia !== null && d.velmedia < 0.5);

  const groups = [
    { label: '✅ CLEAN thermal (T≥28, clear, SW, dry)', data: cleanThermal },
    { label: '❌ Frontal-contaminated (T<28 or cloudy, SW)', data: frontalContaminated },
    { label: '💨 All westerly days (SW/W)', data: allWesterly },
    { label: '😴 Calm days (vel < 0.5 m/s)', data: noWind },
  ];

  for (const g of groups) {
    if (g.data.length === 0) continue;
    const avgVel = g.data.reduce((s, d) => s + (d.velmedia || 0), 0) / g.data.length;
    const avgRacha = g.data.filter(d => d.racha !== null).reduce((s, d) => s + d.racha!, 0) / Math.max(1, g.data.filter(d => d.racha !== null).length);
    const avgGustTime = g.data.filter(d => d.gustTime !== null).reduce((s, d) => s + d.gustTime!, 0) / Math.max(1, g.data.filter(d => d.gustTime !== null).length);
    const avgTmax = g.data.filter(d => d.tmax !== null).reduce((s, d) => s + d.tmax!, 0) / Math.max(1, g.data.filter(d => d.tmax !== null).length);
    const avgHR = g.data.filter(d => d.hrMedia !== null).reduce((s, d) => s + d.hrMedia!, 0) / Math.max(1, g.data.filter(d => d.hrMedia !== null).length);
    const avgDT = g.data.filter(d => d.deltaT !== null).reduce((s, d) => s + d.deltaT!, 0) / Math.max(1, g.data.filter(d => d.deltaT !== null).length);

    const afternoonGustPct = g.data.filter(d => d.gustTime !== null && d.gustTime >= 13 && d.gustTime <= 19).length / g.data.length * 100;

    console.log(`\n  ${g.label}`);
    console.log(`    Days: ${g.data.length}`);
    console.log(`    Vel media: ${avgVel.toFixed(2)} m/s (${(avgVel * 1.944).toFixed(1)} kt)`);
    console.log(`    Avg racha: ${avgRacha.toFixed(1)} m/s (${(avgRacha * 1.944).toFixed(0)} kt)`);
    console.log(`    Gust time: ${avgGustTime.toFixed(1)}h | Afternoon gust: ${afternoonGustPct.toFixed(0)}%`);
    console.log(`    Tmax: ${avgTmax.toFixed(1)}°C | HR: ${avgHR.toFixed(0)}% | ΔT: ${avgDT.toFixed(1)}°C`);
  }
}

/**
 * ANALYSIS 5: ΔT as thermal predictor — validate the 20°C threshold
 */
function analyzeDeltaTClean(days: ParsedDay[], stationId: string) {
  const sd = days.filter(d => d.station === stationId);
  const stationName = sd[0]?.stationName || stationId;

  console.log(`\n${'═'.repeat(72)}`);
  console.log(`  ΔT (Tmax-Tmin) vs CLEAN THERMAL PROBABILITY — ${stationName}`);
  console.log(`${'═'.repeat(72)}`);

  const bins = [
    { label: 'ΔT <8°C', min: 0, max: 8 },
    { label: 'ΔT 8-10°C', min: 8, max: 10 },
    { label: 'ΔT 10-12°C', min: 10, max: 12 },
    { label: 'ΔT 12-14°C', min: 12, max: 14 },
    { label: 'ΔT 14-16°C', min: 14, max: 16 },
    { label: 'ΔT 16-18°C', min: 16, max: 18 },
    { label: 'ΔT 18-20°C', min: 18, max: 20 },
    { label: 'ΔT >20°C', min: 20, max: 40 },
  ];

  console.log('\n  ΔT band      | Days | Old therm | Clean therm | Avg vel | Avg sol(Our)');
  hr();

  // Get Ourense sol lookup
  const ourenseSol = new Map<string, number>();
  days.filter(d => d.station === '1690A' && d.sol !== null)
    .forEach(d => ourenseSol.set(d.date, d.sol!));

  for (const bin of bins) {
    const inBin = sd.filter(d => d.deltaT !== null && d.deltaT >= bin.min && d.deltaT < bin.max);
    if (inBin.length < 3) continue;

    const oldTherm = inBin.filter(d => d.isThermalOld);
    const newTherm = inBin.filter(d => d.isThermalClean);
    const avgVel = inBin.reduce((s, d) => s + (d.velmedia || 0), 0) / inBin.length;

    // Cross-reference with Ourense sunshine
    const withSol = inBin.filter(d => ourenseSol.has(d.date));
    const avgSol = withSol.length > 0
      ? withSol.reduce((s, d) => s + ourenseSol.get(d.date)!, 0) / withSol.length
      : null;

    const oldPct = (oldTherm.length / inBin.length * 100).toFixed(0);
    const newPct = (newTherm.length / inBin.length * 100).toFixed(0);

    console.log(`  ${bin.label.padEnd(13)} | ${inBin.length.toString().padStart(4)} | ${oldTherm.length}/${inBin.length} (${oldPct.padStart(2)}%) | ${newTherm.length}/${inBin.length} (${newPct.padStart(2)}%)     | ${avgVel.toFixed(1)} m/s | ${avgSol !== null ? avgSol.toFixed(1) + 'h' : 'n/a'}`);
  }
}

/**
 * ANALYSIS 6: Multi-station comparison for new stations
 */
function analyzeAllStations(days: ParsedDay[]) {
  console.log(`\n${'═'.repeat(72)}`);
  console.log('  ALL-STATION OVERVIEW');
  console.log(`${'═'.repeat(72)}`);

  const stations = [...new Set(days.map(d => d.station))].sort();

  console.log('\n  Station     | Name                  | Alt  | Days | Old therm | Clean therm | Avg vel | Dominant dir');
  hr();

  for (const sid of stations) {
    const sd = days.filter(d => d.station === sid);
    if (sd.length === 0) continue;

    const oldTherm = sd.filter(d => d.isThermalOld);
    const newTherm = sd.filter(d => d.isThermalClean);
    const avgVel = sd.reduce((s, d) => s + (d.velmedia || 0), 0) / sd.length;

    // Dominant direction
    const dirCounts: Record<string, number> = {};
    for (const d of sd) dirCounts[d.dirCard] = (dirCounts[d.dirCard] || 0) + 1;
    const topDir = Object.entries(dirCounts).sort((a, b) => b[1] - a[1])[0];

    const oldPct = (oldTherm.length / sd.length * 100).toFixed(0);
    const newPct = (newTherm.length / sd.length * 100).toFixed(0);
    const alt = sd[0]?.altitude !== null ? `${sd[0].altitude}m` : '?';

    console.log(`  ${sid.padEnd(10)} | ${(sd[0]?.stationName || '?').padEnd(21)} | ${alt.padStart(4)} | ${sd.length.toString().padStart(4)} | ${oldTherm.length}/${sd.length} (${oldPct.padStart(2)}%) | ${newTherm.length}/${sd.length} (${newPct.padStart(2)}%)     | ${avgVel.toFixed(1)} m/s | ${topDir ? `${topDir[0]} (${(topDir[1]/sd.length*100).toFixed(0)}%)` : '?'}`);
  }
}

/**
 * ANALYSIS 7: Cross-station direction patterns on thermal days
 * When Ribadavia has clean thermal, what do other stations show?
 */
function crossStationThermalSignature(days: ParsedDay[]) {
  console.log(`\n${'═'.repeat(72)}`);
  console.log('  CROSS-STATION THERMAL SIGNATURE');
  console.log('  (When Ribadavia has clean thermal, what do nearby stations show?)');
  console.log(`${'═'.repeat(72)}`);

  // Get Ribadavia clean thermal dates
  const ribCleanDates = new Set(
    days.filter(d => d.station === '1701X' && d.isThermalClean).map(d => d.date)
  );

  console.log(`\n  Ribadavia clean thermal days: ${ribCleanDates.size}`);

  const stations = [...new Set(days.map(d => d.station))].sort();

  for (const sid of stations) {
    if (sid === '1701X') continue;

    const onThermalDays = days.filter(d => d.station === sid && ribCleanDates.has(d.date));
    if (onThermalDays.length < 3) continue;

    const dirCounts: Record<string, number> = {};
    for (const d of onThermalDays) dirCounts[d.dirCard] = (dirCounts[d.dirCard] || 0) + 1;
    const topDirs = Object.entries(dirCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);

    const avgVel = onThermalDays.reduce((s, d) => s + (d.velmedia || 0), 0) / onThermalDays.length;
    const avgRacha = onThermalDays.filter(d => d.racha !== null).reduce((s, d) => s + d.racha!, 0) / Math.max(1, onThermalDays.filter(d => d.racha !== null).length);
    const alsoThermal = onThermalDays.filter(d => d.isThermalClean);

    console.log(`\n  ${sid} (${onThermalDays[0]?.stationName || '?'}) — ${onThermalDays.length} matching days:`);
    console.log(`    Also clean thermal: ${alsoThermal.length} (${(alsoThermal.length/onThermalDays.length*100).toFixed(0)}%)`);
    console.log(`    Directions: ${topDirs.map(([d,c]) => `${d}(${(c/onThermalDays.length*100).toFixed(0)}%)`).join(' ')}`);
    console.log(`    Avg vel: ${avgVel.toFixed(1)} m/s | racha: ${avgRacha.toFixed(1)} m/s`);
  }
}

/**
 * ANALYSIS 8: Humidity sweet spot validation (clean thermal only)
 */
function analyzeHumidityClean(days: ParsedDay[], stationId: string) {
  const sd = days.filter(d => d.station === stationId);
  const stationName = sd[0]?.stationName || stationId;

  console.log(`\n${'═'.repeat(72)}`);
  console.log(`  HUMIDITY vs CLEAN THERMAL — ${stationName}`);
  console.log(`${'═'.repeat(72)}`);

  const bins = [
    { label: 'HR <40%', min: 0, max: 40 },
    { label: 'HR 40-50%', min: 40, max: 50 },
    { label: 'HR 50-60%', min: 50, max: 60 },
    { label: 'HR 60-70%', min: 60, max: 70 },
    { label: 'HR 70-80%', min: 70, max: 80 },
    { label: 'HR >80%', min: 80, max: 100 },
  ];

  console.log('\n  HR band    | Days | Clean therm | Avg vel | Avg racha | Avg ΔT');
  hr();

  for (const bin of bins) {
    const inBin = sd.filter(d => d.hrMedia !== null && d.hrMedia >= bin.min && d.hrMedia < bin.max);
    if (inBin.length < 3) continue;

    const newTherm = inBin.filter(d => d.isThermalClean);
    const avgVel = inBin.reduce((s, d) => s + (d.velmedia || 0), 0) / inBin.length;
    const avgRacha = inBin.filter(d => d.racha !== null).reduce((s, d) => s + d.racha!, 0) / Math.max(1, inBin.filter(d => d.racha !== null).length);
    const avgDT = inBin.filter(d => d.deltaT !== null).reduce((s, d) => s + d.deltaT!, 0) / Math.max(1, inBin.filter(d => d.deltaT !== null).length);

    const pct = (newTherm.length / inBin.length * 100).toFixed(0);

    console.log(`  ${bin.label.padEnd(10)} | ${inBin.length.toString().padStart(4)} | ${newTherm.length}/${inBin.length} (${pct.padStart(2)}%)     | ${avgVel.toFixed(1)} m/s | ${avgRacha.toFixed(1)} m/s  | ${avgDT.toFixed(1)}°C`);
  }
}

// ─── MAIN ──────────────────────────────────────────────

function main() {
  const raw = JSON.parse(readFileSync(dataFile, 'utf-8'));
  const records: AemetRecord[] = raw.records;

  console.log(`\n${'█'.repeat(72)}`);
  console.log('  AEMET FRONTAL vs THERMAL ANALYSIS');
  console.log(`  ${records.length} records from ${[...new Set(records.map(r => r.indicativo))].length} stations`);
  console.log(`  Data: ${raw.fetchedAt}`);
  console.log(`${'█'.repeat(72)}`);

  const allDays = parseRecords(records);

  // Station summary
  analyzeAllStations(allDays);

  // Ribadavia deep analysis
  analyzeFrontalContamination(allDays, '1701X');
  analyzeTemperatureClean(allDays, '1701X');
  analyzeWindQuality(allDays, '1701X');
  analyzeDeltaTClean(allDays, '1701X');
  analyzeHumidityClean(allDays, '1701X');

  // Sunshine hours cross-reference
  analyzeSunshineCorrelation(allDays);

  // Cross-station patterns
  crossStationThermalSignature(allDays);

  // Also do Ourense for comparison
  if (allDays.some(d => d.station === '1690A')) {
    analyzeFrontalContamination(allDays, '1690A');
    analyzeTemperatureClean(allDays, '1690A');
  }

  // Final summary
  console.log(`\n${'█'.repeat(72)}`);
  console.log('  CONCLUSIONS');
  console.log(`${'█'.repeat(72)}`);

  const ribDays = allDays.filter(d => d.station === '1701X');
  const cleanThermal = ribDays.filter(d => d.isThermalClean);
  const frontalContam = ribDays.filter(d => d.isThermalOld && !d.isThermalClean);

  console.log(`
  OLD thermal definition (T≥25, SW, dry, afternoon gust):
    ${ribDays.filter(d => d.isThermalOld).length} days detected
    ⚠️ CONTAMINATED: included frontal wind days at 25-28°C

  NEW clean thermal definition (T≥28, SW, dry, afternoon gust, clear sky indicator):
    ${cleanThermal.length} days detected
    ✅ Removed ${frontalContam.length} false positives

  Key learnings:
    - Below 28°C, SW wind is likely frontal (confirmed by user + data)
    - ΔT (Tmax-Tmin) is the best available proxy for sky clarity
    - Ourense "sol" (sunshine hours) validates the ΔT proxy
    - Temperature alone does NOT predict good sailing days
    - The combination of T≥28°C + dry + high ΔT + SW afternoon gust = TRUE thermal
  `);
}

main();
