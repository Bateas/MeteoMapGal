/**
 * Webcam Vision Analyzer — server-side image analysis via Ollama.
 *
 * Fetches webcam images from MeteoGalicia, sends to Ollama (moondream/smolvlm2),
 * parses Beaufort estimation + weather conditions, persists to DB.
 *
 * Runs every 3 ingestor cycles (~15min). No browser APIs — pure Node.js.
 */

import { createHash } from 'crypto';
import { log } from './logger.js';
import { batchUpsertWebcamReadings } from './db.js';
import { dispatchVisibilityAlert } from './alertDispatcher.js';
import { RIAS_WEBCAMS, type WebcamStation } from '../src/config/webcams.js';

// ── Configuration ────────────────────────────────────

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'moondream';
const WEBCAM_ANALYSIS_INTERVAL = 3; // Run every N ingestor cycles (3 × 5min = 15min)
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

// ── Per-webcam state (cache + adaptive schedule) ─────
//
// Layer 1 (pre-classifier) needs the last result to reuse when the image is
// trivial (calm water / uniform sky) and Beaufort was already 0-1. Layer 2
// (adaptive schedule, see webcamScheduler.ts) needs the last few Beaufort
// readings to decide if a camera is "stable calm" or has an "active event".
import { shouldAnalyzeCam } from './webcamScheduler.js';
import type { WebcamScheduleState } from './webcamScheduler.js';

interface WebcamState extends WebcamScheduleState {
  lastResult: WebcamAnalysisResult | null;
}
const webcamStates = new Map<string, WebcamState>();

// ── Pre-classifier thresholds (Layer 1) ──────────────
// Computed on a 64x64 grayscale downsample. variance < 200 ≈ smooth surface
// (calm water OR overcast sky); edgeRate < 0.05 ≈ very few sharp transitions
// (almost no waves/whitecaps/spray). Both true AND last beaufort ≤ 1 → safe
// to skip the LLM and reuse last verdict, dropping confidence to 'low'.
const PRECLASSIFIER_VARIANCE_THRESHOLD = 200;
const PRECLASSIFIER_EDGE_RATE_THRESHOLD = 0.05;

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
  | { kind: 'fresh'; base64: string; isTrivial: boolean }
  | { kind: 'frozen' }   // image unchanged for >STALE_IMAGE_MAX_AGE_MS
  | { kind: 'failed' };  // network/decode failure

async function fetchImage(url: string, webcamName?: string): Promise<FetchOutcome> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'MeteoMapGal-Ingestor/1.0' },
    });
    if (!response.ok) {
      log.warn(`[Webcam] Image fetch failed: ${url} → ${response.status}`);
      return { kind: 'failed' };
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    // Skip tiny images (error pages, "no disponible" placeholders)
    if (buffer.length < 5000) {
      log.warn(`[Webcam] Image too small (${buffer.length}B): ${url}`);
      return { kind: 'failed' };
    }

    // Stale image detection — hash the buffer, skip if unchanged for >30min.
    const hash = createHash('sha1').update(buffer).digest('hex').slice(0, 16);
    const prevHash = lastImageHash.get(url);
    const now = Date.now();
    if (prevHash === hash) {
      const changeTime = lastImageChangeTime.get(url) ?? now;
      if (now - changeTime > STALE_IMAGE_MAX_AGE_MS) {
        const frozenMin = Math.round((now - changeTime) / 60_000);
        log.warn(`[Webcam] Image frozen ${frozenMin}min (hash ${hash} unchanged): ${url}`);
        return { kind: 'frozen' };
      }
    } else {
      lastImageHash.set(url, hash);
      lastImageChangeTime.set(url, now);
    }

    // Resize + pre-classifier. Both depend on sharp; if missing we fall back
    // to raw buffer + isTrivial=false so behavior matches pre-S134.
    try {
      const sharp = (await import('sharp')).default;
      const resized = await sharp(buffer)
        .resize(IMAGE_MAX_SIZE, IMAGE_MAX_SIZE, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      const isTrivial = await isImageTrivial(buffer, sharp, webcamName);
      return { kind: 'fresh', base64: resized.toString('base64'), isTrivial };
    } catch {
      return { kind: 'fresh', base64: buffer.toString('base64'), isTrivial: false };
    }
  } catch (err) {
    log.warn(`[Webcam] Image fetch error: ${url} — ${(err as Error).message}`);
    return { kind: 'failed' };
  }
}

