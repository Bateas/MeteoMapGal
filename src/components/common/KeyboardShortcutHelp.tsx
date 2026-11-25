import { useEffect, useState, memo } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { WeatherIcon } from '../icons/WeatherIcons';

// Only keys that do something: AppShell (C R T W P), MeteoGuide (G), this file (?), and Escape in each panel.
export const SHORTCUTS = [
  { key: 'P', desc: 'Previsión a pantalla completa' },
  { key: 'C', desc: 'Condiciones' },
  { key: 'R', desc: 'Refrescar datos' },
  { key: 'T', desc: 'Temperatura sobre el mapa. En avanzado' },
  { key: 'W', desc: 'Ir cambiando: viento, radar, nada. En avanzado' },
  { key: 'G', desc: 'Guía' },
  { key: '?', desc: 'Mostrar u ocultar esta ayuda' },
  { key: 'Esc', desc: 'Cerrar lo que esté abierto' },
];

export const KeyboardShortcutHelp = memo(function KeyboardShortcutHelp() {
  const [open, setOpen] = useState(false);
  const trapRef = useFocusTrap<HTMLDivElement>(open);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
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
    // aria-modal also tells the map popups' Escape handlers to leave this key
    // alone, so one Escape closes only this help and not the popup behind it.
    <div
      ref={trapRef}
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gc-shortcuts-title"
    >
      <div className="gc-scrim" onClick={() => setOpen(false)} />
      <div className="g-theme gc-dialog" style={{ margin: 16 }}>
        <div className="gc-dialog-head">
          <h2 id="gc-shortcuts-title">Atajos de teclado</h2>
          <button type="button" onClick={() => setOpen(false)} className="gc-btn gc-btn--plain gc-btn--icon" aria-label="Cerrar">
            <WeatherIcon id="x" size={16} />
          </button>
        </div>
        <div className="gc-dialog-body">
          <ul className="gc-kbdlist">
            {SHORTCUTS.map((s) => (
              <li key={s.key}>
                <kbd className="gc-kbd">{s.key}</kbd>
                <span>{s.desc}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
});
