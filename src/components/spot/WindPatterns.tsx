import { useState } from 'react';
import { WeatherIcon } from '../icons/WeatherIcons';
import { dirArrow } from './spotColors';
import type { WindPattern } from '../../config/spots';

export function WindPatterns({ patterns }: { patterns: WindPattern[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 pt-1.5 border-t border-slate-700/40">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-300 transition-colors w-full text-left"
      >
        <WeatherIcon id="wind" size={11} className="text-slate-500 shrink-0" />
        <span className="font-semibold">Patrones de viento</span>
        <span className="text-slate-500 text-[11px] ml-auto">{open ? '\u25B2' : '\u25BC'}</span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5">
          {patterns.map((p) => (
            <div key={p.name} className="bg-slate-800/40 rounded px-2 py-1.5">
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="text-slate-300 font-mono">{dirArrow(p.direction)}</span>
                <span className="font-bold text-slate-200">{p.name}</span>
                <span className="text-slate-500 ml-auto">{p.season}</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{p.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
