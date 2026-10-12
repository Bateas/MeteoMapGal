/**
 * Webcam Vision Analyzer — server-side image analysis via Ollama.
 *
 * Fetches webcam images from MeteoGalicia, sends to Ollama (moondream/smolvlm2),
 * parses Beaufort estimation + weather conditions, persists to DB.
 *
 * Called every ingestor cycle; each camera is looked at on its own schedule (webcamScheduler.ts),
 * and only when the stations around it leave room for fog. No browser APIs — pure Node.js.
 */

import { createHash } from 'crypto';
import { log } from './logger.js';
import { SERVER_USER_AGENT } from '../src/config/serverIdentity.js';
import { batchUpsertWebcamReadings, getPool } from './db.js';
import { fogCorroborated, fogWorthALook, nearbyFromRows, type NearbyRow, type NearbyWeather } from './fogAlertGate.js';

/**
 * The stations within FOG_NEAR_KM of a camera over the last 90 minutes: latest mean wind and
 * temperature/dew-point spread, and the rain of the last hour with each network's semantics.
 * Empty on error: then no fog alert is sent (fogCorroborated needs someone to check against).
 */
async function nearbyWeather(lat: number, lon: number): Promise<NearbyWeather[]> {
  try {
    const { rows } = await getPool().query<NearbyRow>(
      `SELECT r.station_id, s.latitude, s.longitude, r.time, r.wind_speed, r.temperature, r.dew_point, r.precip
         FROM readings r JOIN stations s USING (station_id)
        WHERE r.time > NOW() - INTERVAL '90 minutes'
          AND s.latitude BETWEEN $1::float8 - 0.1 AND $1::float8 + 0.1
          AND s.longitude BETWEEN $2::float8 - 0.14 AND $2::float8 + 0.14
        ORDER BY r.station_id, r.time`,
      [lat, lon],
    );
    return nearbyFromRows(rows, lat, lon, Date.now());
  } catch (err) {
    log.warn(`[Webcam] nearby stations for the fog check failed: ${(err as Error).message}`);
    return [];
  }
}
import { dispatchVisibilityAlert } from './alertDispatcher.js';
import { RIAS_WEBCAMS, type WebcamStation } from '../src/config/webcams.js';
import { planFogMessages } from './fogSendPlan.js';

// ── Configuration ────────────────────────────────────

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'moondream';
const IMAGE_MAX_SIZE = 512; // Resize images to max 512px for LLM
const API_TIMEOUT_MS = 60_000; // 60s timeout for Ollama (CPU inference is slow)

// ── Stale image detection — skip analysis if webcam image hasn't changed ──
// SHA-1 hash of the full image buffer (8 bytes is enough for signature).
// Byte-length alone had false negatives when two different images happened to
// have identical size. Hash is collision-free in practice for JPEG streams.
const lastImageHash = new Map<string, string>();
const lastImageChangeTime = new Map<string, number>();
const STALE_IMAGE_MAX_AGE_MS = 30 * 60_000; // 30min — aggressive: if unchanged half an hour, skip analysis
const MAP_CLEANUP_INTERVAL_MS = 24 * 60 * 60_000; // Cleanup old entries daily
let lastMapCleanup = Date.now();

// One-shot guard so the "vision is off" notice appears once per process.
let visionDisabledLogged = false;

// ── Per-webcam state (cache + adaptive schedule) ─────
//
// The schedule (webcamScheduler.ts) needs whether the camera saw fog and whether the
// stations around it left room for fog last time.
import { shouldAnalyzeCam } from './webcamScheduler.js';
import type { WebcamScheduleState } from './webcamScheduler.js';

interface WebcamState extends WebcamScheduleState {
  lastResult: WebcamAnalysisResult | null;
}
const webcamStates = new Map<string, WebcamState>();

// ── Beaufort prompt (adapted from webcamVisionService.ts) ────

// Prompt optimized for small vision models (moondream 1.8B).
// Asks for natural description — parser extracts structured data from text.
// Moondream describes scenes well but can't generate JSON.
const BEAUFORT_PROMPT = `Describe this coastal webcam image in detail.

Focus on:
- The water surface: is it flat/calm, or are there ripples, small waves, whitecaps, or large waves?
- Wind signs: flags, trees bending, spray, foam streaks on water?
- Sky and clouds: clear, partly cloudy, overcast, fog, rain?
- Visibility: can you see far (good), moderate, or is it hazy/foggy (poor)?
- Any boats, people, or activity on the water?

Be specific about the water surface texture — this is the most important part.`;

// ── Types ────────────────────────────────────────────

