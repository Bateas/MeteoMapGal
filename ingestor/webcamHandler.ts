import type http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { log } from './logger.js';
import { clientIpOf } from './requestGuards.js';
import { corsHeaders } from './httpHelpers.js';

const WEBCAM_DIR = process.env.WEBCAM_DIR || '/var/www/meteomapgal/webcam';
const WEBCAM_TOKEN = process.env.WEBCAM_TOKEN || '';
if (!WEBCAM_TOKEN) log.warn('[Webcam] WEBCAM_TOKEN not set — uploads disabled (fail-closed)');

// Rate limit for webcam uploads: max 20 per hour per IP
const webcamUploadCounts = new Map<string, { count: number; resetAt: number }>();
const WEBCAM_UPLOAD_MAX = 20;
const WEBCAM_UPLOAD_WINDOW_MS = 60 * 60_000; // 1 hour

export async function handleWebcamUpload(
  spotId: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  origin?: string
): Promise<void> {
  // Server-side rate limit per IP
  const ip = clientIpOf(req.headers, req.socket.remoteAddress);
  const now = Date.now();
  const bucket = webcamUploadCounts.get(ip);
  if (bucket && now < bucket.resetAt) {
    if (bucket.count >= WEBCAM_UPLOAD_MAX) {
      res.writeHead(429, corsHeaders(origin));
      res.end(JSON.stringify({ error: 'Rate limit exceeded (20/hour)' }));
      return;
    }
    bucket.count++;
  } else {
    webcamUploadCounts.set(ip, { count: 1, resetAt: now + WEBCAM_UPLOAD_WINDOW_MS });
  }

  // Fail-closed: an unset WEBCAM_TOKEN must disable uploads, not skip auth.
  if (!WEBCAM_TOKEN) {
    res.writeHead(503, corsHeaders(origin));
    res.end(JSON.stringify({ error: 'Upload disabled' }));
    return;
  }

  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== WEBCAM_TOKEN) {
    res.writeHead(401, corsHeaders(origin));
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  if (!/^[a-z0-9-]+$/.test(spotId)) {
    res.writeHead(400, corsHeaders(origin));
    res.end(JSON.stringify({ error: 'Invalid spot id' }));
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks);

  if (body.length < 100) {
    res.writeHead(400, corsHeaders(origin));
    res.end(JSON.stringify({ error: 'Empty image' }));
    return;
  }

  try {
    await fs.promises.mkdir(WEBCAM_DIR, { recursive: true });
    const imgPath  = path.join(WEBCAM_DIR, `${spotId}.jpg`);
    const metaPath = path.join(WEBCAM_DIR, `${spotId}.json`);
    await fs.promises.writeFile(imgPath, body);
    await fs.promises.writeFile(metaPath, JSON.stringify({ ts: new Date().toISOString(), bytes: body.length }));
    log.info(`[Webcam] ${spotId} ${(body.length / 1024).toFixed(0)}KB`);
    res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    log.error('[Webcam] Save error:', (err as Error).message);
    res.writeHead(500, corsHeaders(origin));
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}
