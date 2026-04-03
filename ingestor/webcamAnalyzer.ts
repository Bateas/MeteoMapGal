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

// Simple prompt for small vision models (moondream 1.8B).
// Complex JSON prompts confuse small models — use plain text Q&A instead.
const BEAUFORT_PROMPT = `Look at this webcam image. Answer these 5 questions with ONE word or number each:

1. Is it daytime or nighttime? (day/night)
2. Can you see water or sea? (yes/no)
3. How is the water surface? (calm/ripples/wavelets/whitecaps/rough/very_rough)
4. Is there fog or mist? (yes/no)
5. Is the sky clear, cloudy or overcast? (clear/cloudy/overcast/fog/rain)`;

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

/** Map water surface description to Beaufort number */
function waterToBeaufort(water: string): number {
  const w = water.toLowerCase();
  if (w.includes('very_rough') || w.includes('very rough') || w.includes('heap')) return 6;
  if (w.includes('rough') || w.includes('spray')) return 5;
  if (w.includes('whitecap') || w.includes('white cap') || w.includes('foam')) return 4;
  if (w.includes('wavelet') || w.includes('small wave')) return 3;
  if (w.includes('ripple') || w.includes('slight')) return 2;
  if (w.includes('calm') || w.includes('mirror') || w.includes('flat') || w.includes('smooth') || w.includes('still')) return 0;
  // Generic wave mentions
  if (w.includes('wave') || w.includes('chop')) return 3;
  return -1; // Unknown
}

function parseVisionResponse(raw: string): Partial<WebcamAnalysisResult> {
  const text = raw.toLowerCase();

  // 1. Day or night?
  const isNight = text.includes('night') || text.includes('dark') || text.includes('nighttime');
  if (isNight) {
    return { beaufort: -1, confidence: 'low', description: 'Night/dark', sky: 'night', visibility: 'moderate', fog: false, precipitation: false, seaState: '' };
  }

  // 2. Water visible?
  const hasWater = text.includes('water') || text.includes('sea') || text.includes('ocean') || text.includes('river') || text.includes('bay') || text.includes('waves') || text.includes('coast');

  // 3. Water surface → Beaufort
  let beaufort = -1;
  // Try to extract from numbered answers
  const surfaceMatch = text.match(/(?:3|water surface|surface)[.:\s]*([\w_]+)/i) ||
    text.match(/(calm|ripples?|wavelets?|whitecaps?|rough|very.?rough|smooth|flat|choppy|waves?|foam)/i);
  if (surfaceMatch) {
    beaufort = waterToBeaufort(surfaceMatch[1] || surfaceMatch[0]);
  } else if (hasWater) {
    beaufort = 1; // Water visible but surface unclear → assume light
  }

  // 4. Fog?
  const fog = text.includes('fog') || text.includes('mist') || text.includes('haz');

  // 5. Sky condition
  let sky = 'unknown';
  if (text.includes('rain')) sky = 'rain';
  else if (fog) sky = 'fog';
  else if (text.includes('overcast') || text.includes('grey') || text.includes('gray')) sky = 'overcast';
  else if (text.includes('cloud') || text.includes('partly')) sky = 'partly_cloudy';
  else if (text.includes('clear') || text.includes('sun') || text.includes('blue sky')) sky = 'clear';

  // Visibility from fog
  const visibility = fog ? 'poor' : (sky === 'overcast' ? 'moderate' : 'good');

  // Confidence based on how much info we extracted
  const confidence = beaufort >= 0 && hasWater ? 'medium' : 'low';

  // Build description from raw text (first 100 chars)
  const description = raw.trim().slice(0, 150);

  return {
    beaufort,
    confidence: confidence as 'high' | 'medium' | 'low',
    description,
    sky,
    visibility,
    fog,
    precipitation: text.includes('rain') || text.includes('drizzle'),
    seaState: surfaceMatch ? surfaceMatch[0] : '',
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

  // Check fog alerts — dispatch if fog detected with poor visibility
  for (const r of results) {
    if (r.fog && r.visibility === 'poor' && r.spotId) {
      await dispatchVisibilityAlert(r.webcamId, r.spotId, r.description).catch(err =>
        log.warn(`[Webcam] Fog alert failed: ${(err as Error).message}`));
    }
  }

  return results;
}