export interface WebcamAnalysisResult {
  webcamId: string;
  spotId: string | null;
  beaufort: number;
  confidence: 'high' | 'medium' | 'low';
  description: string;
  sky: string;
  visibility: string;
  fog: boolean;
  precipitation: boolean;
  seaState: string;
  provider: string;
  latencyMs: number;
  analyzedAt: Date;
}

// ── Image fetching (Node.js native) ──────────────────

/**
 * Result of fetching + preprocessing one webcam image. Drives whether we
 * call the LLM, reuse the cached verdict, or give up.
 */
type FetchOutcome =
  | { kind: 'fresh'; base64: string }
  | { kind: 'frozen' }   // the same image as last time, or one older than STALE_IMAGE_MAX_AGE_MS
  | { kind: 'failed' };  // network/decode failure

// `sharp` is loaded lazily so a missing native binary degrades to "send the
// full-size image" instead of killing the cycle.
// It IS declared in package.json, but `.npmrc` sets ignore-scripts=true, so
// the binary only lands via the explicit `npm rebuild sharp` step — a deploy
// that skips it breaks the import permanently. That used to be swallowed by an
// empty catch, which is expensive to miss: without sharp every image reaches the
// model at full resolution (slower calls, plus timeouts). Log the first failure so the degraded mode is
// attributable; the flag keeps it to one line per process instead of per image.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SharpModule = any;
let sharpModule: SharpModule | null = null;
let sharpLoadFailed = false;

async function loadSharp(): Promise<SharpModule | null> {
  if (sharpModule) return sharpModule;
  if (sharpLoadFailed) return null;
  try {
    sharpModule = (await import('sharp')).default;
    return sharpModule;
  } catch (err) {
    sharpLoadFailed = true;
    log.error(
      `[Webcam] sharp unavailable — images sent at full resolution ` +
        `(expect slower vision calls and timeouts). Run: npm rebuild sharp --foreground-scripts --ignore-scripts=false. ` +
        `Cause: ${(err as Error).message}`,
    );
    return null;
  }
}

async function fetchImage(url: string, webcamName?: string): Promise<FetchOutcome> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': SERVER_USER_AGENT },
    });
    if (!response.ok) {
      log.warn(`[Webcam] Image fetch failed: ${url} → ${response.status}`);
      return { kind: 'failed' };
    }
    // The image server says when the image was taken (MeteoGalicia sends Last-Modified). An old image
    // is frozen even right after a restart, when there is no previous hash to compare with.
    const lastModified = Date.parse(response.headers.get('last-modified') ?? '');
    if (Number.isFinite(lastModified) && Date.now() - lastModified > STALE_IMAGE_MAX_AGE_MS) {
      log.warn(`[Webcam] Image frozen ${Math.round((Date.now() - lastModified) / 60_000)}min (Last-Modified): ${url}`);
      return { kind: 'frozen' };
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    // Skip tiny images (error pages, "no disponible" placeholders)
    if (buffer.length < 5000) {
      log.warn(`[Webcam] Image too small (${buffer.length}B): ${url}`);
      return { kind: 'failed' };
    }

    // The same image as last time says nothing new: no verdict, and the last one keeps its own time.
    // (Re-analysing it stamped an old view as fresh: up to an hour of «fog» from a stuck camera.)
    const hash = createHash('sha1').update(buffer).digest('hex').slice(0, 16);
    const prevHash = lastImageHash.get(url);
    const now = Date.now();
    if (prevHash === hash) {
      const changeTime = lastImageChangeTime.get(url) ?? now;
      if (now - changeTime > STALE_IMAGE_MAX_AGE_MS) {
        const frozenMin = Math.round((now - changeTime) / 60_000);
        log.warn(`[Webcam] Image frozen ${frozenMin}min (hash ${hash} unchanged): ${url}`);
      }
      return { kind: 'frozen' };
    } else {
      lastImageHash.set(url, hash);
      lastImageChangeTime.set(url, now);
    }

    // Resize + pre-classifier. Both depend on sharp; if it is missing we fall
    // back to the raw buffer so behavior matches the original path.
    const sharp = await loadSharp();
    if (!sharp) {
      return { kind: 'fresh', base64: buffer.toString('base64') };
    }
    try {
      const resized = await sharp(buffer)
        .resize(IMAGE_MAX_SIZE, IMAGE_MAX_SIZE, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      return { kind: 'fresh', base64: resized.toString('base64') };
    } catch (err) {
      // Per-image decode failure (corrupt JPEG, unexpected format) — unlike a
      // failed import this is not permanent, so it stays a per-image warning.
      log.warn(
        `[Webcam] ${webcamName ?? '?'}: sharp could not process the image, sending it unresized — ${(err as Error).message}`,
      );
      return { kind: 'fresh', base64: buffer.toString('base64') };
    }
  } catch (err) {
    log.warn(`[Webcam] Image fetch error: ${url} — ${(err as Error).message}`);
    return { kind: 'failed' };
  }
}

