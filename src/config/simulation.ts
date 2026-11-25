/**
 * Demo parameters that inject made-up weather: a storm (`?simstrike`, `?simwait`), fog
 * (`?simfog`), rain (`?simrain`), an orange warning (`?simorange`) or a storm surge
 * (`?simsurge`). They exist to review a screen without waiting for the real event, and they
 * work in production. A link that carries
 * one shows invented danger as if it were real, so every page with one wears a visible mark
 * (`SimulationBanner`) and hides the share buttons: the picture would outlive the joke.
 * A new `?sim*` parameter goes in this list.
 */
export const SIM_PARAMS = ['simstrike', 'simwait', 'simfog', 'simrain', 'simorange', 'simsurge', 'simpanorama'] as const;

function currentSearch(): string {
  try {
    return typeof window === 'undefined' ? '' : window.location.search;
  } catch {
    return '';
  }
}

/** The simulation parameters present in the query, in `SIM_PARAMS` order. */
export function activeSimParams(search: string = currentSearch()): string[] {
  const params = new URLSearchParams(search);
  return SIM_PARAMS.filter((name) => params.has(name));
}

export function isSimulationActive(search?: string): boolean {
  return activeSimParams(search).length > 0;
}

/** The same address with every simulation parameter removed (the rest of the query and the hash stay). */
export function urlWithoutSimulation(href: string): string {
  const url = new URL(href);
  for (const name of SIM_PARAMS) url.searchParams.delete(name);
  return url.toString();
}

/**
 * A relative address of the app with the simulation parameters of the current page added. A card writes
 * its own address into the bar while it is open (a spot's link): without them the page stopped being a
 * simulation the moment a card opened, and the demo warning inside that card went away (25-nov).
 */
export function withSimulation(path: string, search: string = currentSearch()): string {
  const here = new URLSearchParams(search);
  const names = SIM_PARAMS.filter((name) => here.has(name));
  if (names.length === 0) return path;
  const [base, hash = ''] = path.split('#');
  const [pathname, query = ''] = base.split('?');
  const out = new URLSearchParams(query);
  for (const name of names) out.set(name, here.get(name) ?? '');
  return `${pathname}?${out.toString()}${hash ? `#${hash}` : ''}`;
}
