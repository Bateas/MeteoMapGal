/**
 * Share image generator — renders a 1200x630 PNG card for social sharing.
 *
 * T3-5 (S136+3+4). User-facing feature: tap Compartir on a spot popup
 * generates a polished image with verdict, wind, marine extras and
 * MeteoMapGal branding. Goal: WhatsApp / Telegram / X friendly.
 *
 * Architecture:
 *   - buildShareData(spot, score, extras) flattens the popup state into
 *     a ShareCardData shape (testable without DOM).
 *   - renderShareCanvas(data) paints into an HTMLCanvasElement using
 *     plain 2D context API. No html2canvas / dom-to-image dependency.
 *   - exportAsBlob(canvas) wraps canvas.toBlob() in a Promise.
 *   - shareOrDownload(blob, filename, shareText) tries Web Share API
 *     (file sharing), falls back to anchor download.
 *
 * Dimensions: 1200x630 is the Open Graph standard.
 */

import type { SpotScore, SpotVerdict } from './spotScoringEngine';
import type { SailingSpot } from '../config/spots';
import { VERDICT_STYLE, VERDICT_HEX } from '../config/verdictStyles';

// ── Data shape ──────────────────────────────────────────────

export interface ShareCardData {
  spotId: string;
  spotName: string;
  sectorId: 'embalse' | 'rias';
  sectorLabel: 'Rias Baixas' | 'Embalse de Castrelo';
  verdict: SpotVerdict;
  verdictLabel: string;
  verdictColor: string;
  windKt: number | null;
  windDirCardinal: string | null;
  gustKt: number | null;
  airTempC: number | null;
  waterTempC: number | null;
  waveSummary: string | null;
  summary: string | null;
  generatedAt: Date;
}

// ── Helpers ─────────────────────────────────────────────────

function degToCardinal(deg: number | null | undefined): string | null {
  if (deg == null || !Number.isFinite(deg)) return null;
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const ix = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
  return dirs[ix];
}

function formatTimeES(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
                  'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${pad(date.getDate())} ${months[date.getMonth()]} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ── Pure data builder (testable without DOM) ────────────────

export function buildShareData(
  spot: SailingSpot,
  score: SpotScore,
  extras: {
    sectorId: 'embalse' | 'rias';
    waveSummary?: string | null;
  } = { sectorId: 'rias' },
): ShareCardData {
  const verdict = score.verdict;
  const verdictLabel = VERDICT_STYLE[verdict]?.label ?? '-';
  const verdictColor = VERDICT_HEX[verdict] ?? '#94a3b8';
  const windKt = score.effectiveWindKt ?? score.wind?.avgSpeedKt ?? null;
  const dir = degToCardinal(score.windDirDeg);
  const gust = score.wind?.maxGustKt ?? null;

  return {
    spotId: spot.id,
    spotName: spot.name,
    sectorId: extras.sectorId,
    sectorLabel: extras.sectorId === 'rias' ? 'Rias Baixas' : 'Embalse de Castrelo',
    verdict,
    verdictLabel,
    verdictColor,
    windKt: windKt != null ? Math.round(windKt) : null,
    windDirCardinal: dir,
    gustKt: gust != null ? Math.round(gust) : null,
    airTempC: score.airTemp != null ? Math.round(score.airTemp * 10) / 10 : null,
    waterTempC: score.waterTemp != null ? Math.round(score.waterTemp * 10) / 10 : null,
    waveSummary: extras.waveSummary ?? null,
    summary: score.summary ?? null,
    generatedAt: new Date(),
  };
}

// ── Canvas renderer ─────────────────────────────────────────

const CARD_W = 1200;
const CARD_H = 630;
const PAD = 60;

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = '...';
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (ctx.measureText(text.slice(0, mid) + ellipsis).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + ellipsis;
}

export function renderShareCanvas(canvas: HTMLCanvasElement, data: ShareCardData): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context not available');

  canvas.width = CARD_W;
  canvas.height = CARD_H;

  const grad = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  grad.addColorStop(0, hexWithAlpha(data.verdictColor, 0.18));
  grad.addColorStop(0.6, '#0f172a');
  grad.addColorStop(1, '#020617');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  ctx.fillStyle = data.verdictColor;
  ctx.fillRect(0, 0, 14, CARD_H);

  ctx.font = '500 24px "DM Sans", system-ui, sans-serif';
  const sectorText = data.sectorLabel;
  const sectorW = ctx.measureText(sectorText).width + 32;
  ctx.fillStyle = 'rgba(148, 163, 184, 0.18)';
  roundRect(ctx, CARD_W - PAD - sectorW, 48, sectorW, 44, 22);
  ctx.fill();
  ctx.fillStyle = '#cbd5e1';
  ctx.textBaseline = 'middle';
  ctx.fillText(sectorText, CARD_W - PAD - sectorW + 16, 70);

  ctx.textBaseline = 'alphabetic';
  ctx.font = '700 84px "DM Sans", system-ui, sans-serif';
  ctx.fillStyle = '#f8fafc';
  const nameMaxWidth = CARD_W - PAD * 2 - sectorW - 24;
  const fittedName = fitText(ctx, data.spotName, nameMaxWidth);
  ctx.fillText(fittedName, PAD, 160);

  ctx.font = '700 56px "DM Sans", system-ui, sans-serif';
  const verdictText = data.verdictLabel.toUpperCase();
  const verdictW = ctx.measureText(verdictText).width + 48;
  ctx.fillStyle = hexWithAlpha(data.verdictColor, 0.18);
  roundRect(ctx, PAD, 200, verdictW, 80, 12);
  ctx.fill();
  ctx.strokeStyle = data.verdictColor;
  ctx.lineWidth = 2;
  roundRect(ctx, PAD, 200, verdictW, 80, 12);
  ctx.stroke();
  ctx.fillStyle = data.verdictColor;
  ctx.textBaseline = 'middle';
  ctx.fillText(verdictText, PAD + 24, 242);

  ctx.textBaseline = 'alphabetic';
  ctx.font = '700 96px "DM Sans", system-ui, sans-serif';
  ctx.fillStyle = '#f8fafc';
  const windText = data.windKt != null ? `${data.windKt} kt` : '- kt';
  ctx.fillText(windText, PAD, 400);

  ctx.font = '500 44px "DM Sans", system-ui, sans-serif';
  ctx.fillStyle = '#94a3b8';
  const subParts: string[] = [];
  if (data.windDirCardinal) subParts.push(data.windDirCardinal);
  if (data.gustKt != null) subParts.push(`rachas ${data.gustKt} kt`);
  if (subParts.length > 0) ctx.fillText(subParts.join(' - '), PAD, 460);

  ctx.font = '500 32px "DM Sans", system-ui, sans-serif';
  ctx.fillStyle = '#cbd5e1';
  const lines: string[] = [];
  if (data.airTempC != null) lines.push(`Aire ${data.airTempC.toFixed(1)}C`);
  if (data.waterTempC != null) lines.push(`Mar ${data.waterTempC.toFixed(1)}C`);
  if (data.waveSummary) lines.push(`Olas ${data.waveSummary}`);
  if (lines.length > 0) ctx.fillText(fitText(ctx, lines.join('   -   '), CARD_W - PAD * 2), PAD, 520);

  ctx.font = '600 28px "DM Sans", system-ui, sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.fillText('MeteoMapGal', PAD, CARD_H - 36);
  ctx.font = '400 24px "DM Sans", system-ui, sans-serif';
  ctx.fillStyle = '#475569';
  const footerRight = `meteomapgal.navia3d.com  -  ${formatTimeES(data.generatedAt)}`;
  const footerW = ctx.measureText(footerRight).width;
  ctx.fillText(footerRight, CARD_W - PAD - footerW, CARD_H - 36);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function hexWithAlpha(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ── Export + share helpers ──────────────────────────────────

export async function exportAsBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas toBlob produced null'));
    }, 'image/png');
  });
}

