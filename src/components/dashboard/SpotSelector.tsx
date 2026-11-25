/**
 * The Spots tab: one row per spot of the sector, the favourite first and then the best verdict. Only what
 * helps to choose: the shape and the word of the verdict, the wind and where it is going. The rest is in the
 * card, which a row opens. A surf spot reads THE surf verdict from the cache entry (the one the marker, the
 * card and the ticker read) and the beach height, which is a model value and says so; over the engine's hard
 * gate it reads the wind verdict like any spot.
 */
import { memo, useMemo, useRef } from 'react';
import { useSpotStore } from '../../store/spotStore';
import { useSectorStore } from '../../store/sectorStore';
import { useThemeStore } from '../../store/themeStore';
import { useUIStore } from '../../store/uiStore';
import { getSpotsForSector, type SailingSpot } from '../../config/spots';
import type { SpotScore } from '../../services/spotScoringEngine';
import { VERDICT_LINE, fillOf, windToneOver, surfTone, displayVerdict, displayWindKt, displayWindDir, gateWaveText, verdictLabel, isGusty, GUSTY_LABEL } from '../../config/verdictStyles';
import { formatSurfWave, surfView, type SurfWaveEntry } from '../../services/surfVerdictEngine';
import { favoriteFirst, sortSpotsByVerdict } from '../../services/spotRank';
import { spotWindDrift, TREND_MAX_AGE_MIN } from '../../services/windTrendService';
import { ageMinutes, ageWords, dataAge } from '../../services/dataAge';
import { WeatherIcon } from '../icons/WeatherIcons';
import { TrendMark } from '../spot/TrendMark';
import { useFlipReorder } from '../../hooks/useFlipReorder';
import { useMinuteClock } from '../../hooks/useMinuteClock';
import { listHoverHandlers, useClearListHover } from '../../hooks/useListHover';
import { spotTwinOffset } from '../map/spotTwins';

const HEX_PTS = '15,2 26.26,8.5 26.26,21.5 15,28 3.74,21.5 3.74,8.5';
const PENTA_PTS = '15,2 27.36,10.98 22.64,25.52 7.36,25.52 2.64,10.98';

export const SpotSelector = memo(function SpotSelector() {
  const activeSpotId = useSpotStore((s) => s.activeSpotId);
  const selectSpot = useSpotStore((s) => s.selectSpot);
  const favoriteSpotId = useSpotStore((s) => s.favoriteSpotId);
  const toggleFavorite = useSpotStore((s) => s.toggleFavorite);
  const scores = useSpotStore((s) => s.scores);
  const surfWaveCache = useSpotStore((s) => s.surfWaveCache);
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const now = useMinuteClock();

  const spots = useMemo(() => getSpotsForSector(sectorId), [sectorId]);
  const ordered = useMemo(
    () => favoriteFirst(sortSpotsByVerdict(spots, scores, surfWaveCache), favoriteSpotId),
    [spots, scores, surfWaveCache, favoriteSpotId],
  );

  const listRef = useRef<HTMLUListElement>(null);
  useFlipReorder(listRef, ordered.map((s) => s.id).join());
  useClearListHover();

  const onSelect = (spot: SailingSpot) => {
    const ui = useUIStore.getState();
    selectSpot(spot.id);
    ui.setFlyToTarget({ lon: spot.center[0], lat: spot.center[1], zoom: 12 });
    if (ui.isMobile) ui.setSidebarOpen(false);
  };

  if (spots.length === 0) return null;

  return (
    <div className="gc-listwrap">
      <ul className="gc-list" ref={listRef} aria-label="Spots de la zona">
        {ordered.map((spot) => (
          <SpotRow
            key={spot.id}
            spot={spot}
            score={scores.get(spot.id)}
            surfEntry={spot.category === 'surf' ? surfWaveCache.get(spot.id) : undefined}
            isActive={spot.id === activeSpotId}
            isFavorite={spot.id === favoriteSpotId}
            now={now}
            onSelect={onSelect}
            onToggleFavorite={toggleFavorite}
          />
        ))}
      </ul>
      <p className="gc-small">Sistema en pruebas. Los patrones de viento son orientativos y pueden no reflejar condiciones reales.</p>
    </div>
  );
});

interface SpotRowProps {
  spot: SailingSpot;
  score?: SpotScore;
  surfEntry?: SurfWaveEntry;
  isActive: boolean;
  isFavorite: boolean;
  now: number;
  onSelect: (spot: SailingSpot) => void;
  onToggleFavorite: (spotId: string) => void;
}

