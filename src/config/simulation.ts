/**
 * Demo parameters that inject made-up weather: a storm (`?simstrike`, `?simwait`), fog
 * (`?simfog`), rain (`?simrain`), an orange warning (`?simorange`) or a storm surge
 * (`?simsurge`). They exist to review a screen without waiting for the real event, and they
 * work in production. A link that carries
 * one shows invented danger as if it were real, so every page with one wears a visible mark
 * (`SimulationBanner`) and hides the share buttons: the picture would outlive the joke.
 * A new `?sim*` parameter goes in this list.
 */
export const SIM_PARAMS = ['simstrike', 'simwait', 'simfog', 'simrain', 'simorange', 'simsurge'] as const;

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
