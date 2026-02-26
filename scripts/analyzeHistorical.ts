/**
 * Historical weather pattern analysis script.
 *
 * Usage: npx tsx scripts/analyzeHistorical.ts
 *
 * Fetches hourly data from Open-Meteo Archive API for the Castrelo de Miño
 * reservoir area (Jun-Sep, 2022-2025) and analyzes thermal wind patterns.
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
  { id: 'embalse', lat: 42.295, lon: -8.115, name: 'Embalse Castrelo' },
  { id: 'ourense', lat: 42.335, lon: -7.865, name: 'Ourense' },
  { id: 'norte', lat: 42.42, lon: -8.30, name: 'Montaña Norte' },
  { id: 'carballino', lat: 42.41, lon: -8.08, name: 'O Carballiño' },
];

const ANALYSIS_PERIODS = [
  { start: '2022-06-01', end: '2022-09-30' },
  { start: '2023-06-01', end: '2023-09-30' },
  { start: '2024-06-01', end: '2024-09-30' },
  { start: '2025-06-01', end: '2025-09-30' },
];

const TEMP_RANGES: [number, number][] = [
  [20, 25], [25, 28], [28, 30], [30, 50],
];

const HUMIDITY_RANGES: [number, number][] = [
  [0, 50], [50, 60], [60, 70], [70, 100],
];

const HOUR_RANGES: [number, number][] = [
  [6, 10], [10, 14], [14, 17], [17, 20], [20, 23],
];

const CARDINALS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

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

function degreesToCardinal(deg: number): string {
  const idx = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
  return CARDINALS[idx];
}

function cardinalToDegrees(cardinal: string): number {
  const idx = CARDINALS.indexOf(cardinal);
  return idx >= 0 ? idx * 22.5 : 0;
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

// ── Analysis ─────────────────────────────────────────────

function analyzeLocation(points: HourlyPoint[]): OutputPattern[] {
  // Create buckets for each combination
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

  // Fill buckets
  for (const point of points) {
    if (point.temperature === null || point.humidity === null ||
      point.windDirection === null || point.windSpeed === null) continue;

    const hour = point.time.getHours();

    for (const bucket of buckets) {
      const [tMin, tMax] = bucket.tempRange;
      const [hMin, hMax] = bucket.humidityRange;
      const [hrFrom, hrTo] = bucket.hourRange;

      if (point.temperature >= tMin && point.temperature < tMax &&
        point.humidity >= hMin && point.humidity < hMax &&
        hour >= hrFrom && hour < hrTo) {
        const cardinal = degreesToCardinal(point.windDirection);
        bucket.dirCounts[cardinal] = (bucket.dirCounts[cardinal] || 0) + 1;
        bucket.totalPoints++;
        bucket.windSpeeds.push(point.windSpeed);
      }
    }
  }

  // Convert to output format, filter buckets with enough data
  const patterns: OutputPattern[] = [];
  for (const bucket of buckets) {
    if (bucket.totalPoints < 20) continue; // Need at least 20 data points

    const distribution: Record<string, number> = {};
    let maxDir = '';
    let maxCount = 0;

    for (const [dir, count] of Object.entries(bucket.dirCounts)) {
      const freq = count / bucket.totalPoints;
      distribution[dir] = Math.round(freq * 1000) / 1000; // 3 decimal precision
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

function suggestRules(
  patterns: OutputPattern[],
  locationId: string,
  minFrequency = 0.25
): SuggestedRule[] {
  const rules: SuggestedRule[] = [];

  // Find patterns with strong directional signal
  const strong = patterns.filter(
    (p) => p.dominantFrequency >= minFrequency && p.sampleCount >= 30
  );

  // Sort by frequency (strongest signal first)
  strong.sort((a, b) => b.dominantFrequency - a.dominantFrequency);

  // Generate rules from top patterns (avoid too many overlapping rules)
  const seen = new Set<string>();

  for (const pattern of strong.slice(0, 10)) {
    const key = `${pattern.tempRange[0]}_${pattern.hourRange[0]}_${pattern.dominantDirection}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const dirDeg = cardinalToDegrees(pattern.dominantDirection);
    // ±45° range around dominant direction
    const dirFrom = (dirDeg - 45 + 360) % 360;
    const dirTo = (dirDeg + 45) % 360;

    const rule: SuggestedRule = {
      id: `hist_${locationId}_${pattern.tempRange[0]}t_${pattern.hourRange[0]}h_${pattern.dominantDirection.toLowerCase()}`,
      name: `Patrón ${pattern.dominantDirection} (${pattern.tempRange[0]}-${pattern.tempRange[1]}°C, ${pattern.hourRange[0]}-${pattern.hourRange[1]}h)`,
      description: `Cuando T=${pattern.tempRange[0]}-${pattern.tempRange[1]}°C, HR=${pattern.humidityRange[0]}-${pattern.humidityRange[1]}%, ` +
        `${pattern.hourRange[0]}-${pattern.hourRange[1]}h → viento ${pattern.dominantDirection} (${(pattern.dominantFrequency * 100).toFixed(0)}% frecuencia, ` +
        `${pattern.avgWindSpeed.toFixed(1)} m/s medio, n=${pattern.sampleCount})`,
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
        minSpeed: Math.max(0.3, pattern.avgWindSpeed * 0.5),
      },
      source: 'historical',
    };

    rules.push(rule);
  }

  return rules;
}

// ── Main ─────────────────────────────────────────────────

async function main() {
  console.log('=== MeteoMap Historical Analysis ===\n');

  const allResults: Record<string, {
    patterns: OutputPattern[];
    suggestedRules: SuggestedRule[];
    totalPoints: number;
  }> = {};

  for (const location of LOCATIONS) {
    console.log(`\n📍 ${location.name} (${location.lat}, ${location.lon})`);
    console.log('─'.repeat(50));

    let allPoints: HourlyPoint[] = [];

    for (const period of ANALYSIS_PERIODS) {
      // Check if period end is in the future
      const endDate = new Date(period.end);
      const now = new Date();
      const adjustedEnd = endDate > now
        ? now.toISOString().split('T')[0]
        : period.end;

      // Skip if start is in the future
      if (new Date(period.start) > now) {
        console.log(`  ⏭  ${period.start} → ${period.end} (futuro, omitido)`);
        continue;
      }

      try {
        console.log(`  📥 Descargando ${period.start} → ${adjustedEnd}...`);
        const points = await fetchArchiveData(
          location.lat, location.lon, period.start, adjustedEnd
        );
        console.log(`     ${points.length} puntos horarios`);
        allPoints = allPoints.concat(points);

        // Rate limiting: Open-Meteo free tier
        await sleep(500);
      } catch (err) {
        console.error(`  ❌ Error: ${err}`);
      }
    }

    console.log(`\n  📊 Total: ${allPoints.length} puntos`);

    // Analyze
    const patterns = analyzeLocation(allPoints);
    console.log(`  📈 ${patterns.length} patrones con datos suficientes`);

    // Suggest rules
    const rules = suggestRules(patterns, location.id);
    console.log(`  🎯 ${rules.length} reglas sugeridas`);

    // Print top patterns
    const topPatterns = patterns
      .filter((p) => p.dominantFrequency >= 0.20)
      .sort((a, b) => b.dominantFrequency - a.dominantFrequency)
      .slice(0, 5);

    if (topPatterns.length > 0) {
      console.log('\n  🔝 Top patrones:');
      for (const p of topPatterns) {
        console.log(
          `     T=${p.tempRange[0]}-${p.tempRange[1]}°C, ` +
          `HR=${p.humidityRange[0]}-${p.humidityRange[1]}%, ` +
          `${p.hourRange[0]}-${p.hourRange[1]}h → ` +
          `${p.dominantDirection} (${(p.dominantFrequency * 100).toFixed(0)}%, ` +
          `${p.avgWindSpeed.toFixed(1)} m/s, n=${p.sampleCount})`
        );
      }
    }

    if (rules.length > 0) {
      console.log('\n  📋 Reglas sugeridas:');
      for (const rule of rules) {
        console.log(`     • ${rule.name}`);
        console.log(`       ${rule.description}`);
      }
    }

    allResults[location.id] = {
      patterns,
      suggestedRules: rules,
      totalPoints: allPoints.length,
    };
  }

  // Write output
  const output = {
    generatedAt: new Date().toISOString(),
    locations: LOCATIONS,
    periods: ANALYSIS_PERIODS,
    results: allResults,
  };

  const outPath = join(__dirname, '..', 'src', 'config', 'historicalPatterns.json');
  writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\n✅ Resultados guardados en: ${outPath}`);

  // Summary
  console.log('\n=== Resumen ===');
  for (const [locId, result] of Object.entries(allResults)) {
    const loc = LOCATIONS.find((l) => l.id === locId)!;
    console.log(`${loc.name}: ${result.totalPoints} pts, ${result.patterns.length} patrones, ${result.suggestedRules.length} reglas`);
  }
}

main().catch(console.error);
