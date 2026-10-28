/**
 * Strip over the whole app while a `?sim*` parameter is in the address (see config/simulation.ts):
 * the storm, fog, rain or warning on screen is invented. It sits in the page flow above the
 * header, so it never covers a control, and it cannot be dismissed: the only way out is
 * leaving the simulation. Fuchsia on purpose: no weather state or official warning uses it.
 */
import { activeSimParams, urlWithoutSimulation } from '../../config/simulation';

export function SimulationBanner({ search }: { search?: string }) {
  const active = activeSimParams(search);
  if (active.length === 0) return null;

  return (
    <div
      role="alert"
      className="shrink-0 w-full bg-fuchsia-800 text-white flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs"
      style={{ padding: '6px 12px' }}
    >
      <span className="font-bold tracking-wide">SIMULACIÓN</span>
      {/* Phone: one line, so the strip does not eat a fifth of the screen. */}
      <span className="sm:hidden">datos inventados</span>
      <span className="hidden sm:inline">Lo que ves es inventado para probar la app: no es el tiempo real.</span>
      <span className="hidden sm:inline font-mono text-fuchsia-200">{active.map((p) => `?${p}`).join(' ')}</span>
      <button
        type="button"
        aria-label="Salir de la simulación"
        onClick={() => window.location.replace(urlWithoutSimulation(window.location.href))}
        className="min-h-[32px] rounded-md border border-white/70 font-semibold hover:bg-fuchsia-700"
        style={{ padding: '0 10px' }}
      >
        <span className="sm:hidden">Salir</span>
        <span className="hidden sm:inline">Salir de la simulación</span>
      </button>
    </div>
  );
}