// shouldAnalyzeCam now lives in webcamScheduler.ts (pure module — no `sharp`
// dependency, importable from tests). See top-of-file imports.

// ── Ollama Vision API call ───────────────────────────

async function callOllamaVision(imageBase64: string): Promise<string | null> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ollama',
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: BEAUFORT_PROMPT },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 400,
      }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      log.warn(`[Webcam] Ollama error ${response.status}: ${text.slice(0, 200)}`);
      return null;
    }

    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? null;
  } catch (err) {
    log.warn(`[Webcam] Ollama call failed: ${(err as Error).message}`);
    return null;
  }
}

// ── Response parser — extracts answers from plain text ────

/** Map water surface keywords to Beaufort number.
 * Scans the full text for the strongest wind indicator found. */
function textToBeaufort(text: string): number {
  // Ordered from strongest to weakest — first match wins
  if (/foam streak|heap|very.?rough|violent|storm/i.test(text)) return 7;
  if (/large wave|extensive whitecap|spray|breaking/i.test(text)) return 6;
  if (/moderate wave|many whitecap|white.?cap.*frequent/i.test(text)) return 5;
  if (/whitecap|white cap|white.?crest|foam/i.test(text)) return 4;
  if (/wavelet|small wave|scattered|crest/i.test(text)) return 3;
  if (/ripple|slight|gentle|light.?breeze/i.test(text)) return 2;
  if (/calm|mirror|flat|smooth|still|glass|tranquil|serene|peaceful|quiet/i.test(text)) return 0;
  // Wind indicators from flags/trees
  if (/flag.*extend|tree.*bend|strong wind/i.test(text)) return 5;
  if (/flag.*flutter|leaves.*mov/i.test(text)) return 3;
  // Boats as proxy
  if (/sail.*heel|sail.*lean/i.test(text)) return 4;
  if (/boat|sail|vessel/i.test(text)) return 2; // boats present = navigable conditions
  // Generic wave/chop
  if (/wave|chop|turbul/i.test(text)) return 3;
  return -1;
}

function parseVisionResponse(raw: string): Partial<WebcamAnalysisResult> {
  const text = raw.toLowerCase();
  const fullDesc = raw.trim().slice(0, 350);

  // Night detection
  const isNight = /\bnight\b|nighttime|dark.?sky|no.?light|illuminat.*light|lamp.*reflect/.test(text);
  if (isNight && !/during the day|daytime|sunlight|sun/.test(text)) {
    return { beaufort: -1, confidence: 'low', description: fullDesc, sky: 'night', visibility: 'moderate', fog: false, precipitation: false, seaState: '' };
  }

  // Water detection
  const hasWater = /water|sea|ocean|river|bay|waves?|coast|harbor|harbour|beach|shore|isla|island|cove|inlet/.test(text);

  // Beaufort from water surface + wind indicators
  const beaufort = textToBeaufort(text);

  // Fog / mist — strict: only real fog/mist, NOT mere haze (moondream says "hazy" for most coastal images)
  // Dawn guard: 08:00-09:00 low light causes false "hazy/misty" — suppress unless explicitly "thick fog"
  const isDawn = new Date().getHours() < 9;
  const fogStrong = /\bthick fog\b|\bdense fog\b|zero.?vis|can'?t see|barely visible/.test(text);
  const fogWeak = /\bfog\b|\bmist\b|\bfoggy\b|\bmisty\b|low.?visibility|obscur/.test(text);
  const fog = isDawn ? fogStrong : (fogStrong || fogWeak);
  const hazy = /\bhaz[ey]\b|ethereal/.test(text) && !fog;

  // Sky condition — take strongest indicator
  let sky = 'unknown';
  if (/rain|drizzle|shower|precip/.test(text)) sky = 'rain';
  else if (fog) sky = 'fog';
  else if (/overcast|grey|gray|heavy cloud|thick cloud|dark cloud/.test(text)) sky = 'overcast';
  else if (hazy) sky = 'hazy';
  else if (/cloud|partly|scatter/.test(text)) sky = 'partly_cloudy';
  else if (/clear|sun|blue sky|bright/.test(text)) sky = 'clear';

  // Visibility — hazy = moderate, actual fog = poor
  const visibility = fog ? 'poor' : hazy ? 'moderate' : /limit|reduced.?vis/.test(text) ? 'moderate' : 'good';

  // Precipitation
  const precipitation = /rain|drizzle|shower|precip/.test(text);

  // Confidence: water visible + surface detected = medium, both strong = high
  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (hasWater && beaufort >= 0) {
    // High confidence if description is detailed (100+ chars) and mentions specific features
    confidence = raw.length > 120 && /surface|wave|calm|wind|flag|ripple|whitecap|foam/.test(text) ? 'high' : 'medium';
  }

  // Sea state description — extract the most relevant sentence
  const seaMatch = text.match(/(?:water|surface|sea|wave)[^.]*\./);
  const seaState = seaMatch ? seaMatch[0].trim() : '';

  return {
    beaufort: hasWater ? (beaufort >= 0 ? beaufort : 1) : beaufort, // Water visible but no surface detail → assume Beaufort 1
    confidence,
    description: fullDesc,
    sky,
    visibility,
    fog,
    precipitation,
    seaState,
  };
}

