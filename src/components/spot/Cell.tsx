import type { ReactNode } from 'react';
import { WeatherIcon } from '../icons/WeatherIcons';

/**
 * One «label, value» pair of a card's data grid, inside a <dl className="gf-data">. The value stays in
 * ink: a temperature is not a state. `warn` marks the few values that are one.
 */
export function Cell({ label, value, warn, title, children }: {
  label: string;
  value?: string;
  warn?: boolean;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className="gf-cell" title={title}>
      <dt>{label}</dt>
      <dd>
        {children ?? value}
        {warn && <>{' '}<WeatherIcon id="alert-triangle" size={13} /><span className="sr-only">Atención</span></>}
      </dd>
    </div>
  );
}
