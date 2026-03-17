/**
 * Webcam Vision Service — Beaufort estimation from water surface via LLM Vision.
 *
 * Architecture: spot-agnostic, provider-agnostic.
 *
 * 1. Fetch webcam image (only 'image' type webcams with direct URL)
 * 2. Send to vision LLM (LM Studio / DeepSeek / Claude — OpenAI-compatible API)
 * 3. Parse Beaufort scale response (0-7)
 * 4. Return structured result with confidence
 *
 * Provider configuration via VISION_CONFIG.
 * Development mode: LM Studio on localhost:1234
 * Production options: DeepSeek API, Ollama, Claude Haiku
 *
 * Pure service — no React. Called by useWebcamVision hook.
 */

// ── Types ────────────────────────────────────────────────

/** Weather conditions detected from webcam image */
export interface VisionWeatherConditions {
  /** Sky condition: clear, partly_cloudy, overcast, fog, rain, storm */
  sky: 'clear' | 'partly_cloudy' | 'overcast' | 'fog' | 'rain' | 'storm' | 'night' | 'unknown';
  /** Estimated visibility: good (>10km), moderate (1-10km), poor (<1km) */
  visibility: 'good' | 'moderate' | 'poor';
  /** Is precipitation visible? */
  precipitation: boolean;
  /** Is fog/mist visible? */
  fogVisible: boolean;
  /** Cloud types if identifiable */
  cloudType: string | null;
  /** Brief weather description in Spanish */
  weatherDescription: string;
}

export interface WebcamVisionResult {
  spotId: string;
  webcamLabel: string;
  beaufort: number;            // 0-7 estimated Beaufort scale
  beaufortLabel: string;       // "Calma", "Ventolina", "Flojito", etc.
  windEstimateKt: number;      // Estimated wind in knots from Beaufort
  confidence: 'high' | 'medium' | 'low';
  description: string;         // LLM's description of water surface
  /** Multi-parameter weather analysis from vision */
  weather: VisionWeatherConditions;
  rawResponse: string;         // Full LLM response for debugging
  imageUrl: string;
  analyzedAt: Date;
  providerUsed: string;        // 'lmstudio' | 'deepseek' | 'ollama' | 'claude' | 'gemini'
  latencyMs: number;
}

export interface VisionProviderConfig {
  /** Provider identifier */
  id: string;
  /** API endpoint (OpenAI-compatible) */
  baseUrl: string;
  /** Model name */
  model: string;
  /** API key (empty for local providers) */
  apiKey: string;
  /** Max tokens for response */
  maxTokens: number;
  /** Timeout in ms */
  timeout: number;
}

// ── Beaufort Scale Reference ─────────────────────────────

interface BeaufortEntry {
  force: number;
  label: string;
  labelEs: string;
  minKt: number;
  maxKt: number;
  waterDescription: string;
}

const BEAUFORT_SCALE: BeaufortEntry[] = [
  { force: 0, label: 'Calm',          labelEs: 'Calma',       minKt: 0,  maxKt: 1,  waterDescription: 'Mirror-like, glassy surface' },
  { force: 1, label: 'Light air',     labelEs: 'Ventolina',   minKt: 1,  maxKt: 3,  waterDescription: 'Ripples without crests, scale-like pattern' },
  { force: 2, label: 'Light breeze',  labelEs: 'Flojito',     minKt: 4,  maxKt: 6,  waterDescription: 'Small wavelets, crests glassy, not breaking' },
  { force: 3, label: 'Gentle breeze', labelEs: 'Flojo',       minKt: 7,  maxKt: 10, waterDescription: 'Large wavelets, crests begin to break, scattered whitecaps' },
  { force: 4, label: 'Moderate',      labelEs: 'Bonancible',  minKt: 11, maxKt: 16, waterDescription: 'Small waves with frequent whitecaps' },
  { force: 5, label: 'Fresh breeze',  labelEs: 'Fresquito',   minKt: 17, maxKt: 21, waterDescription: 'Moderate waves, many whitecaps, some spray' },
  { force: 6, label: 'Strong breeze', labelEs: 'Fresco',      minKt: 22, maxKt: 27, waterDescription: 'Large waves, extensive whitecaps, spray' },
  { force: 7, label: 'Near gale',     labelEs: 'Frescachón',  minKt: 28, maxKt: 33, waterDescription: 'Sea heaps up, streaks of foam, spray affects visibility' },
];

