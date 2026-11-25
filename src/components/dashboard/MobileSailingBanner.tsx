import { memo, useMemo } from 'react';
import { useSpotStore } from '../../store/spotStore';
import { useSectorStore } from '../../store/sectorStore';
import { useAlertStore } from '../../store/alertStore';
import { getSpotsForSector } from '../../config/spots';
import { displayVerdict, displayWindKt, displayWindDir, verdictLabel, gateWaveText, gateWaveWhere, isGusty, GUSTY_LABEL, VERDICT_LINE, lineOf, windToneOver, surfTone } from '../../config/verdictStyles';
import { formatSurfWave, surfView } from '../../services/surfVerdictEngine';
import { useThemeStore } from '../../store/themeStore';
import { WeatherIcon } from '../icons/WeatherIcons';
import { useUIStore } from '../../store/uiStore';
import { useSpotLightningRisk } from '../../hooks/useSpotLightningRisk';
import { bestSpotOf } from '../../services/spotRank';

/**
 * Compact floating pill above the map on mobile.
 * Shows: "Cesantes · Buen día · 15kt SW"
 * Tapping it opens the sidebar where the full SpotSelector is rendered; in simple mode, which has
 * no list, it opens the card of the spot it names.
 * Works for all sectors (Embalse + Rías). AppShell places it, last in the
 * top-of-map column under the safety banners; it carries no position of its
 * own (a fixed offset from the top of the screen put it on the warnings).
 *
 * A surf spot shows its WAVE verdict, the one its marker, row and card show
 * ("Corrubedo · SURF OK · ~1,1 m"): the pill said «Corrubedo · Calma»
 * right above a card saying PEQUE. Over the engine's hard gate it reads the
 * wind verdict, like any spot.
 *
 * With no spot chosen it names the best of the sector, or nothing: the first of the list was
 * nobody's choice, and read as advice. Under a lightning band it hides, or it reads «Calma» right
 * below «sal del agua».
 */
export const MobileSailingBanner = memo(function MobileSailingBanner() {
  const scores = useSpotStore((s) => s.scores);
  const activeSpotId = useSpotStore((s) => s.activeSpotId);
  const surfWaveCache = useSpotStore((s) => s.surfWaveCache);
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const simpleMode = useUIStore((s) => s.simpleMode);
  const selectSpot = useSpotStore((s) => s.selectSpot);
  const riskSeverity = useAlertStore((s) => s.risk.severity);
  const theme = useThemeStore((s) => s.theme);
  const lightningNear = useSpotLightningRisk().length > 0;

  const spots = useMemo(() => getSpotsForSector(sectorId), [sectorId]);
  const activeSpot = spots.find((s) => s.id === activeSpotId) ?? bestSpotOf(spots, scores, surfWaveCache);
  const activeScore = activeSpot ? scores.get(activeSpot.id) : undefined;
  // Provisional scores collapse to the neutral render — see verdictStyles.
  const verdict = displayVerdict(activeScore);

  // Hide when a safety band is up (CriticalAlertBanner, LightningProximityBanner): they take priority
  // With a spot card open the sheet says all this right below, peeking: twice is noise (11-nov).
  // So the pill only ever names the best spot of the sector, while nothing is open.
  if (activeSpotId !== '') return null;
  if (!activeSpot || riskSeverity === 'critical' || lightningNear) return null;

  // Simple mode has no list of spots (simpleTabs.ts): the pill opens the card of the spot it names.
  const open = () => (simpleMode ? selectSpot(activeSpot.id) : setSidebarOpen(true));

  const surfEntry = activeSpot.category === 'surf' ? surfWaveCache.get(activeSpot.id) : undefined;
  const surfRaw = activeSpot.category === 'surf' ? surfView(surfEntry, activeScore, theme) : null;
  const surf = surfRaw && surfRaw.state !== 'danger' ? surfRaw : null;
  if (surf) {
    // Compact like the marker: the «~» on screen, «modelo» in the accessible
    // name. The pill is a summary that opens the list, where the word shows.
    const wave = surf.state === 'ready' && surfEntry?.waveHeight != null ? formatSurfWave(surfEntry.waveHeight) : null;
    const iconColor = surf.state === 'ready' && surfEntry?.verdict ? VERDICT_LINE[surfTone(surfEntry.verdict.level)] : 'var(--g-muted)';
    return (
      <button
        type="button"
        aria-label={`Condiciones en ${activeSpot.shortName}: ${surf.label}${wave ? `, ${wave} de ola (modelo)` : ''}`}
        onClick={open}
        className="g-theme gc-pill"
      >
        <span className="gc-pill-ico" style={{ color: iconColor }}>
          <WeatherIcon id="waves" size={15} />
        </span>
        <span>{activeSpot.shortName}</span>
        <b>{surf.label}</b>
        {wave && <span>{wave}</span>}
      </button>
    );
  }

  // Build concise info: "15kt SW"
  // Prefer effectiveWindKt (detector-boosted) so Cesantes
  // with canalization shows 14kt not 5kt — aligns with SpotMarker + popup.
  // Null while provisional, calibrated otherwise — both rules in one call.
  const windKt = displayWindKt(activeScore);
  const windDir = displayWindDir(activeScore)?.label;
  const sea = gateWaveText(activeScore);
  const windInfo = sea
    ? `${sea} ${gateWaveWhere(activeScore)}`
    : windKt != null && verdict !== 'unknown'
    ? `${windKt.toFixed(0)} kt ${windDir ?? ''}`
    : null;
  const label = verdictLabel(activeScore);
  // «Calma» alone over gusts of 20 kt would send someone out unwarned: the pill says it too.
  const gusty = isGusty(activeScore);

  return (
    <button
      type="button"
      aria-label={`Condiciones en ${activeSpot.shortName}: ${label}${gusty ? `, ${GUSTY_LABEL}` : ''}${windInfo ? `, ${windInfo}` : ''}`}
      onClick={open}
      className="g-theme gc-pill"
    >
      <span className="gc-pill-ico" style={{ color: lineOf(verdict, windToneOver(verdict, displayWindKt(activeScore))) }}><WeatherIcon id="sailboat" size={15} /></span>
      <span>{activeSpot.shortName}</span>
      <b>{label}</b>
      {gusty && <span>{GUSTY_LABEL}</span>}
      {windInfo && <span>{windInfo}</span>}
    </button>
  );
});
