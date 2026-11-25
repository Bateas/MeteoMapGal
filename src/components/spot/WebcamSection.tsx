import { useState } from 'react';
import { WeatherIcon } from '../icons/WeatherIcons';
import { FoldRow } from '../map/Ficha';
import { azimuthLabel } from './spotColors';
import type { SpotWebcam } from '../../config/spots';

export function WebcamSection({ webcams, title = 'Webcams' }: { webcams: SpotWebcam[]; title?: string }) {
  // Stable per 5-min slot: the popup re-renders on every scoring pass, and a
  // Date.now() in the URL turned each render into a new request to MeteoGalicia
  // that the proxy cache could never answer. Same slot for every visitor = shared.
  const [imgKey, setImgKey] = useState(() => Math.floor(Date.now() / 300_000));
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());

  return (
    <FoldRow icon="camera" title={title} note={`(${webcams.length})`}>
      <div className="flex flex-col" style={{ gap: 12 }}>
        {webcams.map((cam) => (
          <div key={cam.url}>
            <div className="flex items-baseline justify-between" style={{ gap: 8, marginBottom: 4 }}>
              <span className="gf-strong" style={{ fontSize: 13.5 }}>{cam.label}</span>
              {cam.azimuth != null && <span className="gf-hint">{azimuthLabel(cam.azimuth)}</span>}
            </div>
            {cam.type === 'image' ? (
              <>
                {failed.has(cam.url) ? (
                  <div className="gf-photo gf-photo--empty">Imagen no disponible</div>
                ) : (
                  <img
                    key={imgKey}
                    src={`${cam.url.replace('https://www.meteogalicia.gal/', '/meteogalicia-api/')}?_t=${imgKey}`}
                    alt={cam.label}
                    className="gf-photo"
                    loading="lazy"
                    onError={() => setFailed((f) => new Set(f).add(cam.url))}
                  />
                )}
                <div className="flex items-center justify-between gf-hint" style={{ marginTop: 2 }}>
                  <span>{cam.source}</span>
                  <button type="button" onClick={() => { setFailed(new Set()); setImgKey(Date.now()); }} className="gf-more">
                    Actualizar
                  </button>
                </div>
              </>
            ) : (
              <a href={cam.url} target="_blank" rel="noopener noreferrer" className="gf-row">
                <WeatherIcon id="camera" size={16} />
                <span className="gf-grow">Ver en directo <small>{cam.source}</small></span>
              </a>
            )}
          </div>
        ))}
      </div>
    </FoldRow>
  );
}
