/**
 * ShareSpotModal — share-as-image modal opened from SpotPopup.
 *
 * Builds the share card on the client and offers
 * native share (mobile, Web Share API with files) or direct download
 * (desktop fallback).
 *
 * UX goals:
 *   - 1 tap from SpotPopup -> preview + share button
 *   - Preview is the actual canvas scaled down (WYSIWYG)
 *   - Native share sheet on iOS/Android, download anchor on desktop
 *   - Closeable with X or backdrop tap (matches popup pattern)
 */
import { WeatherIcon } from '../icons/WeatherIcons';
import { memo, useEffect, useRef, useState, useCallback } from 'react';
import type { SpotScore } from '../../services/spotScoringEngine';
import type { SailingSpot } from '../../config/spots';
import { useSectorStore } from '../../store/sectorStore';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useBackCloses } from '../../hooks/useBackCloses';
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

  // A modal takes the focus (to its close button), keeps Tab inside and gives it back on close; the phone's
  // back button closes it instead of leaving the app (P3 review, 19-nov: it opened with the focus left behind).
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  useBackCloses(true, onClose, 'share');

  // Escape key closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      ref={trapRef}
      className="fixed inset-0 z-[60] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gf-share-title"
    >
      <div className="gc-scrim" onClick={onClose} />
      <div className="g-theme gc-dialog" style={{ margin: 16, maxWidth: 640 }}>
        <div className="gc-dialog-head">
          <h2 id="gf-share-title">Compartir {spot.name}</h2>
          <button type="button" onClick={onClose} className="gc-btn gc-btn--plain gc-btn--icon" aria-label="Cerrar">
            <WeatherIcon id="x" size={16} />
          </button>
        </div>

        <div className="gc-dialog-body">
          <div style={{ aspectRatio: '1200 / 630', width: '100%', overflow: 'hidden', border: '1px solid var(--g-hair)' }}>
            <canvas
              ref={canvasRef}
              className="w-full h-full"
              style={{ display: 'block' }}
              aria-label="Vista previa de la imagen a compartir"
            />
          </div>
          {error && <p className="gc-small" role="alert">{error}</p>}
          {result?.method === 'web-share' && !result.cancelled && <p className="gc-small" role="status">Compartido</p>}
          {result?.method === 'download' && <p className="gc-small" role="status">Imagen descargada</p>}
        </div>

        <div className="gc-dialog-foot">
          <button type="button" onClick={onClose} className="gc-btn gc-btn--plain">Cancelar</button>
          <button type="button" onClick={handleShare} disabled={busy || !!error} className="gc-btn gc-btn--primary">
            {busy ? 'Generando…' : (typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' ? 'Compartir' : 'Descargar imagen')}
          </button>
        </div>
      </div>
    </div>
  );
});