/**
 * Pre-classifier (Layer 1). Computes luma variance + Sobel-ish edge rate on a
 * 64×64 grayscale downsample (~4096 pixels — 1-2ms). "Trivial" = low texture
 * AND few sharp transitions: typically calm water or fully-overcast sky.
 *
 * Returns true only when BOTH metrics agree. Single false negative is cheap
 * (we still call the LLM); single false positive (skip + reuse) is what we
 * want to minimize, so thresholds are conservative.
 */
async function isImageTrivial(
  buffer: Buffer,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sharp: any,
  webcamName?: string,
): Promise<boolean> {
  try {
    const { data, info } = await sharp(buffer)
      .resize(64, 64, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Variance of luma
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    const mean = sum / data.length;
    let varSum = 0;
    for (let i = 0; i < data.length; i++) {
      const d = data[i] - mean;
      varSum += d * d;
    }
    const variance = varSum / data.length;

    // Edge rate — count adjacent pixels with |Δluma| > 20 (Sobel-ish)
    let edges = 0;
    const w = info.width;
    for (let y = 0; y < info.height - 1; y++) {
      for (let x = 0; x < w - 1; x++) {
        const i = y * w + x;
        const dx = Math.abs(data[i] - data[i + 1]);
        const dy = Math.abs(data[i] - data[i + w]);
        if (dx > 20 || dy > 20) edges++;
      }
    }
    const edgeRate = edges / data.length;

    const trivial =
      variance < PRECLASSIFIER_VARIANCE_THRESHOLD &&
      edgeRate < PRECLASSIFIER_EDGE_RATE_THRESHOLD;

    // Always log the metrics so thresholds can be calibrated against real
    // imagery. Cost is ~1 line per cam per cycle; cheap.
    log.info(
      `[Webcam] ${webcamName ?? '?'} stats: variance=${variance.toFixed(0)} ` +
      `edgeRate=${edgeRate.toFixed(3)} → ${trivial ? 'TRIVIAL' : 'non-trivial'}`,
    );

    return trivial;
  } catch {
    // Pre-classifier never blocks the pipeline — on error, behave as if not trivial
    return false;
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

/**
 * Reuse the previous result while attenuating confidence. Used when:
 *   - The image is byte-identical and we already have a verdict (frozen).
 *   - The pre-classifier flagged the scene as trivial AND last beaufort ≤ 1
 *     (calm-on-calm — no point burning ~30s of CPU on the LLM).
 */
function reuseLastResult(
  prev: WebcamAnalysisResult,
  reason: 'frozen' | 'trivial',
): WebcamAnalysisResult {
  return {
    ...prev,
    confidence: 'low',
    provider: `${prev.provider}-${reason}`,
    latencyMs: 0,
    analyzedAt: new Date(),
  };
}

async function analyzeWebcam(webcam: WebcamStation): Promise<WebcamAnalysisResult | null> {
  const start = Date.now();
  const state = webcamStates.get(webcam.id);
  const prev = state?.lastResult ?? null;

  const fetchOutcome = await fetchImage(webcam.imageUrl, webcam.name);

  if (fetchOutcome.kind === 'failed') return null;

  if (fetchOutcome.kind === 'frozen') {
    if (prev) {
      log.info(`[Webcam] ${webcam.name}: reusing last verdict (image frozen)`);
      return reuseLastResult(prev, 'frozen');
    }
    return null; // no prev to reuse — first time + frozen
  }

  // Layer 1 short-circuit: trivial scene + last reading was calm → reuse
  if (
    fetchOutcome.isTrivial &&
    prev &&
    prev.beaufort >= 0 &&
    prev.beaufort <= 1
  ) {
    log.info(`[Webcam] ${webcam.name}: pre-classifier skip (trivial, prev Beaufort ${prev.beaufort})`);
    return reuseLastResult(prev, 'trivial');
  }

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
  // Pre-S134 the function ran every WEBCAM_ANALYSIS_INTERVAL cycles for ALL
  // cameras at once. Now scheduling is per-cam (see shouldAnalyzeCam), so
  // this is called every cycle but most cams skip cheaply. The constant is
  // kept as the *default* cadence inside shouldAnalyzeCam (3 cycles).
  void WEBCAM_ANALYSIS_INTERVAL;

  // Periodic cleanup of stale image tracking maps (prevent unbounded growth)
  if (Date.now() - lastMapCleanup > MAP_CLEANUP_INTERVAL_MS) {
    lastImageHash.clear();
    lastImageChangeTime.clear();
    lastMapCleanup = Date.now();
  }

  if (process.env.WEBCAM_VISION_ENABLED !== 'true') return [];

  // Skip analysis at night — cameras show nothing useful, saves Ollama resources
  const hour = new Date().getHours();
  if (hour >= 22 || hour < 8) {
    log.info('[Webcam] Skipping vision analysis — nighttime/dawn (22h-08h)');
    return [];
  }

  // Decide which cams are due this cycle (Layer 2 — adaptive schedule)
  const dueCams: WebcamStation[] = [];
  for (const webcam of RIAS_WEBCAMS) {
    const state = webcamStates.get(webcam.id);
    if (shouldAnalyzeCam(state)) {
      dueCams.push(webcam);
    } else if (state) {
      state.cyclesSinceLastAnalysis++;
    }
  }

  if (dueCams.length === 0) {
    log.info(`[Webcam] All ${RIAS_WEBCAMS.length} cameras within their adaptive interval — skipping cycle`);
    return [];
  }

  log.info(`[Webcam] Starting vision analysis (${dueCams.length}/${RIAS_WEBCAMS.length} due this cycle)...`);
  const results: WebcamAnalysisResult[] = [];
  const GLOBAL_TIMEOUT_MS = 120_000; // 120s max — never block longer than this
  const startTime = Date.now();

  // Sequential processing — Ollama handles one image at a time
  for (const webcam of dueCams) {
    // Hard timeout: stop processing remaining cameras if we've exceeded budget
    if (Date.now() - startTime > GLOBAL_TIMEOUT_MS) {
      log.warn(`[Webcam] Global timeout (${GLOBAL_TIMEOUT_MS / 1000}s) — ${results.length}/${dueCams.length} cameras processed, skipping rest`);
      break;
    }
    try {
      const result = await analyzeWebcam(webcam);
      if (result) {
        results.push(result);
        // Update per-cam state (cache + history) for next cycle's scheduler
        const state = webcamStates.get(webcam.id) ?? {
          lastResult: null,
          beaufortHistory: [],
          cyclesSinceLastAnalysis: 0,
        };
        state.lastResult = result;
        state.beaufortHistory = [result.beaufort, ...state.beaufortHistory].slice(0, 5);
        state.cyclesSinceLastAnalysis = 0;
        webcamStates.set(webcam.id, state);
      }
    } catch (err) {
      log.warn(`[Webcam] ${webcam.name} failed: ${(err as Error).message}`);
    }
  }

  log.info(`[Webcam] Analysis complete: ${results.length}/${dueCams.length} cameras processed (${((Date.now() - startTime) / 1000).toFixed(1)}s)`);

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

  // Check fog alerts — only real fog (not haze), and only poor visibility
  for (const r of results) {
    if (r.fog && r.visibility === 'poor' && r.spotId) {
      const cam = RIAS_WEBCAMS.find(w => w.id === r.webcamId);
      const camName = cam?.name ?? r.webcamId;
      await dispatchVisibilityAlert(r.webcamId, r.spotId, r.description, camName, r.beaufort).catch(err =>
        log.warn(`[Webcam] Fog alert failed: ${(err as Error).message}`));
    }
  }

  return results;
}