// ── Single webcam analysis ───────────────────────────

async function analyzeWebcam(webcam: WebcamStation): Promise<WebcamAnalysisResult | null> {
  const start = Date.now();
  const fetchOutcome = await fetchImage(webcam.imageUrl, webcam.name);

  if (fetchOutcome.kind === 'failed') return null;

  // A frozen image says nothing new: no verdict. The last real one keeps its own time, so the map's
  // 30-min gate lets it expire. Re-stamping it «now» (as before 12-oct) kept a camera stuck since
  // 13:23 counting as fresh for hours: a frozen «fog» held the fog, a frozen «clear» lowered real fog.
  if (fetchOutcome.kind === 'frozen') {
    log.info(`[Webcam] ${webcam.name}: image frozen, no verdict (the last one expires on its own)`);
    return null;
  }
  // No «trivial scene» shortcut any more: the model only runs when the stations leave room for fog
  // (fogAlertGate, just before), and a uniform grey image is exactly what fog looks like. Reusing the
  // last «no fog» there hid the fog it should have looked at.

  // Otherwise run the full LLM pipeline
  const rawResponse = await callOllamaVision(fetchOutcome.base64);
  if (!rawResponse) return null;

  const parsed = parseVisionResponse(rawResponse);
  const latencyMs = Date.now() - start;

  log.info(`[Webcam] ${webcam.name}: Beaufort ${parsed.beaufort} (${parsed.confidence}) — ${latencyMs}ms`);

  return {
    webcamId: webcam.id,
    spotId: webcam.nearestSpotId ?? null,
    beaufort: parsed.beaufort ?? -1,
    confidence: (parsed.confidence as 'high' | 'medium' | 'low') ?? 'low',
    description: parsed.description ?? '',
    sky: parsed.sky ?? 'unknown',
    visibility: parsed.visibility ?? 'moderate',
    fog: parsed.fog ?? false,
    precipitation: parsed.precipitation ?? false,
    seaState: parsed.seaState ?? '',
    provider: OLLAMA_MODEL,
    latencyMs,
    analyzedAt: new Date(),
  };
}

// ── Batch analysis (all Rías webcams) ────────────────

