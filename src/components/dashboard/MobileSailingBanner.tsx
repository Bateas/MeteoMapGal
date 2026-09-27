import { memo, useMemo } from 'react';
import { useSpotStore } from '../../store/spotStore';
import { useSectorStore } from '../../store/sectorStore';
import { useAlertStore } from '../../store/alertStore';
import { getSpotsForSector } from '../../config/spots';
import { VERDICT_STYLE, displayVerdict, displayWindKt, displayWindDir, verdictLabel } from '../../config/verdictStyles';
import { formatSurfWave, surfView } from '../../services/surfVerdictEngine';
import { WeatherIcon } from '../icons/WeatherIcons';
import { useUIStore } from '../../store/uiStore';

/**
 * Compact floating pill above the map on mobile.
 * Shows: "Cesantes · Buen día · 15kt SW"
 * Tapping it opens the sidebar where the full SpotSelector is rendered.
 * Works for all sectors (Embalse + Rías).
 *
 * A surf spot shows its WAVE verdict, the one its marker, row and card show
 * ("Corrubedo · SURF OK · ~1,1 m"): the pill said «Corrubedo · Calma»
 * right above a card saying PEQUE. Over the engine's hard gate it reads the
 * wind verdict, like any spot.
 */
export const MobileSailingBanner = memo(function MobileSailingBanner() {
  const scores = useSpotStore((s) => s.scores);
  const activeSpotId = useSpotStore((s) => s.activeSpotId);
  const surfWaveCache = useSpotStore((s) => s.surfWaveCache);
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const riskSeverity = useAlertStore((s) => s.risk.severity);

  const spots = useMemo(() => getSpotsForSector(sectorId), [sectorId]);
  const activeSpot = spots.find((s) => s.id === activeSpotId) ?? spots[0];
  const activeScore = activeSpot ? scores.get(activeSpot.id) : undefined;
  // Provisional scores collapse to the neutral render — see verdictStyles.
  const verdict = displayVerdict(activeScore);
  const v = VERDICT_STYLE[verdict];

  // Hide when CriticalAlertBanner is active — critical alert takes priority
  if (!activeSpot || riskSeverity === 'critical') return null;

  // The pill sits on the map, which stays dark in both themes.
  const surfEntry = activeSpot.category === 'surf' ? surfWaveCache.get(activeSpot.id) : undefined;
  const surfRaw = activeSpot.category === 'surf' ? surfView(surfEntry, activeScore, 'dark') : null;
  const surf = surfRaw && surfRaw.state !== 'danger' ? surfRaw : null;
  if (surf) {
    // Compact like the marker: the «~» on screen, «modelo» in the accessible
    // name. The pill is a summary that opens the list, where the word shows.
    const wave = surf.state === 'ready' && surfEntry?.waveHeight != null ? formatSurfWave(surfEntry.waveHeight) : null;
    const n = VERDICT_STYLE.unknown;
    const textStyle = surf.color ? { color: surf.color } : undefined;
    const textClass = surf.color ? '' : n.text;
    return (
      <button
        aria-label={`Condiciones en ${activeSpot.shortName}: ${surf.label}${wave ? `, ${wave} de ola (modelo)` : ''}`}
        onClick={() => setSidebarOpen(true)}
        className={`
          fixed top-[4.5rem] left-1/2 -translate-x-1/2 z-20
          flex items-center gap-1.5 px-3 py-1.5 rounded-full
          border ${n.border} ${n.bg}
          shadow-lg shadow-black/30
          transition-all active:scale-95
        `}
      >
        <span className={`flex flex-shrink-0 ${textClass}`} style={textStyle}>
          <WeatherIcon id="waves" size={14} />
        </span>
        <span className={`text-[11px] font-bold whitespace-nowrap ${textClass}`} style={textStyle}>
          {activeSpot.shortName}
        </span>
        <span className="text-slate-600 text-[11px]">·</span>
        <span className={`text-[11px] font-bold whitespace-nowrap ${textClass}`} style={textStyle}>
          {surf.label}
        </span>
        {wave && (
          <>
            <span className="text-slate-600 text-[11px]">·</span>
            <span className={`text-[11px] font-semibold whitespace-nowrap tabular-nums ${textClass}`} style={textStyle}>
              {wave}
            </span>
          </>
        )}
        <WeatherIcon id="info" size={12} className="text-slate-500 flex-shrink-0 ml-0.5" />
      </button>
    );
  }

  // Build concise info: "15kt SW"
  // T3-1 fix S136+3+3: prefer effectiveWindKt (detector-boosted) so Cesantes
  // with canalization shows 14kt not 5kt — aligns with SpotMarker + popup.
  // Null while provisional, calibrated otherwise — both rules in one call.
  const windKt = displayWindKt(activeScore);
  const windDir = displayWindDir(activeScore)?.label;
  const windInfo = windKt != null && verdict !== 'calm' && verdict !== 'unknown'
    ? `${windKt.toFixed(0)}kt ${windDir ?? ''}`
    : null;
  const label = verdictLabel(activeScore);

  return (
    <button
      aria-label={`Condiciones en ${activeSpot.shortName}: ${label}${windInfo ? `, ${windInfo}` : ''}`}
      onClick={() => setSidebarOpen(true)}
      className={`
        fixed top-[4.5rem] left-1/2 -translate-x-1/2 z-20
        flex items-center gap-1.5 px-3 py-1.5 rounded-full
        border ${v.border} ${v.bg}
        shadow-lg shadow-black/30
        transition-all active:scale-95
      `}
    >
      <WeatherIcon id="sailboat" size={14} className={`flex-shrink-0 ${v.text}`} />
      <span className={`text-[11px] font-bold ${v.text} whitespace-nowrap`}>
        {activeSpot.shortName}
      </span>
      <span className="text-slate-600 text-[11px]">&middot;</span>
      <span className={`text-[11px] font-bold ${v.text} whitespace-nowrap`}>
        {label}
      </span>
      {windInfo && (
        <>
          <span className="text-slate-600 text-[11px]">&middot;</span>
          <span className={`text-[11px] font-semibold ${v.text} whitespace-nowrap tabular-nums`}>
            {windInfo}
          </span>
        </>
      )}
      <WeatherIcon id="info" size={12} className="text-slate-500 flex-shrink-0 ml-0.5" />
    </button>
  );
});
