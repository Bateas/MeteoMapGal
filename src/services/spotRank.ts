/**
 * The order of the spots of a sector, best first: the one thing the spot comparator did that the
 * list did not. Shared by the Spots tab and the phone pill, so «the best» is the same in both.
 *
 * Sorted by what each spot SHOWS: the displayed verdict (a spot still calculating ranks on nothing,
 * never on a figure nobody can see) and, on a beach, its wave verdict and not the wind one. A spot
 * closed by its own limit (sea or wind over the hard gate) is the worst place to go, not the best:
 * 'strong' alone sorted it first (Cíes-Ría with a 3 m sea at Silleiro, 21-oct).
 */
import { displayVerdict } from '../config/verdictStyles';
import type { SpotScore, SpotVerdict } from './spotScoringEngine';
import { surfBestRank, surfDisplayState, type SurfWaveEntry } from './surfVerdictEngine';

const VERDICT_RANK: Record<SpotVerdict, number> = {
  strong: 5, good: 4, sailing: 3, light: 2, calm: 1, unknown: 0,
};

/** Closed by its own limit: below everything, even a spot with no data. */
const CLOSED_RANK = -1;

/** Spots ranked 'calm' or lower have nothing to recommend them over each other. */
const WORTH_NAMING_RANK = VERDICT_RANK.light;

/** What the ranking needs of a spot: any SailingSpot fits. */
interface RankableSpot {
  id: string;
  category?: 'sailing' | 'surf';
}

interface SpotRankInput {
  spot: RankableSpot;
  score?: SpotScore;
  surfEntry?: SurfWaveEntry;
}

export function spotRank({ spot, score, surfEntry }: SpotRankInput): number {
  if (score && !score.provisional && score.hardGateTriggered) return CLOSED_RANK;
  if (spot.category === 'surf') {
    const state = surfDisplayState(surfEntry, score);
    if (state === 'ready' && surfEntry?.verdict) {
      // CLÁSICO, then SURF OK, then GRANDE, on the same scale as the sailing verdicts (a beach with
      // real waves sits with 'sailing' and up); below SURF OK, like a calm.
      const best = surfBestRank(surfEntry.verdict.level);
      return best > 0 ? VERDICT_RANK.sailing + best - 1 : VERDICT_RANK.calm;
    }
    // 'danger' is the hard gate, already handled; loading or no wave data: nothing to rank on.
    if (state !== 'danger') return VERDICT_RANK.unknown;
  }
  return VERDICT_RANK[displayVerdict(score)] ?? VERDICT_RANK.unknown;
}

/** The spots of a sector, best first. Ties keep the order of the config. */
export function sortSpotsByVerdict<S extends RankableSpot>(
  spots: readonly S[],
  scores: ReadonlyMap<string, SpotScore>,
  surfCache: ReadonlyMap<string, SurfWaveEntry>,
): S[] {
  const rank = (s: S) => spotRank({ spot: s, score: scores.get(s.id), surfEntry: surfCache.get(s.id) });
  return [...spots].sort((a, b) => rank(b) - rank(a));
}

/** The list with the favourite on top, however the others go. */
export function favoriteFirst<S extends RankableSpot>(spots: readonly S[], favoriteId: string | null | undefined): S[] {
  const favorite = favoriteId ? spots.find((s) => s.id === favoriteId) : undefined;
  return favorite ? [favorite, ...spots.filter((s) => s !== favorite)] : [...spots];
}

/**
 * The spot to name when none has been chosen: the best of the sector, or none. Below the 'light'
 * rank there is no best: naming one of several calm spots is the first of the list in disguise.
 */
export function bestSpotOf<S extends RankableSpot>(
  spots: readonly S[],
  scores: ReadonlyMap<string, SpotScore>,
  surfCache: ReadonlyMap<string, SurfWaveEntry>,
): S | null {
  const best = sortSpotsByVerdict(spots, scores, surfCache)[0];
  if (!best) return null;
  return spotRank({ spot: best, score: scores.get(best.id), surfEntry: surfCache.get(best.id) }) >= WORTH_NAMING_RANK ? best : null;
}