export async function runWebcamAnalysis(cycle: number): Promise<WebcamAnalysisResult[]> {
  // Called every cycle; scheduling is per camera (shouldAnalyzeCam), so most cameras skip cheaply.

  // Periodic cleanup of stale image tracking maps (prevent unbounded growth)
  if (Date.now() - lastMapCleanup > MAP_CLEANUP_INTERVAL_MS) {
    lastImageHash.clear();
    lastImageChangeTime.clear();
    lastMapCleanup = Date.now();
  }

  // Vision is opt-in via WEBCAM_VISION_ENABLED. The variable used to exist
  // only here — not in .env.example, not in the systemd unit — so regenerating
  // the .env switched the entire webcam pipeline off with no other symptom.
  // Say so once per process; the flag keeps it out of every cycle's output.
  if (process.env.WEBCAM_VISION_ENABLED !== 'true') {
    if (!visionDisabledLogged) {
      visionDisabledLogged = true;
      log.info(
        '[Webcam] Vision analysis OFF — WEBCAM_VISION_ENABLED is not "true" ' +
          `(current value: ${process.env.WEBCAM_VISION_ENABLED ?? 'unset'}). ` +
          'No webcam readings will be produced. Set it in the ingestor .env to enable.',
      );
    }
    return [];
  }

  // Skip analysis at night — cameras show nothing useful, saves Ollama resources
  const hour = new Date().getHours();
  if (hour >= 22 || hour < 8) {
    log.info('[Webcam] Skipping vision analysis — nighttime/dawn (22h-08h)');
    return [];
  }

  // Decide which cams are due this cycle (Layer 2 — schedule). Every camera counts the cycle
  // first, so a camera is looked at every `required` cycles (webcamScheduler.ts).
  const dueCams: WebcamStation[] = [];
  for (const webcam of RIAS_WEBCAMS) {
    const state = webcamStates.get(webcam.id);
    if (state) state.cyclesSinceLastAnalysis++;
    if (shouldAnalyzeCam(state)) dueCams.push(webcam);
  }

  if (dueCams.length === 0) {
    log.info(`[Webcam] All ${RIAS_WEBCAMS.length} cameras within their interval — skipping cycle`);
    return [];
  }

  log.info(`[Webcam] Starting vision analysis (${dueCams.length}/${RIAS_WEBCAMS.length} due this cycle)...`);
  const results: WebcamAnalysisResult[] = [];
  const gates = new Map<string, ReturnType<typeof fogCorroborated>>();
  const noRoom: string[] = [];
  const GLOBAL_TIMEOUT_MS = 120_000; // 120s max — never block longer than this
  const startTime = Date.now();

  // Sequential processing — Ollama handles one image at a time
  for (const webcam of dueCams) {
    // Hard timeout: stop processing remaining cameras if we've exceeded budget
    if (Date.now() - startTime > GLOBAL_TIMEOUT_MS) {
      log.warn(`[Webcam] Global timeout (${GLOBAL_TIMEOUT_MS / 1000}s) — ${results.length}/${dueCams.length} cameras processed, skipping rest`);
      break;
    }
    const state: WebcamState = webcamStates.get(webcam.id) ?? { lastResult: null, cyclesSinceLastAnalysis: 0 };
    webcamStates.set(webcam.id, state);
    // The model only earns its ~30 s of CPU when the stations around the camera leave room for fog
    // (fogWorthALook: the drizzle of the fog itself does not close it). A fog message needs the stricter
    // fogCorroborated (no rain at all), kept here for the dispatch below.
    const near = await nearbyWeather(webcam.lat, webcam.lon);
    const look = fogWorthALook(near);
    gates.set(webcam.id, fogCorroborated(near));
    state.cyclesSinceLastAnalysis = 0;
    state.gateClosed = !look.ok;
    if (!look.ok) {
      noRoom.push(webcam.name);
      continue;
    }
    try {
      const result = await analyzeWebcam(webcam);
      if (result) {
        results.push(result);
        state.lastResult = result;
      }
    } catch (err) {
      log.warn(`[Webcam] ${webcam.name} failed: ${(err as Error).message}`);
    }
  }

  if (noRoom.length > 0) {
    log.info(`[Webcam] Sin modelo en ${noRoom.length}: las estaciones no dejan sitio a la niebla (${noRoom.join(', ')})`);
  }
  log.info(`[Webcam] Analysis complete: ${results.length}/${dueCams.length - noRoom.length} cameras processed (${((Date.now() - startTime) / 1000).toFixed(1)}s)`);

  // Persist to DB
  if (results.length > 0) {
    const rows = results.map(r => ({
      time: r.analyzedAt,
      webcamId: r.webcamId,
      spotId: r.spotId,
      beaufort: r.beaufort,
      confidence: r.confidence,
      fog: r.fog,
      visibility: r.visibility,
      sky: r.sky,
      description: r.description,
      provider: r.provider,
      latencyMs: r.latencyMs,
    }));
    const persisted = await batchUpsertWebcamReadings(rows);
    log.info(`[Webcam] Persisted ${persisted} readings to DB`);
  }

  // Check fog alerts — only real fog (not haze), only poor visibility, and only when the
  // stations around the camera agree it is fog (fogAlertGate.ts): the camera alone never sends.
  // The check was made just before the model ran. Cameras on the same mast are one site
  // (webcamFogSites.ts): one message per site, and none when a fresh camera of the site sees clear.
  const latest = new Map([...webcamStates.entries()].map(([id, st]) => [id, st.lastResult] as const));
  const byId = new Map(results.map((r) => [r.webcamId, r]));
  for (const p of planFogMessages(results, latest, gates, Date.now())) {
    if (!p.send) {
      log.info(`[Webcam] ${p.camName}: niebla de la camara no enviada — ${p.reason}`);
      continue;
    }
    await dispatchVisibilityAlert(p.webcamId, p.spotId, byId.get(p.webcamId)?.description ?? '', p.camName, p.site).catch(err =>
      log.warn(`[Webcam] Fog alert failed: ${(err as Error).message}`));
  }

  return results;
}
