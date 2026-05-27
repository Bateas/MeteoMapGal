/**
 * ShareSpotModal — share-as-image modal opened from SpotPopup.
 *
 * T3-5 (S136+3+4). Builds the share card on the client and offers
 * native share (mobile, Web Share API with files) or direct download
 * (desktop fallback).
 *
 * UX goals:
 *   - 1 tap from SpotPopup -> preview + share button
 *   - Preview is the actual canvas scaled down (WYSIWYG)
 *   - Native share sheet on iOS/Android, download anchor on desktop
 *   - Closeable with X or backdrop tap (matches popup pattern)
 */
import { memo, useEffect, useRef, useState, useCallback } from 'react';
import type { SpotScore } from '../../services/spotScoringEngine';
import type { SailingSpot } from '../../config/spots';
import { useSectorStore } from '../../store/sectorStore';
import {
  buildShareData,
  renderShareCanvas,
  exportAsBlob,
  shareOrDownload,
  buildShareFilename,
  buildShareText,
  type ShareResult,
} from '../../services/shareImageGenerator';

interface ShareSpotModalProps {
  spot: SailingSpot;
  score: SpotScore;
  /** Pre-formatted wave summary, e.g. "0.8m 8s SW". Surf spots only. */
  waveSummary?: string | null;
  onClose: () => void;
}

export const ShareSpotModal = memo(function ShareSpotModal({
  spot,
  score,
  waveSummary,
  onClose,
}: ShareSpotModalProps) {
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ShareResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Build the card data once per popup-open
  const data = buildShareData(spot, score, {
    sectorId: sectorId === 'rias' ? 'rias' : 'embalse',
    waveSummary: waveSummary ?? null,
  });

  // Render the canvas after mount, wait for fonts so DM Sans paints right
  useEffect(() => {
    let cancelled = false;
    const draw = async () => {
      if (typeof document !== 'undefined' && document.fonts?.ready) {
        try { await document.fonts.ready; } catch { /* font loader unavailable */ }
      }
      if (cancelled || !canvasRef.current) return;
      try {
        renderShareCanvas(canvasRef.current, data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo generar la imagen');
      }
    };
    void draw();
    return () => { cancelled = true; };
  }, [data]);

  const handleShare = useCallback(async () => {
    if (!canvasRef.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await exportAsBlob(canvasRef.current);
      const filename = buildShareFilename(spot.name, data.generatedAt);
      const text = buildShareText(data);
      const r = await shareOrDownload(blob, filename, text);
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo compartir');
    } finally {
      setBusy(false);
    }
  }, [busy, data, spot.name]);

  // Escape key closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm px-3 py-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Compartir spot"
    >
      <div
        className="relative w-full max-w-[640px] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div className="flex flex-col">
            <span className="text-[11px] uppercase tracking-wider text-slate-500">Compartir</span>
            <span className="text-sm font-bold text-slate-100">{spot.name}</span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-100 text-2xl leading-none px-2"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        {/* Canvas preview — scaled to fit container */}
        <div className="p-4 bg-slate-950/50">
          <div className="aspect-[1200/630] w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-900">
            <canvas
              ref={canvasRef}
              className="w-full h-full"
              style={{ display: 'block' }}
              aria-label="Vista previa de la imagen a compartir"
            />
          </div>

          {error && (
            <p className="mt-2 text-[12px] text-red-400">{error}</p>
          )}
          {result?.method === 'web-share' && !result.cancelled && (
            <p className="mt-2 text-[12px] text-green-400">Compartido</p>
          )}
          {result?.method === 'download' && (
            <p className="mt-2 text-[12px] text-sky-400">Imagen descargada</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-slate-800 bg-slate-900">
          <button
            onClick={onClose}
            className="px-3 py-2 text-xs text-slate-300 hover:text-slate-100 rounded border border-slate-700 hover:bg-slate-800 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleShare}
            disabled={busy || !!error}
            className="flex-1 px-3 py-2 text-xs font-semibold rounded bg-sky-500/20 border border-sky-500/50 text-sky-200 hover:bg-sky-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Generando…' : (typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' ? 'Compartir' : 'Descargar PNG')}
          </button>
        </div>
      </div>
    </div>
  );
});
