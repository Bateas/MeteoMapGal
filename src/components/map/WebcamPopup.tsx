/**
 * Card of a webcam: its live picture and where it looks. Shell: Ficha.
 */
import { memo, useState, useEffect, useId } from 'react';
import { Ficha, Note } from './Ficha';
import { useWebcamStore } from '../../store/webcamStore';
import type { WebcamStation } from '../../config/webcams';
import { ALL_SPOTS } from '../../config/spots';
import { isUsableVision } from '../../services/webcamFogSites';

interface WebcamPopupProps {
  webcam: WebcamStation;
  onClose: () => void;
}

export const WebcamPopup = memo(function WebcamPopup({ webcam, onClose }: WebcamPopupProps) {
  const [imgKey, setImgKey] = useState(0);
  const [imgError, setImgError] = useState(false);
  const titleId = useId();

  // Auto-refresh image every 5 min
  useEffect(() => {
    const iv = setInterval(() => {
      setImgKey((k) => k + 1);
      setImgError(false);
    }, webcam.refreshInterval * 1000);
    return () => clearInterval(iv);
  }, [webcam.refreshInterval]);

  // Proxy MG images through vite/nginx to avoid CORS
  const proxyUrl = webcam.imageUrl.replace('https://www.meteogalicia.gal/', '/meteogalicia-api/');
  const nearSpot = webcam.nearestSpotId ? ALL_SPOTS.find((s) => s.id === webcam.nearestSpotId)?.name : null;

  return (
    <Ficha longitude={webcam.lon} latitude={webcam.lat} onClose={onClose} titleId={titleId}>
      <div className="gf-head">
        <div className="gf-titles">
          <h2 id={titleId} className="gf-name">{webcam.name}</h2>
          <div className="gf-sub">{webcam.concello}, {webcam.province} · mira al {degreesToLabel(webcam.azimuth)}</div>
        </div>
      </div>

      {imgError ? (
        <div className="gf-photo gf-photo--empty">Imagen no disponible</div>
      ) : (
        <img
          key={imgKey}
          src={`${proxyUrl}?t=${imgKey}`}
          alt={`Webcam ${webcam.name}`}
          className="gf-photo"
          onError={() => setImgError(true)}
          loading="lazy"
        />
      )}
      <p className="gf-credit">Imagen: {webcam.source === 'dgt' ? 'DGT' : 'MeteoGalicia'}{nearSpot ? ` · cerca de ${nearSpot}` : ''}</p>

      <VisionNote webcamId={webcam.id} />
    </Ficha>
  );
});

/**
 * What the image model says, only when it sees fog or very poor visibility: the one thing it is reliable
 * for, and a hint rather than a measurement. Its reading of the sky added nothing on top of the picture.
 */
function VisionNote({ webcamId }: { webcamId: string }) {
  const result = useWebcamStore((s) => s.visionResults.get(webcamId));
  if (!result || !isUsableVision(result.weather.sky)) return null; // night
  const fog = result.weather.fogVisible;
  if (!fog && result.weather.visibility !== 'poor') return null;
  const ago = Math.round((Date.now() - result.analyzedAt.getTime()) / 60_000);
  return (
    <div className="gf-notes" style={{ marginTop: 8 }}>
      <Note icon="eye" tone="alto">
        {fog ? 'Parece haber niebla en la imagen' : 'Se ve muy poco en la imagen'}
        <small>Lectura automática de hace {ago < 60 ? `${ago} min` : `${Math.round(ago / 60)} h`}, sin confirmar.</small>
      </Note>
    </div>
  );
}

/** Convert degrees to compass label */
function degreesToLabel(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}