// ── Provider Presets ─────────────────────────────────────

export const VISION_PROVIDERS: Record<string, VisionProviderConfig> = {
  lmstudio: {
    id: 'lmstudio',
    baseUrl: 'http://localhost:1234/v1',
    model: 'local-model',  // LM Studio uses whatever is loaded
    apiKey: '',
    maxTokens: 500,
    timeout: 120_000,
  },
  deepseek: {
    id: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat', // DeepSeek VL2 supports vision via chat endpoint
    apiKey: '',              // Set via VITE_VISION_API_KEY
    maxTokens: 300,
    timeout: 15_000,
  },
  ollama: {
    id: 'ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'moondream',
    apiKey: 'ollama',       // Ollama requires non-empty key
    maxTokens: 300,
    timeout: 30_000,
  },
  gemini: {
    id: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.0-flash',  // Free tier: 15 req/min, vision support
    apiKey: '',                   // Set via VITE_VISION_API_KEY
    maxTokens: 300,
    timeout: 15_000,
  },
};

// ── Active configuration ─────────────────────────────────
// Default: LM Studio for development. Change for production.
let activeProvider: VisionProviderConfig = VISION_PROVIDERS.lmstudio;

export function setVisionProvider(provider: VisionProviderConfig): void {
  activeProvider = provider;
}

export function getVisionProvider(): VisionProviderConfig {
  return activeProvider;
}

// ── Prompt Engineering ───────────────────────────────────

const BEAUFORT_PROMPT = `You are a maritime meteorologist analyzing a webcam image from a coastal location in Galicia, Spain (Rías Baixas area).

Analyze the image for TWO things:

1. WIND (Beaufort scale 0-7) — based on water surface texture:
- 0: Mirror-like, glassy
- 1: Tiny ripples, no crests
- 2: Small wavelets, glassy crests
- 3: Wavelets breaking, scattered whitecaps (<10%)
- 4: Small waves, frequent whitecaps (10-30%)
- 5: Moderate waves, many whitecaps (30-50%)
- 6: Large waves, extensive whitecaps (>50%)
- 7: Sea heaps up, foam streaks

2. WEATHER CONDITIONS — based on sky, visibility, and atmosphere:
- sky: "clear" | "partly_cloudy" | "overcast" | "fog" | "rain" | "storm" | "night" | "unknown"
- visibility: "good" (>10km, distant features sharp) | "moderate" (1-10km, hazy) | "poor" (<1km, fog/rain)
- precipitation: true/false (rain drops, wet surfaces, or active rain visible)
- fog: true/false (fog, mist, or low cloud obscuring view)
- clouds: cloud type if visible (e.g. "cumulus", "stratus", "cumulonimbus", "cirrus") or null

Respond in this EXACT JSON format (no markdown, no code blocks):
{"beaufort": <0-7>, "confidence": "<high|medium|low>", "description": "<brief water surface description in Spanish>", "sky": "<condition>", "visibility": "<level>", "precipitation": <true/false>, "fog": <true/false>, "clouds": "<type or null>", "weather_description": "<brief weather description in Spanish>"}

Rules:
- If nighttime or image unclear: set beaufort to -1 but STILL analyze sky/visibility if possible
- Be conservative with Beaufort: when uncertain, choose lower
- For sky: if you can see stars or it's clearly dark, use "night"
- For fog: true only if actual fog/mist reduces visibility, not just clouds
- weather_description: one sentence in Spanish about overall conditions`;

// ── Core Analysis Function ───────────────────────────────

/**
 * Analyze a webcam image for Beaufort estimation.
 *
 * @param imageUrl - Direct URL to the webcam image (must be accessible)
 * @param spotId - Spot identifier for result tracking
 * @param webcamLabel - Webcam label for display
 * @param provider - Vision provider config (defaults to active provider)
 */
