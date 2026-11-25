/**
 * Colour in the guide, with a job: an icon on a tint says what kind of thing a row is talking about,
 * so a long page can be scanned. The text stays in ink. Tones are defined per theme in guide.css.
 * The icons are decorative, the name next to them carries the meaning.
 */
import type { ReactNode } from 'react';
import { WeatherIcon } from '../icons/WeatherIcons';
import type { IconId } from '../icons/WeatherIcons';
import './guide.css';

export type Tone = 'wind' | 'sea' | 'cold' | 'rain' | 'storm' | 'fire' | 'field' | 'air' | 'fog' | 'danger';

export function Ico({ id, tone }: { id: IconId; tone: Tone }) {
  return <span className={`gg-ico gg-t-${tone}`} aria-hidden="true"><WeatherIcon id={id} size={16} /></span>;
}

/** A section heading with its icon. */
export function H3({ id, tone, children }: { id: IconId; tone: Tone; children: ReactNode }) {
  return <h3 className="gg-h"><Ico id={id} tone={tone} /><span>{children}</span></h3>;
}

/** One row of a definition list, to go inside a `dl.gg-defs`. */
export function Def({ id, tone, name, children }: { id?: IconId; tone?: Tone; name: ReactNode; children: ReactNode }) {
  return (
    <div>
      <dt>{id && tone && <Ico id={id} tone={tone} />}<span>{name}</span></dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The alert levels, in the colours of the strip in the conditions panel (AlertTimeline). */
export function Level({ level, children }: { level: 'riesgo' | 'alto' | 'critico'; children: ReactNode }) {
  return <span className={`gg-chip gg-chip-${level}`}>{children}</span>;
}
