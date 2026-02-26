/**
 * Historical weather pattern analysis script (v2 - improved).
 *
 * Usage: npx tsx scripts/analyzeHistorical.ts
 *
 * Improvements over v1:
 * - Filters calm winds (<1 m/s) as noise
 * - Wider buckets → more samples per bucket → more statistically significant
 * - Higher thresholds: >35% frequency, >50 samples minimum
 * - Uses 8 cardinal directions instead of 16 (reduces noise)
 * - Inter-zone comparison: detects simultaneous divergent patterns (true thermal)
 * - Outputs both per-zone and cross-zone rules
 *
 * Output: src/config/historicalPatterns.json
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Configuration ────────────────────────────────────────

const LOCATIONS = [
  { id: 'embalse', lat: 42.295, lon: -8.115, name: 'Embalse Castrelo', altitude: 110 },
  { id: 'ourense', lat: 42.335, lon: -7.865, name: 'Ourense', altitude: 140 },
  { id: 'norte', lat: 42.42, lon: -8.30, name: 'Montaña Norte', altitude: 630 },
  { id: 'carballino', lat: 42.41, lon: -8.08, name: 'O Carballiño', altitude: 450 },
];

const ANALYSIS_PERIODS = [
  { start: '2022-06-01', end: '2022-09-30' },
  { start: '2023-06-01', end: '2023-09-30' },
  { start: '2024-06-01', end: '2024-09-30' },
  { start: '2025-06-01', end: '2025-09-30' },
];

// Wider buckets → more samples per bucket
const TEMP_RANGES: [number, number][] = [
  [20, 26], [26, 30], [30, 50],
];

const HUMIDITY_RANGES: [number, number][] = [
  [0, 55], [55, 75], [75, 100],
];

const HOUR_RANGES: [number, number][] = [
  [6, 10], [10, 14], [14, 18], [18, 22],
];

// 8 directions instead of 16 → less noise, more significant
const CARDINALS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

const MIN_WIND_SPEED = 1.0; // Filter calm winds (m/s)
const MIN_FREQUENCY = 0.30;  // 30% minimum for a dominant direction
const MIN_SAMPLES = 50;      // Minimum data points per bucket
const MIN_FREQUENCY_RULE = 0.35; // 35% minimum for rule suggestion

// ── Types ────────────────────────────────────────────────

interface HourlyPoint {
  time: Date;
  temperature: number | null;
  humidity: number | null;
  windSpeed: number | null;
  windDirection: number | null;
}

interface PatternBucket {
  tempRange: [number, number];
  humidityRange: [number, number];
  hourRange: [number, number];
  dirCounts: Record<string, number>;
  totalPoints: number;
  windSpeeds: number[];
}

interface OutputPattern {
  tempRange: [number, number];
  humidityRange: [number, number];
  hourRange: [number, number];
  directionDistribution: Record<string, number>;
  dominantDirection: string;
  dominantFrequency: number;
  avgWindSpeed: number;
  sampleCount: number;
}

interface CrossZonePattern {
  hourRange: [number, number];
  tempRange: [number, number];
  zoneA: string;
  zoneB: string;
  dirA: string;
  dirB: string;
  freqA: number;
  freqB: number;
  angleDiff: number;
  sampleCount: number;
  avgSpeedA: number;
  avgSpeedB: number;
}

interface SuggestedRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  conditions: {
    minTemp?: number;
    maxTemp?: number;
    minHumidity?: number;
    maxHumidity?: number;
    timeWindow?: { from: number; to: number };
    months?: number[];
  };
  expectedWind: {
    zone: string;
    directionRange: { from: number; to: number };
    minSpeed: number;
  };
  source: 'historical';
}

// ── Helpers ──────────────────────────────────────────────

function degreesToCardinal8(deg: number): string {
  const idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return CARDINALS_8[idx];
}

function cardinal8ToDegrees(cardinal: string): number {
  const idx = CARDINALS_8.indexOf(cardinal);
  return idx >= 0 ? idx * 45 : 0;
}

function angleDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Fetch ────────────────────────────────────────────────

async function fetchArchiveData(
  lat: number, lon: number, startDate: string, endDate: string
): Promise<HourlyPoint[]> {
  const url = `https://archive-api.open-meteo.com/v1/archive` +
    `?latitude=${lat}&longitude=${lon}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m` +
    `&wind_speed_unit=ms` +
    `&timezone=Europe%2FMadrid`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }

  const data = await res.json();
  const points: HourlyPoint[] = [];

  for (let i = 0; i < data.hourly.time.length; i++) {
    points.push({
      time: new Date(data.hourly.time[i]),
      temperature: data.hourly.temperature_2m[i],
      humidity: data.hourly.relative_humidity_2m[i],
      windSpeed: data.hourly.wind_speed_10m[i],
      windDirection: data.hourly.wind_direction_10m[i],
    });
  }

  return points;
}

// ── Per-zone analysis ────────────────────────────────────

function analyzeLocation(points: HourlyPoint[]): OutputPattern[] {
  const buckets: PatternBucket[] = [];
  for (const tempRange of TEMP_RANGES) {
    for (const humRange of HUMIDITY_RANGES) {
      for (const hourRange of HOUR_RANGES) {
        buckets.push({
          tempRange,
          humidityRange: humRange,
          hourRange,
          dirCounts: {},
          totalPoints: 0,
          windSpeeds: [],
        });
      }
    }
  }

  for (const point of points) {
    if (point.temperature === null || point.humidity === null ||
      point.windDirection === null || point.windSpeed === null) continue;

    // Filter calm winds
    if (point.windSpeed < MIN_WIND_SPEED) continue;

    const hour = point.time.getHours();

    for (const bucket of buckets) {
      const [tMin, tMax] = bucket.tempRange;
      const [hMin, hMax] = bucket.humidityRange;
      const [hrFrom, hrTo] = bucket.hourRange;

      if (point.temperature >= tMin && point.temperature < tMax &&
        point.humidity >= hMin && point.humidity < hMax &&
        hour >= hrFrom && hour < hrTo) {
        const cardinal = degreesToCardinal8(point.windDirection);
        bucket.dirCounts[cardinal] = (bucket.dirCounts[cardinal] || 0) + 1;
        bucket.totalPoints++;
        bucket.windSpeeds.push(point.windSpeed);
      }
    }
  }

  const patterns: OutputPattern[] = [];
  for (const bucket of buckets) {
    if (bucket.totalPoints < MIN_SAMPLES) continue;

    const distribution: Record<string, number> = {};
    let maxDir = '';
    let maxCount = 0;

    for (const [dir, count] of Object.entries(bucket.dirCounts)) {
      const freq = count / bucket.totalPoints;
      distribution[dir] = Math.round(freq * 1000) / 1000;
      if (count > maxCount) {
        maxCount = count;
        maxDir = dir;
      }
    }

    const avgSpeed = bucket.windSpeeds.reduce((a, b) => a + b, 0) / bucket.windSpeeds.length;

    patterns.push({
      tempRange: bucket.tempRange,
      humidityRange: bucket.humidityRange,
      hourRange: bucket.hourRange,
      directionDistribution: distribution,
      dominantDirection: maxDir,
      dominantFrequency: Math.round((maxCount / bucket.totalPoints) * 1000) / 1000,
      avgWindSpeed: Math.round(avgSpeed * 100) / 100,
      sampleCount: bucket.totalPoints,
    });
  }

  return patterns;
}

// ── Cross-zone analysis (the key insight) ────────────────

interface TimeBucketData {
  time: Date;
  temperature: number;
  humidity: number;
  windSpeed: number;
  windDirection: number;
}

function analyzeCrossZone(
  allData: Map<string, HourlyPoint[]>
): CrossZonePattern[] {
  // Align data by timestamp across locations
  const timeIndex = new Map<string, Map<string, TimeBucketData>>();

  for (const [locId, points] of allData.entries()) {
    for (const p of points) {
      if (p.temperature === null || p.humidity === null ||
        p.windDirection === null || p.windSpeed === null) continue;
      if (p.windSpeed < MIN_WIND_SPEED) continue;

      const key = p.time.toISOString();
      if (!timeIndex.has(key)) timeIndex.set(key, new Map());
      timeIndex.get(key)!.set(locId, {
        time: p.time,
        temperature: p.temperature,
        humidity: p.humidity,
        windSpeed: p.windSpeed,
        windDirection: p.windDirection,
      });
    }
  }

  // Compare zone pairs at each timestamp
  const zonePairs: [string, string][] = [
    ['embalse', 'norte'],
    ['embalse', 'ourense'],
    ['embalse', 'carballino'],
    ['norte', 'carballino'],
  ];

  // Bucket: hourRange × tempRange → directional divergence counts
  interface PairBucket {
    hourRange: [number, number];
    tempRange: [number, number];
    dirPairCounts: Map<string, { count: number; speedsA: number[]; speedsB: number[] }>;
    totalPoints: number;
  }

  const results: CrossZonePattern[] = [];

  for (const [zoneA, zoneB] of zonePairs) {
    const pairBuckets: PairBucket[] = [];
    for (const hourRange of HOUR_RANGES) {
      for (const tempRange of TEMP_RANGES) {
        pairBuckets.push({
          hourRange, tempRange,
          dirPairCounts: new Map(),
          totalPoints: 0,
        });
      }
    }

    for (const [, locMap] of timeIndex.entries()) {
      const dataA = locMap.get(zoneA);
      const dataB = locMap.get(zoneB);
      if (!dataA || !dataB) continue;

      const hour = dataA.time.getHours();
      // Use average temperature of both zones
      const avgTemp = (dataA.temperature + dataB.temperature) / 2;

      for (const bucket of pairBuckets) {
        const [hrFrom, hrTo] = bucket.hourRange;
        const [tMin, tMax] = bucket.tempRange;

        if (hour >= hrFrom && hour < hrTo &&
          avgTemp >= tMin && avgTemp < tMax) {
          const dirA = degreesToCardinal8(dataA.windDirection);
          const dirB = degreesToCardinal8(dataB.windDirection);
          const pairKey = `${dirA}|${dirB}`;

          if (!bucket.dirPairCounts.has(pairKey)) {
            bucket.dirPairCounts.set(pairKey, { count: 0, speedsA: [], speedsB: [] });
          }
          const entry = bucket.dirPairCounts.get(pairKey)!;
          entry.count++;
          entry.speedsA.push(dataA.windSpeed);
          entry.speedsB.push(dataB.windSpeed);
          bucket.totalPoints++;
        }
      }
    }

    // Extract significant divergent patterns
    for (const bucket of pairBuckets) {
      if (bucket.totalPoints < MIN_SAMPLES) continue;

      for (const [pairKey, entry] of bucket.dirPairCounts.entries()) {
        const freq = entry.count / bucket.totalPoints;
        if (freq < MIN_FREQUENCY) continue;

        const [dirA, dirB] = pairKey.split('|');
        const degA = cardinal8ToDegrees(dirA);
        const degB = cardinal8ToDegrees(dirB);
        const diff = angleDiff(degA, degB);

        // Only interested in divergent patterns (>= 90° difference)
        if (diff < 90) continue;

        const avgSpeedA = entry.speedsA.reduce((a, b) => a + b, 0) / entry.speedsA.length;
        const avgSpeedB = entry.speedsB.reduce((a, b) => a + b, 0) / entry.speedsB.length;

        results.push({
          hourRange: bucket.hourRange,
          tempRange: bucket.tempRange,
          zoneA, zoneB,
          dirA, dirB,
          freqA: freq, freqB: freq,
          angleDiff: diff,
          sampleCount: entry.count,
          avgSpeedA: Math.round(avgSpeedA * 100) / 100,
          avgSpeedB: Math.round(avgSpeedB * 100) / 100,
        });
      }
    }
  }

  // Sort by sample count (most robust first)
  results.sort((a, b) => b.sampleCount - a.sampleCount);

  return results;
}

// ── Rule generation ──────────────────────────────────────

function suggestRules(
  patterns: OutputPattern[],
  locationId: string
): SuggestedRule[] {
  const rules: SuggestedRule[] = [];

  const strong = patterns.filter(
    (p) => p.dominantFrequency >= MIN_FREQUENCY_RULE && p.sampleCount >= MIN_SAMPLES
  );

  strong.sort((a, b) => b.dominantFrequency - a.dominantFrequency);

  const seen = new Set<string>();

  for (const pattern of strong.slice(0, 5)) {
    // Deduplicate by direction + time window
    const key = `${pattern.dominantDirection}_${pattern.hourRange[0]}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const dirDeg = cardinal8ToDegrees(pattern.dominantDirection);
    const dirFrom = (dirDeg - 45 + 360) % 360;
    const dirTo = (dirDeg + 45) % 360;

    rules.push({
      id: `hist_${locationId}_${pattern.hourRange[0]}h_${pattern.dominantDirection.toLowerCase()}`,
      name: `${pattern.dominantDirection} ${pattern.hourRange[0]}-${pattern.hourRange[1]}h (${locationId})`,
      description: `T=${pattern.tempRange[0]}-${pattern.tempRange[1]}°C, HR=${pattern.humidityRange[0]}-${pattern.humidityRange[1]}% → ` +
        `${pattern.dominantDirection} ${(pattern.dominantFrequency * 100).toFixed(0)}%, ${pattern.avgWindSpeed.toFixed(1)} m/s (n=${pattern.sampleCount})`,
      enabled: true,
      conditions: {
        minTemp: pattern.tempRange[0],
        maxTemp: pattern.tempRange[1],
        minHumidity: pattern.humidityRange[0],
        maxHumidity: pattern.humidityRange[1],
        timeWindow: { from: pattern.hourRange[0], to: pattern.hourRange[1] },
        months: [6, 7, 8, 9],
      },
      expectedWind: {
        zone: locationId,
        directionRange: { from: dirFrom, to: dirTo },
        minSpeed: Math.max(1.0, pattern.avgWindSpeed * 0.5),
      },
      source: 'historical',
    });
  }

  return rules;
}

// ── Main ─────────────────────────────────────────────────

async function main() {
  console.log('=== MeteoMap Historical Analysis v2 ===');
  console.log(`Filtros: calma<${MIN_WIND_SPEED} m/s, freq>${MIN_FREQUENCY * 100}%, n>${MIN_SAMPLES}\n`);

  const allData = new Map<string, HourlyPoint[]>();
  const allResults: Record<string, {
    patterns: OutputPattern[];
    suggestedRules: SuggestedRule[];
    totalPoints: number;
    filteredPoints: number;
  }> = {};

  // Fetch all data
  for (const location of LOCATIONS) {
    console.log(`📍 ${location.name} (${location.altitude}m)`);

    let allPoints: HourlyPoint[] = [];

    for (const period of ANALYSIS_PERIODS) {
      const endDate = new Date(period.end);
      const now = new Date();
      const adjustedEnd = endDate > now ? now.toISOString().split('T')[0] : period.end;

      if (new Date(period.start) > now) {
        console.log(`  ⏭  ${period.start} (futuro)`);
        continue;
      }

      try {
        console.log(`  📥 ${period.start} → ${adjustedEnd}`);
        const points = await fetchArchiveData(location.lat, location.lon, period.start, adjustedEnd);
        allPoints = allPoints.concat(points);
        await sleep(500);
      } catch (err) {
        console.error(`  ❌ ${err}`);
      }
    }

    const filteredCount = allPoints.filter(p =>
      p.windSpeed !== null && p.windSpeed >= MIN_WIND_SPEED
    ).length;

    console.log(`  Total: ${allPoints.length} pts, ${filteredCount} con viento ≥${MIN_WIND_SPEED} m/s`);

    allData.set(location.id, allPoints);

    // Per-zone analysis
    const patterns = analyzeLocation(allPoints);
    const strongPatterns = patterns.filter(p => p.dominantFrequency >= MIN_FREQUENCY);
    console.log(`  ${patterns.length} patrones (${strongPatterns.length} con freq ≥${MIN_FREQUENCY * 100}%)`);

    const rules = suggestRules(patterns, location.id);
    console.log(`  ${rules.length} reglas\n`);

    // Print strong patterns
    for (const p of strongPatterns.sort((a, b) => b.dominantFrequency - a.dominantFrequency)) {
      console.log(
        `    ${p.hourRange[0]}-${p.hourRange[1]}h T=${p.tempRange[0]}-${p.tempRange[1]}°C ` +
        `HR=${p.humidityRange[0]}-${p.humidityRange[1]}% → ` +
        `${p.dominantDirection} ${(p.dominantFrequency * 100).toFixed(0)}% ` +
        `${p.avgWindSpeed.toFixed(1)}m/s (n=${p.sampleCount})`
      );
    }

    allResults[location.id] = {
      patterns,
      suggestedRules: rules,
      totalPoints: allPoints.length,
      filteredPoints: filteredCount,
    };
  }

  // Cross-zone analysis
  console.log('\n' + '═'.repeat(60));
  console.log('🔄 ANÁLISIS CRUZADO INTER-ZONAS');
  console.log('═'.repeat(60));
  console.log('Buscando patrones de viento divergente (≥90° diferencia)...\n');

  const crossPatterns = analyzeCrossZone(allData);

  if (crossPatterns.length === 0) {
    console.log('  No se encontraron patrones divergentes significativos.');
  } else {
    console.log(`  ${crossPatterns.length} patrones divergentes encontrados:\n`);

    // Show top cross-zone patterns
    for (const cp of crossPatterns.slice(0, 15)) {
      const locA = LOCATIONS.find(l => l.id === cp.zoneA)!;
      const locB = LOCATIONS.find(l => l.id === cp.zoneB)!;
      console.log(
        `  ${cp.hourRange[0]}-${cp.hourRange[1]}h T=${cp.tempRange[0]}-${cp.tempRange[1]}°C: ` +
        `${locA.name}→${cp.dirA} vs ${locB.name}→${cp.dirB} ` +
        `(Δ${cp.angleDiff}°, n=${cp.sampleCount}, ` +
        `${cp.avgSpeedA.toFixed(1)}/${cp.avgSpeedB.toFixed(1)} m/s)`
      );
    }
  }

  // Write output
  const output = {
    generatedAt: new Date().toISOString(),
    version: 2,
    config: {
      minWindSpeed: MIN_WIND_SPEED,
      minFrequency: MIN_FREQUENCY,
      minSamples: MIN_SAMPLES,
      minFrequencyRule: MIN_FREQUENCY_RULE,
      cardinalDirections: 8,
    },
    locations: LOCATIONS,
    periods: ANALYSIS_PERIODS,
    results: allResults,
    crossZonePatterns: crossPatterns.slice(0, 30), // top 30
  };

  const outPath = join(__dirname, '..', 'src', 'config', 'historicalPatterns.json');
  writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\n✅ Guardado en: ${outPath}`);

  // Final summary
  console.log('\n=== RESUMEN ===');
  for (const [locId, result] of Object.entries(allResults)) {
    const loc = LOCATIONS.find(l => l.id === locId)!;
    console.log(
      `${loc.name}: ${result.filteredPoints}/${result.totalPoints} pts válidos, ` +
      `${result.suggestedRules.length} reglas`
    );
  }
  console.log(`Patrones cruzados: ${crossPatterns.length}`);
}

main().catch(console.error);
