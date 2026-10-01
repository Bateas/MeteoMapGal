/**
 * "Datos: Puertos del Estado (portus.puertos.es) y Observatorio Costeiro da Xunta".
 *
 * Puertos del Estado authorised, in writing on 1-oct-2026, showing, storing and
 * modelling its buoy data on the condition that every use says clearly that the
 * data are theirs, with the address of its portal. The address is shown as text,
 * not hidden behind the name, so it is there even in a screenshot.
 */
import { BUOY_PROVIDERS, type BuoyProvider } from '../../api/buoyClient';

export function BuoyCredit({ providers, className }: { providers: readonly BuoyProvider[]; className?: string }) {
  if (providers.length === 0) return null;
  return (
    <span className={className}>
      Datos:{' '}
      {providers.map((p, i) => {
        const { name, url, urlLabel } = BUOY_PROVIDERS[p];
        return (
          <span key={p}>
            {i > 0 && (i === providers.length - 1 ? ' y ' : ', ')}
            {name}
            {url && (
              <>
                {' ('}
                <a href={url} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-slate-300">
                  {urlLabel ?? url}
                </a>
                {')'}
              </>
            )}
          </span>
        );
      })}
    </span>
  );
}
