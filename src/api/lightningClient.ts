import type { LightningStrike } from '../types/lightning';

/**
 * MeteoGalicia meteo2api lightning endpoint.
 * Returns individual cloud-to-ground strikes with lat/lon/timestamp.
 *
 * - `lenda` endpoint: last 24 h of strikes (positive + negative polarity).
 * - Auth: public-tier JWT embedded in MeteoGalicia's Angular app (api_manager_key).
 * - Proxy via Vite `/meteo2api` → `https://apis-ext.xunta.gal/meteo2api`.
 *
 * Source: MeteoGalicia / Xunta de Galicia (CC BY-SA 4.0)
 */

const RAIOS_LENDA_URL = '/meteo2api/v1/api/raios/lenda';

/**
 * Public-tier API key (WSO2 API Manager JWT).
 * Extracted from MeteoGalicia's production Angular bundle — it is NOT a secret.
 * Tier: "Public", application: "w_meteo2", owner: "admin".
 * Loaded from .env for easy rotation; falls back to embedded key.
 */
const API_KEY = import.meta.env.VITE_LIGHTNING_API_KEY ??
  'eyJ4NXQiOiJObUU1TXpSbVpXSmtNREZtT1RJeFlqWTFNRE00TmpnM1pqVmlOR0k1WkdZM09HTXpPVEJsTURNelpUQmhOalJtWVdJNE9HUmpOR1ZpTldKak1qZGpZUSIsImtpZCI6ImdhdGV3YXlfY2VydGlmaWNhdGVfYWxpYXMiLCJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhZG1pbkBjYXJib24uc3VwZXIiLCJhcHBsaWNhdGlvbiI6eyJvd25lciI6ImFkbWluIiwidGllclF1b3RhVHlwZSI6bnVsbCwidGllciI6IlVubGltaXRlZCIsIm5hbWUiOiJ3X21ldGVvMiIsImlkIjozMzAxLCJ1dWlkIjoiMmNhMDI4N2ItNWYzYy00NGMzLTg3ZGEtOWY5ODg3NWZjNjk5In0sImlzcyI6Imh0dHBzOlwvXC9wcmQtd3NvMmFwaW0tYzAxLTAwMDEueHVudGEubG9jYWw6OTQ0NFwvb2F1dGgyXC90b2tlbiIsInRpZXJJbmZvIjp7IlB1YmxpYyI6eyJ0aWVyUXVvdGFUeXBlIjoicmVxdWVzdENvdW50IiwiZ3JhcGhRTE1heENvbXBsZXhpdHkiOjAsImdyYXBoUUxNYXhEZXB0aCI6MCwic3RvcE9uUXVvdGFSZWFjaCI6dHJ1ZSwic3Bpa2VBcnJlc3RMaW1pdCI6MCwic3Bpa2VBcnJlc3RVbml0Ijoic2VjIn19LCJrZXl0eXBlIjoiUFJPRFVDVElPTiIsInBlcm1pdHRlZFJlZmVyZXIiOiIiLCJzdWJzY3JpYmVkQVBJcyI6W3sic3Vic2NyaWJlclRlbmFudERvbWFpbiI6ImNhcmJvbi5zdXBlciIsIm5hbWUiOiJNRVRFTzJfQVBJIiwiY29udGV4dCI6IlwvbWV0ZW8yYXBpXC92MSIsInB1Ymxpc2hlciI6IkFNVEVHQVwvdWUwODIwNSIsInZlcnNpb24iOiJ2MSIsInN1YnNjcmlwdGlvblRpZXIiOiJQdWJsaWMifV0sInBlcm1pdHRlZElQIjoiIiwiaWF0IjoxNjk0MDk1MzMzLCJqdGkiOiI1NzkwYmM5NC04M2Y2LTQ4YTgtODg3Yy02MmQyNDJiMTJmZDYifQ==.W9Uc6D5te5GhMcWb-ewkiuor8rpNX5S3P89LSvrewNxNffwkQ5LC47OiSIwx0NOhZ9YKSiOf0i5L2MDjA8Roezp1xkPzC1Cx6ESkuTaXtIgu0iP4mUo6pCmwywWLhDO7_fz58k6PnPAYyehQ6R8r85nEx3Wr9F9e1u-WZx2zGTFGpqvTU9jFA1d4rlcTjTK7eGuIFSbQn6goko8elKFe3GajzGy8r6NtJLMvSgxhSpftsykx-tpGyoUVVH90dTiEul927JiYvqgOsCKa4FU1tVVY3Y9t8AJByJqsOeTz64R7KIe9A8C2WB29IewjKxDkrsypFODpOQHkIbEDhZ5g8Q==';

