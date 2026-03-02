import { useEffect, useState, memo } from 'react';

const SHORTCUTS = [
  { key: 'C', desc: 'Panel Campo (alertas agrícolas)' },
  { key: 'R', desc: 'Refrescar datos' },
  { key: 'T', desc: 'Gradiente temperatura' },
  { key: 'A', desc: 'Panel alertas unificado' },
  { key: 'W', desc: 'Ciclar capas (viento → humedad → WRF)' },
  { key: 'B', desc: 'Números grandes — viento a pantalla completa' },
  { key: 'G', desc: 'Guía meteorológica — térmicos y navegación' },
  { key: '?', desc: 'Mostrar/ocultar esta ayuda' },
];

export const KeyboardShortcutHelp = memo(function KeyboardShortcutHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape' && open) setOpen(false);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-lg shadow-2xl p-5 max-w-sm w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-white tracking-wide">Atajos de teclado</h2>
          <button
            onClick={() => setOpen(false)}
            className="text-slate-500 hover:text-white text-lg leading-none"
          >
            &times;
          </button>
        </div>
        <div className="space-y-2">
          {SHORTCUTS.map((s) => (
            <div key={s.key} className="flex items-center gap-3">
              <kbd className="inline-flex items-center justify-center min-w-[28px] h-7 px-2 rounded bg-slate-800 border border-slate-600 text-xs font-mono font-bold text-slate-200">
                {s.key}
              </kbd>
              <span className="text-xs text-slate-400">{s.desc}</span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[10px] text-slate-600 text-center">
          Pulsa <kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 font-mono">?</kbd> o <kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 font-mono">Esc</kbd> para cerrar
        </p>
      </div>
    </div>
  );
});