export interface ShareResult {
  method: 'web-share' | 'download';
  cancelled?: boolean;
}

export async function shareOrDownload(
  blob: Blob,
  filename: string,
  text: string,
): Promise<ShareResult> {
  const file = new File([blob], filename, { type: 'image/png' });

  if (typeof navigator !== 'undefined'
      && typeof navigator.canShare === 'function'
      && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        title: 'MeteoMapGal',
        text,
        files: [file],
      });
      return { method: 'web-share' };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { method: 'web-share', cancelled: true };
      }
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { method: 'download' };
}

export function buildShareFilename(spotName: string, when: Date): string {
  const slug = spotName.toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}-${pad(when.getHours())}${pad(when.getMinutes())}`;
  return `${slug || 'spot'}-${stamp}.png`;
}

/**
 * Build a deep-link URL that points to this spot on this sector.
 * Future: SpotStore + SectorStore read `?sector=` and `?spot=` on mount
 * and pre-select. Today the params are visible but ignored — the receiver
 * still lands on the right sector if it matches their default.
 */
export function buildShareUrl(data: ShareCardData): string {
  const params = new URLSearchParams();
  params.set('sector', data.sectorId);
  params.set('spot', data.spotId);
  return `https://meteomapgal.navia3d.com/?${params.toString()}`;
}

export function buildShareText(data: ShareCardData): string {
  // Line 1: spot — verdict · wind · waves
  const line1Bits: string[] = [`${data.spotName} — ${data.verdictLabel}`];
  if (data.windKt != null) {
    line1Bits.push(`${data.windKt}kt${data.windDirCardinal ? ' ' + data.windDirCardinal : ''}`);
  }
  if (data.gustKt != null && data.windKt != null && data.gustKt >= data.windKt + 5) {
    line1Bits.push(`rachas ${data.gustKt}kt`);
  }
  if (data.waveSummary) line1Bits.push(`olas ${data.waveSummary}`);

  // Line 2: water / air bonus
  const extras: string[] = [];
  if (data.waterTempC != null) extras.push(`Mar ${data.waterTempC.toFixed(1)}°C`);
  if (data.airTempC != null) extras.push(`Aire ${data.airTempC.toFixed(1)}°C`);

  // Line 3: deep-link URL
  const url = buildShareUrl(data);

  const lines = [line1Bits.join(' · ')];
  if (extras.length > 0) lines.push(extras.join(' · '));
  lines.push(`MeteoMapGal: ${url}`);
  return lines.join('\n');
}