export async function analyzeWebcamImage(
  imageUrl: string,
  spotId: string,
  webcamLabel: string,
  provider: VisionProviderConfig = activeProvider,
): Promise<WebcamVisionResult> {
  const startTime = Date.now();

  try {
    // Fetch image and convert to base64
    const imageBase64 = await fetchImageAsBase64(imageUrl);

    // Call vision API (OpenAI-compatible format)
    const response = await callVisionAPI(imageBase64, provider);

    // Parse structured response
    const parsed = parseVisionResponse(response);
    const latencyMs = Date.now() - startTime;

    if (parsed.beaufort < 0) {
      return {
        spotId,
        webcamLabel,
        beaufort: 0,
        beaufortLabel: 'Sin datos',
        windEstimateKt: 0,
        confidence: 'low',
        description: parsed.description || 'Imagen no válida',
        weather: parsed.weather,
        rawResponse: response,
        imageUrl,
        analyzedAt: new Date(),
        providerUsed: provider.id,
        latencyMs,
      };
    }

    const entry = BEAUFORT_SCALE[parsed.beaufort] ?? BEAUFORT_SCALE[0];
    const midKt = (entry.minKt + entry.maxKt) / 2;

    return {
      spotId,
      webcamLabel,
      beaufort: parsed.beaufort,
      beaufortLabel: entry.labelEs,
      windEstimateKt: midKt,
      confidence: parsed.confidence as 'high' | 'medium' | 'low',
      description: parsed.description,
      weather: parsed.weather,
      rawResponse: response,
      imageUrl,
      analyzedAt: new Date(),
      providerUsed: provider.id,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    console.warn(`[WebcamVision] Error analyzing ${webcamLabel}:`, error);
    return {
      spotId,
      webcamLabel,
      beaufort: 0,
      beaufortLabel: 'Error',
      windEstimateKt: 0,
      confidence: 'low',
      description: `Error: ${error instanceof Error ? error.message : 'Unknown'}`,
      weather: { ...DEFAULT_WEATHER },
      rawResponse: '',
      imageUrl,
      analyzedAt: new Date(),
      providerUsed: provider.id,
      latencyMs,
    };
  }
}

/**
 * Analyze all image-type webcams for a list of spots.
 * Returns results keyed by spotId.
 */
export async function analyzeAllSpotWebcams(
  spots: { id: string; webcams?: { label: string; url: string; type: string }[] }[],
  provider?: VisionProviderConfig,
): Promise<Map<string, WebcamVisionResult>> {
  const results = new Map<string, WebcamVisionResult>();

  // Only analyze 'image' type webcams (direct URL to JPG/PNG)
  const tasks: { spotId: string; label: string; url: string }[] = [];
  for (const spot of spots) {
    if (!spot.webcams) continue;
    for (const cam of spot.webcams) {
      if (cam.type === 'image') {
        tasks.push({ spotId: spot.id, label: cam.label, url: cam.url });
      }
    }
  }

  if (tasks.length === 0) return results;

  // Sequential to avoid rate limits (one image at a time)
  for (const task of tasks) {
    const result = await analyzeWebcamImage(task.url, task.spotId, task.label, provider);
    results.set(task.spotId, result);
  }

  return results;
}

// ── Image Fetching ───────────────────────────────────────
/** Rewrite known webcam URLs to use Vite/nginx proxy (avoids CORS) */
function proxyImageUrl(url: string): string {
  if (url.includes('www.meteogalicia.gal/')) {
    return url.replace('https://www.meteogalicia.gal/', '/meteogalicia-api/');
  }
  return url;
}


async function fetchImageAsBase64(url: string): Promise<string> {
  const proxiedUrl = proxyImageUrl(url);
  const response = await fetch(proxiedUrl, {
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
  }

  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Extract base64 data after "data:image/...;base64,"
      const base64 = result.split(',')[1];
      if (!base64) reject(new Error('Failed to convert image to base64'));
      else resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ── Vision API Call ──────────────────────────────────────

async function callVisionAPI(
  imageBase64: string,
  provider: VisionProviderConfig,
): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (provider.apiKey) {
    headers['Authorization'] = `Bearer ${provider.apiKey}`;
  }

  const body = {
    model: provider.model,
    messages: [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: BEAUFORT_PROMPT },
          {
            type: 'image_url' as const,
            image_url: {
              url: `data:image/jpeg;base64,${imageBase64}`,
              detail: 'low' as const, // Save tokens — low res is enough for water texture
            },
          },
        ],
      },
    ],
    max_tokens: provider.maxTokens,
    temperature: 0.1, // Deterministic for consistent analysis
  };

  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(provider.timeout),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Vision API error: ${response.status} ${errorText.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Vision API returned empty response');
  }

  return content.trim();
}

