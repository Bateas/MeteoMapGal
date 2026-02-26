/**
 * Humidity-Wind direction correlation analysis at Embalse de Castrelo.
 *
 * Usage: npx tsx scripts/analyzeHumidityWind.ts
 *
 * Focused analysis: How does humidity affect thermal wind direction and speed?
 * Uses finer humidity bins (10% steps) to find the "sweet spot" for sailing.
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const EMBALSE = { lat: 42.295, lon: -8.115, name: 'Embalse Castrelo' };

const PERIODS = [
  { start: '2022-06-01', end: '2022-09-30' },
  { start: '2023-06-01', end: '2023-09-30' },
  { start: '2024-06-01', end: '2024-09-30' },
  { start: '2025-06-01', end: '2025-09-30' },
];

const CARDINALS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

interface HourlyPoint {
  time: Date;
  temperature: number;
  humidity: number;
  windSpeed: number;
  windDirection: number;
}

function degreesToCardinal8(deg: number): string {
  return CARDINALS_8[Math.round(((deg % 360 + 360) % 360) / 45) % 8];
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function fetchData(lat: number, lon: number, start: string, end: string): Promise<HourlyPoint[]> {
  const url = `https://archive-api.open-meteo.com/v1/archive` +
    `?latitude=${lat}&longitude=${lon}&start_date=${start}&end_date=${end}` +
    `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m` +
    `&wind_speed_unit=ms&timezone=Europe%2FMadrid`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();

  const pts: HourlyPoint[] = [];
  for (let i = 0; i < data.hourly.time.length; i++) {
    const t = data.hourly.temperature_2m[i];
    const h = data.hourly.relative_humidity_2m[i];
    const ws = data.hourly.wind_speed_10m[i];
    const wd = data.hourly.wind_direction_10m[i];
    if (t !== null && h !== null && ws !== null && wd !== null) {
      pts.push({ time: new Date(data.hourly.time[i]), temperature: t, humidity: h, windSpeed: ws, windDirection: wd });
    }
  }
  return pts;
}

// Circular mean of wind directions
function circularMean(directions: number[]): number {
  if (directions.length === 0) return 0;
  let sinSum = 0, cosSum = 0;
  for (const d of directions) {
    sinSum += Math.sin(d * Math.PI / 180);
    cosSum += Math.cos(d * Math.PI / 180);
  }
  return ((Math.atan2(sinSum / directions.length, cosSum / directions.length) * 180 / Math.PI) + 360) % 360;
}

async function main() {
  console.log('=== Análisis Humedad ↔ Viento en Embalse de Castrelo ===\n');

  let allPoints: HourlyPoint[] = [];
  for (const p of PERIODS) {
    const now = new Date();
    const end = new Date(p.end) > now ? now.toISOString().split('T')[0] : p.end;
    if (new Date(p.start) > now) continue;
    console.log(`📥 ${p.start} → ${end}`);
    const pts = await fetchData(EMBALSE.lat, EMBALSE.lon, p.start, end);
    allPoints = allPoints.concat(pts);
    await sleep(500);
  }

  console.log(`\n📊 Total: ${allPoints.length} puntos\n`);

  // ── Analysis 1: Humidity bins (10% steps) for afternoon (14-18h) ──
  console.log('═'.repeat(70));
  console.log('1. HUMEDAD vs DIRECCIÓN — Tardes 14-18h, T≥20°C, viento ≥1 m/s');
  console.log('═'.repeat(70));

  const humBins = [
    [30, 40], [40, 50], [50, 60], [60, 70], [70, 80], [80, 90], [90, 100]
  ] as [number, number][];

  for (const [hMin, hMax] of humBins) {
    const pts = allPoints.filter(p => {
      const h = p.time.getHours();
      return h >= 14 && h < 18 && p.temperature >= 20 && p.windSpeed >= 1.0 &&
        p.humidity >= hMin && p.humidity < hMax;
    });

    if (pts.length < 20) {
      console.log(`  HR ${hMin}-${hMax}%: n=${pts.length} (insuficiente)`);
      continue;
    }

    // Count directions
    const dirCounts: Record<string, number> = {};
    const dirSpeeds: Record<string, number[]> = {};
    for (const p of pts) {
      const dir = degreesToCardinal8(p.windDirection);
      dirCounts[dir] = (dirCounts[dir] || 0) + 1;
      if (!dirSpeeds[dir]) dirSpeeds[dir] = [];
      dirSpeeds[dir].push(p.windSpeed);
    }

    // Top 3 directions
    const sorted = Object.entries(dirCounts).sort((a, b) => b[1] - a[1]);
    const top3 = sorted.slice(0, 3).map(([dir, count]) => {
      const freq = (count / pts.length * 100).toFixed(0);
      const avgSpeed = (dirSpeeds[dir].reduce((a, b) => a + b, 0) / dirSpeeds[dir].length).toFixed(1);
      return `${dir} ${freq}% (${avgSpeed} m/s)`;
    }).join(', ');

    const avgSpeedAll = (pts.reduce((a, p) => a + p.windSpeed, 0) / pts.length).toFixed(1);

    console.log(`  HR ${hMin}-${hMax}%: n=${pts.length.toString().padStart(4)}, vel_media=${avgSpeedAll} m/s → ${top3}`);
  }

  // ── Analysis 2: Same for evening (18-22h) ──
  console.log('\n' + '═'.repeat(70));
  console.log('2. HUMEDAD vs DIRECCIÓN — Atardeceres 18-22h, T≥20°C, viento ≥1 m/s');
  console.log('═'.repeat(70));

  for (const [hMin, hMax] of humBins) {
    const pts = allPoints.filter(p => {
      const h = p.time.getHours();
      return h >= 18 && h < 22 && p.temperature >= 20 && p.windSpeed >= 1.0 &&
        p.humidity >= hMin && p.humidity < hMax;
    });

    if (pts.length < 20) {
      console.log(`  HR ${hMin}-${hMax}%: n=${pts.length} (insuficiente)`);
      continue;
    }

    const dirCounts: Record<string, number> = {};
    const dirSpeeds: Record<string, number[]> = {};
    for (const p of pts) {
      const dir = degreesToCardinal8(p.windDirection);
      dirCounts[dir] = (dirCounts[dir] || 0) + 1;
      if (!dirSpeeds[dir]) dirSpeeds[dir] = [];
      dirSpeeds[dir].push(p.windSpeed);
    }

    const sorted = Object.entries(dirCounts).sort((a, b) => b[1] - a[1]);
    const top3 = sorted.slice(0, 3).map(([dir, count]) => {
      const freq = (count / pts.length * 100).toFixed(0);
      const avgSpeed = (dirSpeeds[dir].reduce((a, b) => a + b, 0) / dirSpeeds[dir].length).toFixed(1);
      return `${dir} ${freq}% (${avgSpeed} m/s)`;
    }).join(', ');

    const avgSpeedAll = (pts.reduce((a, p) => a + p.windSpeed, 0) / pts.length).toFixed(1);

    console.log(`  HR ${hMin}-${hMax}%: n=${pts.length.toString().padStart(4)}, vel_media=${avgSpeedAll} m/s → ${top3}`);
  }

  // ── Analysis 3: Temperature × Humidity matrix for afternoons ──
  console.log('\n' + '═'.repeat(70));
  console.log('3. TEMP × HUMEDAD → Dirección dominante (14-18h, viento ≥1 m/s)');
  console.log('═'.repeat(70));

  const tempBins = [[20, 25], [25, 28], [28, 32], [32, 40]] as [number, number][];
  const humBins2 = [[30, 50], [50, 65], [65, 80], [80, 100]] as [number, number][];

  // Header
  console.log(`${''.padStart(12)}${humBins2.map(([a, b]) => `HR ${a}-${b}%`.padStart(18)).join('')}`);

  for (const [tMin, tMax] of tempBins) {
    const row = [`T ${tMin}-${tMax}°C`.padStart(12)];

    for (const [hMin, hMax] of humBins2) {
      const pts = allPoints.filter(p => {
        const h = p.time.getHours();
        return h >= 14 && h < 18 && p.windSpeed >= 1.0 &&
          p.temperature >= tMin && p.temperature < tMax &&
          p.humidity >= hMin && p.humidity < hMax;
      });

      if (pts.length < 15) {
        row.push('---'.padStart(18));
        continue;
      }

      const dirCounts: Record<string, number> = {};
      for (const p of pts) {
        const dir = degreesToCardinal8(p.windDirection);
        dirCounts[dir] = (dirCounts[dir] || 0) + 1;
      }

      const [topDir, topCount] = Object.entries(dirCounts).sort((a, b) => b[1] - a[1])[0];
      const freq = (topCount / pts.length * 100).toFixed(0);
      const avgSpeed = (pts.reduce((a, p) => a + p.windSpeed, 0) / pts.length).toFixed(1);
      row.push(`${topDir} ${freq}% ${avgSpeed}m/s n=${pts.length}`.padStart(18));
    }

    console.log(row.join(''));
  }

  // ── Analysis 4: "Thermal probability" by humidity ──
  console.log('\n' + '═'.repeat(70));
  console.log('4. PROBABILIDAD TÉRMICO NAVEGABLE (W/SW, ≥2 m/s) por humedad');
  console.log('═'.repeat(70));

  console.log('\n  14-18h, T≥20°C:');
  for (const [hMin, hMax] of humBins) {
    const pts = allPoints.filter(p => {
      const h = p.time.getHours();
      return h >= 14 && h < 18 && p.temperature >= 20 && p.windSpeed >= 1.0 &&
        p.humidity >= hMin && p.humidity < hMax;
    });

    if (pts.length < 20) continue;

    // "Navigable thermal" = W or SW, speed >= 2 m/s
    const thermal = pts.filter(p => {
      const dir = degreesToCardinal8(p.windDirection);
      return (dir === 'W' || dir === 'SW') && p.windSpeed >= 2.0;
    });

    const prob = (thermal.length / pts.length * 100).toFixed(1);
    const avgSpeed = thermal.length > 0
      ? (thermal.reduce((a, p) => a + p.windSpeed, 0) / thermal.length).toFixed(1)
      : '0.0';

    const bar = '█'.repeat(Math.round(thermal.length / pts.length * 30));
    console.log(`  HR ${hMin}-${hMax}%: ${prob.padStart(5)}% ${bar} (${thermal.length}/${pts.length}, ${avgSpeed} m/s)`);
  }

  console.log('\n  18-22h, T≥20°C:');
  for (const [hMin, hMax] of humBins) {
    const pts = allPoints.filter(p => {
      const h = p.time.getHours();
      return h >= 18 && h < 22 && p.temperature >= 20 && p.windSpeed >= 1.0 &&
        p.humidity >= hMin && p.humidity < hMax;
    });

    if (pts.length < 20) continue;

    const thermal = pts.filter(p => {
      const dir = degreesToCardinal8(p.windDirection);
      return (dir === 'W' || dir === 'SW') && p.windSpeed >= 2.0;
    });

    const prob = (thermal.length / pts.length * 100).toFixed(1);
    const avgSpeed = thermal.length > 0
      ? (thermal.reduce((a, p) => a + p.windSpeed, 0) / thermal.length).toFixed(1)
      : '0.0';

    const bar = '█'.repeat(Math.round(thermal.length / pts.length * 30));
    console.log(`  HR ${hMin}-${hMax}%: ${prob.padStart(5)}% ${bar} (${thermal.length}/${pts.length}, ${avgSpeed} m/s)`);
  }

  // ── Analysis 5: Daily evolution on "good thermal days" ──
  console.log('\n' + '═'.repeat(70));
  console.log('5. EVOLUCIÓN DIARIA en "días de térmico" (días con W ≥2.5 m/s 14-18h)');
  console.log('═'.repeat(70));

  // Find "good thermal days"
  const dayMap = new Map<string, HourlyPoint[]>();
  for (const p of allPoints) {
    const key = p.time.toISOString().split('T')[0];
    if (!dayMap.has(key)) dayMap.set(key, []);
    dayMap.get(key)!.push(p);
  }

  const thermalDays: string[] = [];
  for (const [day, pts] of dayMap) {
    const afternoonW = pts.filter(p => {
      const h = p.time.getHours();
      const dir = degreesToCardinal8(p.windDirection);
      return h >= 14 && h < 18 && (dir === 'W' || dir === 'SW') && p.windSpeed >= 2.5;
    });
    if (afternoonW.length >= 2) thermalDays.push(day);
  }

  console.log(`\n  ${thermalDays.length} días con térmico W/SW ≥2.5 m/s (14-18h)\n`);

  // Average profile of thermal days
  const hourBuckets: Map<number, { dirs: number[]; speeds: number[]; temps: number[]; hums: number[] }> = new Map();
  for (let h = 6; h <= 22; h++) hourBuckets.set(h, { dirs: [], speeds: [], temps: [], hums: [] });

  for (const day of thermalDays) {
    const pts = dayMap.get(day)!;
    for (const p of pts) {
      const h = p.time.getHours();
      if (h >= 6 && h <= 22) {
        const bucket = hourBuckets.get(h)!;
        bucket.dirs.push(p.windDirection);
        bucket.speeds.push(p.windSpeed);
        bucket.temps.push(p.temperature);
        bucket.hums.push(p.humidity);
      }
    }
  }

  console.log('  Hora  Dir.media  Vel.media  Temp.media  HR.media');
  console.log('  ─────────────────────────────────────────────────');
  for (let h = 6; h <= 22; h++) {
    const b = hourBuckets.get(h)!;
    if (b.dirs.length === 0) continue;
    const avgDir = circularMean(b.dirs);
    const avgSpeed = (b.speeds.reduce((a, v) => a + v, 0) / b.speeds.length);
    const avgTemp = (b.temps.reduce((a, v) => a + v, 0) / b.temps.length);
    const avgHum = (b.hums.reduce((a, v) => a + v, 0) / b.hums.length);

    const dirStr = degreesToCardinal8(avgDir);
    const speedBar = '▓'.repeat(Math.round(avgSpeed * 2));
    console.log(
      `  ${h.toString().padStart(2)}:00  ${dirStr.padEnd(4)} ${avgDir.toFixed(0).padStart(3)}°  ` +
      `${avgSpeed.toFixed(1).padStart(4)} m/s ${speedBar}  ` +
      `${avgTemp.toFixed(1).padStart(5)}°C  ${avgHum.toFixed(0).padStart(3)}%`
    );
  }

  console.log('\n✅ Análisis completo.');
}

main().catch(console.error);
