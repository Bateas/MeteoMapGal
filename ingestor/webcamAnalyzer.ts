/**
 * Webcam Vision Analyzer — server-side image analysis via Ollama.
 *
 * Fetches webcam images from MeteoGalicia, sends to Ollama (moondream/smolvlm2),
 * parses Beaufort estimation + weather conditions, persists to DB.
 *
 * Runs every 3 ingestor cycles (~15min). No browser APIs — pure Node.js.
 */

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

async function fetchImageAsBase64(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'MeteoMapGal-Ingestor/1.0' },
    });
    if (!response.ok) {
      log.warn(`[Webcam] Image fetch failed: ${url} → ${response.status}`);
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    // Skip tiny images (error pages, "no disponible" placeholders)
    if (buffer.length < 5000) {
      log.warn(`[Webcam] Image too small (${buffer.length}B): ${url}`);
      return null;
    }

    // Resize with sharp if available, otherwise use raw
    try {
      const sharp = (await import('sharp')).default;
      const resized = await sharp(buffer)
        .resize(IMAGE_MAX_SIZE, IMAGE_MAX_SIZE, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      return resized.toString('base64');
    } catch {
      // sharp not installed — use original image
      return buffer.toString('base64');
    }
  } catch (err) {
    log.warn(`[Webcam] Image fetch error: ${url} — ${(err as Error).message}`);
    return null;
  }
}

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
  const fog = /\bfog\b|\bmist\b|\bfoggy\b|\bmisty\b|low.?visibility|obscur|can'?t see|barely visible|zero.?vis/.test(text);
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

  const imageBase64 = await fetchImageAsBase64(webcam.imageUrl);
  if (!imageBase64) return null;

  const rawResponse = await callOllamaVision(imageBase64);
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
  // Only run every N cycles
  if (cycle % WEBCAM_ANALYSIS_INTERVAL !== 0) return [];

  if (process.env.WEBCAM_VISION_ENABLED !== 'true') return [];

  // Skip analysis at night — cameras show nothing useful, saves Ollama resources
  const hour = new Date().getHours();
  if (hour >= 22 || hour < 7) {
    log.info('[Webcam] Skipping vision analysis — nighttime (22h-07h)');
    return [];
  }

  log.info(`[Webcam] Starting vision analysis (${RIAS_WEBCAMS.length} cameras)...`);
  const results: WebcamAnalysisResult[] = [];

  // Sequential processing — Ollama handles one image at a time
  for (const webcam of RIAS_WEBCAMS) {
    try {
      const result = await analyzeWebcam(webcam);
      if (result) results.push(result);
    } catch (err) {
      log.warn(`[Webcam] ${webcam.name} failed: ${(err as Error).message}`);
    }
  }

  log.info(`[Webcam] Analysis complete: ${results.length}/${RIAS_WEBCAMS.length} cameras processed`);

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
