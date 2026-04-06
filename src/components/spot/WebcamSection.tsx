import { useState } from 'react';
import { WeatherIcon } from '../icons/WeatherIcons';
import { azimuthLabel } from './spotColors';
import type { SpotWebcam } from '../../config/spots';

export function WebcamSection({ webcams }: { webcams: SpotWebcam[] }) {
  const [open, setOpen] = useState(false);
  const [imgKey, setImgKey] = useState(0);

  return (
    <div className="mt-2 pt-1.5 border-t border-slate-700/40">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-300 transition-colors w-full text-left"
      >
        <WeatherIcon id="camera" size={11} className="text-slate-500 shrink-0" />
        <span className="font-semibold">Webcams</span>
        <span className="text-slate-500 text-[11px] ml-1">({webcams.length})</span>
        <span className="text-slate-500 text-[11px] ml-auto">{open ? '\u25B2' : '\u25BC'}</span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-2">
          {webcams.map((cam) => (
            <div key={cam.url} className="bg-slate-800/40 rounded px-2 py-1.5">
              <div className="flex items-center gap-1.5 text-[11px] mb-1">
                <span className="font-bold text-slate-200">{cam.label}</span>
                <span className="text-slate-500 ml-auto">{azimuthLabel(cam.azimuth)}</span>
              </div>

              {cam.type === 'image' ? (
                <>
                  <img
                    key={imgKey}
                    src={`${cam.url.replace('https://www.meteogalicia.gal/', '/meteogalicia-api/')}?_t=${imgKey || Date.now()}`}
                    alt={cam.label}
                    className="w-full rounded border border-slate-700/60"
                    loading="lazy"
                  />
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[11px] text-slate-500">{cam.source}</span>
                    <button
                      onClick={() => setImgKey(Date.now())}
                      className="text-[11px] text-sky-400 hover:text-sky-300 transition-colors"
                    >
                      \u21BB Actualizar
                    </button>
                  </div>
                </>
              ) : (
                <a
                  href={cam.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-[11px] text-sky-400 hover:text-sky-300 transition-colors"
                >
                  <span>\u25B6</span>
                  <span>Ver stream en vivo</span>
                  <span className="text-slate-500 ml-auto">{cam.source}</span>
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