// ── API response types ──────────────────────────────────────────

interface RaioStrike {
  /** "DD-MM-YYYY HH:MM" (UTC) */
  date: string;
  latitude: number;
  longitude: number;
  /** Peak current in kA */
  peakCurrent: number;
  /** Municipality ID (-1 = outside Galicia) */
  idCityHall: number;
  /** Age/color code for map display */
  delaySymbol: number;
}

interface RaiosResponse {
  raiosPosit: RaioStrike[];
  raiosNegat: RaioStrike[];
  numTotalRaios: number;
  numTotalRaiosGalicia: number;
  numTotalRaiosIntra: number | null;
}

// ── Cache ────────────────────────────────────────────────────────

let cache: { data: LightningStrike[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

// ── Parsing ──────────────────────────────────────────────────────

/** Parse MeteoGalicia date format "DD-MM-YYYY HH:MM" → unix ms (UTC) */
function parseRaioDate(dateStr: string): number {
  // "27-02-2026 14:35" → Date
  const [datePart, timePart] = dateStr.split(' ');
  const [day, month, year] = datePart.split('-');
  const [hours, minutes] = timePart.split(':');
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
  );
}

/** Convert raw API strikes to our normalized LightningStrike format */
function parseStrikes(
  positives: RaioStrike[],
  negatives: RaioStrike[],
  now: number,
): LightningStrike[] {
  let idCounter = 0;

  const mapStrike = (s: RaioStrike): LightningStrike => {
    const timestamp = parseRaioDate(s.date);
    return {
      id: ++idCounter,
      lat: s.latitude,
      lon: s.longitude,
      timestamp,
      peakCurrent: s.peakCurrent,
      cloudToCloud: false, // meteo2api only returns cloud-to-ground
      multiplicity: 1,     // not provided by this API
      ageMinutes: Math.round((now - timestamp) / 60_000),
    };
  };

  const strikes = [
    ...positives.map(mapStrike),
    ...negatives.map(mapStrike),
  ];

  // Sort newest first
  strikes.sort((a, b) => b.timestamp - a.timestamp);
  return strikes;
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Fetch lightning strikes from the last 24 hours.
 * Uses MeteoGalicia's `raios/lenda` endpoint.
 * Returns parsed LightningStrike[] sorted by timestamp (newest first).
 */
export async function fetchLightningStrikes(): Promise<LightningStrike[]> {
  // Return cached data if fresh enough
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return recomputeAges(cache.data);
  }

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // MeteoGalicia convention: fechaInicio = newer date, fechaFin = older date
  const params = new URLSearchParams({
    fechaInicio: now.toISOString(),
    fechaFin: yesterday.toISOString(),
  });

  const url = `${RAIOS_LENDA_URL}?${params}`;

  try {
    const res = await fetch(url, {
      headers: {
        apikey: API_KEY,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Lightning API ${res.status}`);

    const data: RaiosResponse = await res.json();
    const nowMs = Date.now();

    const strikes = parseStrikes(
      data.raiosPosit || [],
      data.raiosNegat || [],
      nowMs,
    );

    console.debug(
      `[Lightning] ${strikes.length} strikes (${data.numTotalRaiosGalicia ?? 0} in Galicia, ${data.numTotalRaiosIntra ?? 0} intra-cloud)`,
    );

    cache = { data: strikes, fetchedAt: nowMs };
    return strikes;
  } catch (err) {
    console.error('[Lightning] Fetch error:', err);
    // Return stale cache if available
    if (cache) return recomputeAges(cache.data);
    return [];
  }
}

/** Recompute ageMinutes from cached timestamps */
function recomputeAges(strikes: LightningStrike[]): LightningStrike[] {
  const now = Date.now();
  return strikes.map((s) => ({
    ...s,
    ageMinutes: Math.round((now - s.timestamp) / 60_000),
  }));
}

/**
 * Haversine distance in km between two points.
 */
export function distanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
