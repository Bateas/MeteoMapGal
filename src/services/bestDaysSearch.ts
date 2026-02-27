/**
 * Best days search engine — find historical days matching user criteria
 * from AEMET daily records.
 */

import type { ParsedDay } from './aemetHistoryParser';
import type { DaySearchCriteria, DaySearchResult } from '../types/campo';
import { isDirectionInRange } from './windUtils';

const MAX_RESULTS = 50;

/**
 * Score how well a single day matches the search criteria (0-100).
 */
export function scoreDayMatch(day: ParsedDay, criteria: DaySearchCriteria): number {
  let score = 0;
  let factors = 0;

  // Temperature range
  if (criteria.minTemp !== undefined || criteria.maxTemp !== undefined) {
    factors++;
    if (day.tmax === null) {
      score += 0;
    } else {
      let tempScore = 0;
      const min = criteria.minTemp ?? -999;
      const max = criteria.maxTemp ?? 999;
      if (day.tmax >= min && day.tmax <= max) {
        tempScore = 100;
        // Bonus for being in the sweet spot
        const mid = (min + max) / 2;
        const dist = Math.abs(day.tmax - mid);
        const range = (max - min) / 2;
        if (range > 0) tempScore = Math.max(60, 100 - (dist / range) * 40);
      } else {
        const distOutside = Math.min(
          Math.max(0, min - day.tmax),
          Math.max(0, day.tmax - max),
        );
        tempScore = Math.max(0, 50 - distOutside * 10);
      }
      score += tempScore;
    }
  }

  // Wind direction range
  if (criteria.windDirFrom !== undefined && criteria.windDirTo !== undefined) {
    factors++;
    if (day.dir === null) {
      score += 0;
    } else if (isDirectionInRange(day.dir * 10, { from: criteria.windDirFrom, to: criteria.windDirTo })) {
      score += 100;
    } else {
      score += 20; // Partial credit
    }
  }

  // Wind speed range
  if (criteria.minSpeed !== undefined || criteria.maxSpeed !== undefined) {
    factors++;
    if (day.velmedia === null) {
      score += 0;
    } else {
      const min = criteria.minSpeed ?? 0;
      const max = criteria.maxSpeed ?? 999;
      if (day.velmedia >= min && day.velmedia <= max) {
        score += 100;
      } else {
        const distOutside = Math.min(
          Math.max(0, min - day.velmedia),
          Math.max(0, day.velmedia - max),
        );
        score += Math.max(0, 50 - distOutside * 15);
      }
    }
  }

  // Max precipitation
  if (criteria.maxPrecip !== undefined) {
    factors++;
    if (day.prec === null) {
      score += 50; // Unknown = neutral
    } else if (day.prec <= criteria.maxPrecip) {
      score += 100;
    } else {
      score += Math.max(0, 50 - (day.prec - criteria.maxPrecip) * 10);
    }
  }

  // Months filter
  if (criteria.months && criteria.months.length > 0) {
    factors++;
    score += criteria.months.includes(day.month) ? 100 : 0;
  }

  if (factors === 0) return 50; // No criteria = neutral
  return Math.round(score / factors);
}

/**
 * Search AEMET history for days matching criteria, sorted by score.
 */
export function searchBestDays(
  records: ParsedDay[],
  criteria: DaySearchCriteria,
): DaySearchResult[] {
  const results: DaySearchResult[] = [];

  for (const day of records) {
    const s = scoreDayMatch(day, criteria);
    if (s < 30) continue; // Skip very poor matches

    results.push({
      fecha: day.fecha,
      temp: day.tmax ?? 0,
      wind: day.velmedia ?? 0,
      dir: day.dir !== null ? day.dir * 10 : 0, // AEMET dir is in decadegrees
      precip: day.prec ?? 0,
      humidity: day.hrMedia ?? 0,
      gust: day.racha ?? 0,
      score: s,
    });
  }

  // Sort by score descending, then by date descending
  results.sort((a, b) => b.score - a.score || b.fecha.localeCompare(a.fecha));

  return results.slice(0, MAX_RESULTS);
}
