/**
 * "Hay una versión nueva" — shown when a deploy lands while this tab is open (see
 * services/versionCheck.ts). It never reloads on its own: the person may be halfway through a
 * field report. "Luego" hides it for that deploy only; a later deploy asks again.
 */
import { useCallback, useState } from 'react';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';
import { isNewerDeploy, mainBundleOf } from '../../services/versionCheck';

const CHECK_EVERY_MS = 10 * 60_000;
const FIRST_CHECK_AFTER_MS = 60_000;

function loadedEntry(): string | null {
  return document.querySelector('script[type="module"][src*="/assets/main-"]')?.getAttribute('src') ?? null;
}

export function NewVersionBanner({ enabled = import.meta.env.PROD }: { enabled?: boolean }) {
  const [published, setPublished] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const check = useCallback(async () => {
    try {
      const res = await fetch('/', { cache: 'no-store' });
      if (!res.ok) return;
      const html = await res.text();
      if (isNewerDeploy(loadedEntry(), html)) setPublished(mainBundleOf(html));
    } catch {
      // Offline or the server is restarting: ask again next time.
    }
  }, []);

  useVisibilityPolling(check, CHECK_EVERY_MS, enabled, FIRST_CHECK_AFTER_MS);

  if (!published || published === dismissed) return null;

  return (
    <div
      role="status"
      className="pointer-events-auto bg-slate-800 border border-sky-600/60 rounded-xl p-3 shadow-2xl"
    >
      <p className="text-sm font-semibold text-white">Hay una versión nueva</p>
      <p className="text-[11px] text-slate-400 mt-0.5">Recarga para ver los últimos arreglos.</p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="flex-1 min-h-[36px] rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold"
        >
          Recargar
        </button>
        <button
          type="button"
          onClick={() => setDismissed(published)}
          className="min-h-[36px] px-3 rounded-lg border border-slate-600 text-slate-300 text-xs hover:bg-slate-700"
        >
          Luego
        </button>
      </div>
    </div>
  );
}