function SpotRow({ spot, score, surfEntry, isActive, isFavorite, now, onSelect, onToggleFavorite }: SpotRowProps) {
  const theme = useThemeStore((s) => s.theme);
  const history = useSpotStore((s) => s.windHistory.get(spot.id));

  const isSurf = spot.category === 'surf';
  const surfRaw = isSurf ? surfView(surfEntry, score, theme) : null;
  // The surf verdict, unless the engine's hard gate is on: then the wind one («Fuerte 30 kt»), as for any spot.
  const surf = surfRaw && surfRaw.state !== 'danger' ? surfRaw : null;

  const verdict = displayVerdict(score);
  const windKt = displayWindKt(score);
  // A beach not ready, or a wind spot without a verdict yet: the grey of waiting. Past 22 kt, the wind's colour.
  const fill = surf?.state === 'ready' && surfEntry?.verdict ? VERDICT_LINE[surfTone(surfEntry.verdict.level)] : surf || verdict === 'unknown' ? 'var(--g-hair)' : fillOf(verdict, isSurf ? null : windToneOver(verdict, windKt));
  const label = surf ? surf.label : verdictLabel(score);
  // A light mean with strong gusts: the row says so, as the card and the marker do.
  const gusty = !surf && isGusty(score);

  // The figure: the beach wave (a model) on surf, the sea when it closes the spot, the wind on the rest.
  const seaText = gateWaveText(score);
  const surfWave = surf?.state === 'ready' && surfEntry?.waveHeight != null ? formatSurfWave(surfEntry.waveHeight) : null;
  const figure = surf ? surfWave : seaText ?? (windKt != null ? `${Math.round(windKt)} kt` : null);
  const direction = !surf && !seaText && windKt != null ? displayWindDir(score)?.label : null;

  const ageMin = ageMinutes(surf ? surfEntry?.fetchedAt : score?.computedAt, now);
  const age = figure ? dataAge(ageMin) : 'fresh';
  const old = age !== 'fresh' && ageMin != null;

  const drift = useMemo(() => {
    if (surf || windKt == null || ageMin == null || ageMin > TREND_MAX_AGE_MIN) return null;
    return spotWindDrift(score?.windTrend, (history ?? []).map((p) => ({ t: p.ts, kt: p.kt })), now);
  }, [surf, windKt, ageMin, score?.windTrend, history, now]);

  return (
    <li
      className="gc-listrow"
      data-flip-key={spot.id}
      data-current={isActive ? '' : undefined}
      data-age={age}
      {...listHoverHandlers(spot.center[0], spot.center[1], spotTwinOffset(spot.id))}
    >
      <button type="button" className="gc-rowbtn" aria-current={isActive ? 'true' : undefined} onClick={() => onSelect(spot)}>
        <svg className="gc-rowshape" width="24" height="24" viewBox="0 0 30 30" aria-hidden="true">
          <polygon points={isSurf ? PENTA_PTS : HEX_PTS} fill={fill} stroke="var(--g-rule)" strokeWidth="1.5" />
        </svg>
        <span className="gc-rowmain">
          <span className="gc-rowname">{spot.shortName}</span>
          <span className="gc-rowsub">
            <b>{label}</b>
            {gusty && <span>{GUSTY_LABEL}</span>}
            <TrendMark drift={drift} />
          </span>
          {score?.hardGateTriggered && (
            <span className="gc-rowwarn">
              <WeatherIcon id="alert-triangle" size={14} />
              {score.hardGateTriggered}
            </span>
          )}
        </span>
        {figure && (
          <span className="gc-rowfig">
            <b>{figure}</b>{' '}
            {old
              ? <small>{ageWords(ageMin)}</small>
              : surfWave
                ? <small>(modelo)</small>
                : direction && <small>{direction}</small>}
          </span>
        )}
      </button>
      {/* Beside the row, not inside it: two controls one within the other is one for the keyboard. */}
      <button
        type="button"
        className="gc-rowstar"
        title={isFavorite ? 'Quitar de favorito' : 'Marcar como favorito'}
        aria-label={`${isFavorite ? 'Quitar de favorito' : 'Marcar como favorito'}: ${spot.shortName}`}
        onClick={() => onToggleFavorite(spot.id)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" aria-hidden="true">
          <path d="m12 3 2.7 5.8 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3.1 1.2-6.2L3 9.6l6.3-.8L12 3Z" />
        </svg>
      </button>
    </li>
  );
}
