/**
 * Popup for webcam markers — shows live image and camera info.
 * Desktop: MapLibre native popup. Mobile: bottom sheet.
 */
import { memo, useState, useEffect } from 'react';
import { Popup } from 'react-map-gl/maplibre';
import { useUIStore } from '../../store/uiStore';
import type { WebcamStation } from '../../config/webcams';

interface WebcamPopupProps {
  webcam: WebcamStation;
  onClose: () => void;
}

export const WebcamPopup = memo(function WebcamPopup({ webcam, onClose }: WebcamPopupProps) {
  const isMobile = useUIStore((s) => s.isMobile);
  const [imgKey, setImgKey] = useState(0);
  const [imgError, setImgError] = useState(false);

  // Auto-refresh image every 5 min
  useEffect(() => {
    const iv = setInterval(() => {
      setImgKey((k) => k + 1);
      setImgError(false);
    }, webcam.refreshInterval * 1000);
    return () => clearInterval(iv);
  }, [webcam.refreshInterval]);

  const dirLabel = degreesToLabel(webcam.azimuth);

  // Mobile: bottom sheet style
  if (isMobile) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900/95 border-t border-green-500/30 backdrop-blur-md rounded-t-xl p-3 max-h-[70vh] overflow-auto">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold text-green-400">{webcam.name}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg px-2" aria-label="Cerrar">X</button>
        </div>
        <WebcamContent webcam={webcam} imgKey={imgKey} imgError={imgError} onImgError={() => setImgError(true)} dirLabel={dirLabel} />
      </div>
    );
  }

  // Desktop: MapLibre popup
  return (
    <Popup
      longitude={webcam.lon}
      latitude={webcam.lat}
      anchor="bottom"
      closeOnClick={false}
      onClose={onClose}
      maxWidth="320px"
      className="webcam-popup"
    >
      <div className="bg-slate-900/95 rounded-lg border border-green-500/30 p-2.5 min-w-[280px]">
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="text-xs font-bold text-green-400 truncate">{webcam.name}</h3>
          <span className="text-[10px] text-slate-500 shrink-0 ml-2">{dirLabel} {webcam.azimuth}°</span>
        </div>
        <WebcamContent webcam={webcam} imgKey={imgKey} imgError={imgError} onImgError={() => setImgError(true)} dirLabel={dirLabel} />
      </div>
    </Popup>
  );
});

function WebcamContent({
  webcam, imgKey, imgError, onImgError, dirLabel,
}: {
  webcam: WebcamStation; imgKey: number; imgError: boolean; onImgError: () => void; dirLabel: string;
}) {
  // Proxy MG images through vite/nginx to avoid CORS
  const proxyUrl = webcam.imageUrl.replace(
    'https://www.meteogalicia.gal/',
    '/meteogalicia-api/',
  );

  return (
    <div className="space-y-1.5">
      {/* Live image */}
      <div className="relative rounded-md overflow-hidden bg-slate-800" style={{ aspectRatio: '16/10' }}>
        {imgError ? (
          <div className="flex items-center justify-center h-full text-slate-600 text-xs">
            Imagen no disponible
          </div>
        ) : (
          <img
            key={imgKey}
            src={`${proxyUrl}?t=${imgKey}`}
            alt={`Webcam ${webcam.name}`}
            className="w-full h-full object-cover"
            onError={onImgError}
            loading="lazy"
          />
        )}
        {/* Source badge */}
        <div className="absolute bottom-1 left-1 text-[8px] bg-black/60 text-green-400 px-1 rounded">
          MeteoGalicia
        </div>
      </div>

      {/* Info row */}
      <div className="flex items-center justify-between text-[10px] text-slate-500">
        <span>{webcam.concello}, {webcam.province}</span>
        <span>Dir: {dirLabel} ({webcam.azimuth}°)</span>
      </div>

      {/* Spot link if available */}
      {webcam.nearestSpotId && (
        <div className="text-[10px] text-green-400/70">
          Spot cercano: {webcam.nearestSpotId}
        </div>
      )}
    </div>
  );
}

/** Convert degrees to compass label */
function degreesToLabel(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}
