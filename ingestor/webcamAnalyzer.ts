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

const BEAUFORT_PROMPT = `Analyze this webcam image of a coastal/water area in Galicia, Spain.

Respond ONLY with a JSON object (no markdown, no explanation):

{
  "beaufort": <number 0-7 or -1 if night/unclear>,
  "confidence": "<high|medium|low>",
  "description": "<brief water surface description in Spanish>",
  "sky": "<clear|partly_cloudy|overcast|fog|rain|storm|night|unknown>",
  "visibility": "<good|moderate|poor>",
  "fog": <true|false>,
  "precipitation": <true|false>,
  "sea_state": "<description in Spanish>"
}

Beaufort scale for water surface:
0: Mirror-like, no ripples
1: Small ripples, no foam
2: Small wavelets, glassy crests
3: Large wavelets, scattered whitecaps
4: Small waves, frequent whitecaps
5: Moderate waves, many whitecaps, some spray
6: Large waves, extensive whitecaps, spray
7: Sea heaps up, foam streaks

Be CONSERVATIVE: if uncertain, estimate LOWER Beaufort.
If image is night/dark/unclear, return beaufort: -1, confidence: "low".`;

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

// ── Response parser (adapted from webcamVisionService.ts) ────

function parseVisionResponse(raw: string): Partial<WebcamAnalysisResult> {
  // Strip markdown code blocks if present
  let clean = raw.trim();
  const codeBlockMatch = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) clean = codeBlockMatch[1].trim();

  // Try to find JSON object in response
  const jsonMatch = clean.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // Fallback: try to find beaufort number
    const bfMatch = raw.match(/beaufort["\s:]+(\d)/i);
    return {
      beaufort: bfMatch ? parseInt(bfMatch[1]) : -1,
      confidence: 'low',
      description: 'Parsing fallback',
      sky: 'unknown',
      visibility: 'moderate',
      fog: false,
      precipitation: false,
      seaState: '',
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      beaufort: typeof parsed.beaufort === 'number' ? parsed.beaufort : -1,
      confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low',
      description: parsed.description || '',
      sky: parsed.sky || 'unknown',
      visibility: parsed.visibility || 'moderate',
      fog: !!parsed.fog,
      precipitation: !!parsed.precipitation,
      seaState: parsed.sea_state || parsed.seaState || '',
    };
  } catch {
    return {
      beaufort: -1,
      confidence: 'low',
      description: 'JSON parse error',
      sky: 'unknown',
      visibility: 'moderate',
      fog: false,
      precipitation: false,
      seaState: '',
    };
  }
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