// ── Response Parsing ─────────────────────────────────────

interface ParsedVisionResponse {
  beaufort: number;
  confidence: string;
  description: string;
  weather: VisionWeatherConditions;
}

const DEFAULT_WEATHER: VisionWeatherConditions = {
  sky: 'unknown',
  visibility: 'good',
  precipitation: false,
  fogVisible: false,
  cloudType: null,
  weatherDescription: '',
};

const VALID_SKY = new Set(['clear', 'partly_cloudy', 'overcast', 'fog', 'rain', 'storm', 'night', 'unknown']);
const VALID_VISIBILITY = new Set(['good', 'moderate', 'poor']);

function parseVisionResponse(raw: string): ParsedVisionResponse {
  try {
    let jsonStr = raw;

    // Strip markdown code blocks if present
    const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

    // Try to find JSON object in response
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];

    const parsed = JSON.parse(jsonStr);

    const sky = VALID_SKY.has(parsed.sky) ? parsed.sky : 'unknown';
    const visibility = VALID_VISIBILITY.has(parsed.visibility) ? parsed.visibility : 'good';

    return {
      beaufort: typeof parsed.beaufort === 'number' ? Math.max(-1, Math.min(7, parsed.beaufort)) : -1,
      confidence: parsed.confidence ?? 'low',
      description: parsed.description ?? '',
      weather: {
        sky,
        visibility,
        precipitation: !!parsed.precipitation,
        fogVisible: !!parsed.fog,
        cloudType: parsed.clouds || null,
        weatherDescription: parsed.weather_description ?? '',
      },
    };
  } catch {
    // Fallback: try to extract Beaufort number from text
    const numMatch = raw.match(/beaufort[:\s]*(\d)/i);
    if (numMatch) {
      return {
        beaufort: parseInt(numMatch[1]),
        confidence: 'low',
        description: raw.slice(0, 100),
        weather: { ...DEFAULT_WEATHER },
      };
    }

    return {
      beaufort: -1,
      confidence: 'low',
      description: `No se pudo parsear respuesta: ${raw.slice(0, 100)}`,
      weather: { ...DEFAULT_WEATHER },
    };
  }
}

// ── Beaufort Utilities (exported for UI) ─────────────────

export function beaufortToColor(force: number): string {
  if (force <= 0) return '#94a3b8';  // grey — calm
  if (force <= 1) return '#22d3ee';  // cyan — light air
  if (force <= 2) return '#4ade80';  // green — light breeze
  if (force <= 3) return '#bef264';  // lime — gentle
  if (force <= 4) return '#facc15';  // yellow — moderate
  if (force <= 5) return '#fb923c';  // orange — fresh
  if (force <= 6) return '#ef4444';  // red — strong
  return '#dc2626';                  // dark red — near gale
}

export function beaufortToKnots(force: number): { min: number; max: number; mid: number } {
  const entry = BEAUFORT_SCALE[Math.max(0, Math.min(7, force))] ?? BEAUFORT_SCALE[0];
  return { min: entry.minKt, max: entry.maxKt, mid: (entry.minKt + entry.maxKt) / 2 };
}

export { BEAUFORT_SCALE };
