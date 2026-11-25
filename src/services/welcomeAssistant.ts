/**
 * The welcome assistant: three questions at most, and what each answer leaves set in the app. It is not a
 * profile: nothing is stored about the person and nothing is hidden by the answers. Each answer only sets what
 * the app already has (zone, favourite spot, simple or advanced mode, the «En el campo» fold), so everything is
 * changed later where it is changed today (18-nov). One answer that changes nothing visible makes people
 * distrust the rest, so an option is here only if it does something, and the one that does nothing says so.
 */
import { isCoastalSector } from '../config/sectors';
import type { IconId } from '../components/icons/WeatherIcons';

export type Interest = 'agua' | 'mar' | 'lluvia' | 'campo' | 'todo';
export type WelcomePanel = 'zona' | 'mira' | 'spot';

export interface WelcomeAnswers {
  sector: string;
  interests: Interest[];
  /** The chosen spot, or null for «Ninguno» */
  spotId: string | null;
}

export interface InterestOption {
  id: Interest;
  icon: IconId;
  label: string;
  sub: string;
  /** Said under the list when it is ticked and it changes no setting */
  note?: string;
}

export const INTEREST_OPTIONS: readonly InterestOption[] = [
  { id: 'agua', icon: 'wind', label: 'Viento y olas', sub: 'Vela, windsurf, kite, surf' },
  { id: 'mar', icon: 'anchor', label: 'Mar y mareas', sub: 'Pesca, marisqueo, barco' },
  { id: 'lluvia', icon: 'cloud-rain', label: 'Lluvia, niebla y tormenta', sub: 'Carretera, obra, trabajo al aire libre', note: 'La lluvia, la niebla y los rayos salen solos en el mapa cuando pasan.' },
  { id: 'campo', icon: 'leaf', label: 'Helada y campo', sub: 'Viña, huerta, ganado' },
  { id: 'todo', icon: 'activity', label: 'Quiero verlo todo', sub: 'Estaciones, historial y capas' },
];

/** The panels in order: the spot is asked only of whoever looks at wind and waves. */
export function welcomePanels(a: Pick<WelcomeAnswers, 'interests'>): WelcomePanel[] {
  return a.interests.includes('agua') ? ['zona', 'mira', 'spot'] : ['zona', 'mira'];
}

export interface WelcomePlan {
  sector: string;
  /** false = advanced; null = leave the mode as it is (simple for a new visitor) */
  simple: boolean | null;
  favoriteSpotId: string | null;
  /** Open the card of the favourite spot on the map */
  openSpot: boolean;
  /** Leave «En el campo» open in Condiciones */
  campoOpen: boolean;
  /** Open Condiciones at the end, where the tides are (coastal zone only) */
  openConditions: boolean;
}

/** What the answers leave set. Nothing else changes. */
export function welcomePlan(a: WelcomeAnswers): WelcomePlan {
  const has = (i: Interest) => a.interests.includes(i);
  const spot = has('agua') ? a.spotId : null;
  return {
    sector: a.sector,
    simple: has('todo') ? false : null,
    favoriteSpotId: spot,
    openSpot: spot !== null,
    campoOpen: has('campo'),
    // The spot card goes first when there is one: two sheets at once on a phone would cover each other
    openConditions: spot === null && has('mar') && isCoastalSector(a.sector),
  };
}

/** Tick or untick an interest. */
export function toggleInterest(list: Interest[], id: Interest): Interest[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}
