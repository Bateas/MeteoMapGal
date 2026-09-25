/**
 * Embeddable widget — compact spot conditions for clubs/schools.
 *
 * URL params:
 *   ?spot=cesantes       — single spot card
 *   ?sector=rias         — all spots in sector (default)
 *   ?sector=embalse      — embalse spots
 *   ?theme=dark|light    — color theme (default: dark)
 *   ?compact=true        — single-row minimal mode
 *
 * Embed:
 *   <iframe src="https://meteomapgal.navia3d.com/widget.html?spot=cesantes"
 *     width="320" height="180" frameborder="0"></iframe>
 *
 * It scores spots with the map's own engine and shows them with the map's own rules
 * (provisional verdicts say "Calculando…", the wind is the calibrated figure, the gust
 * travels with it), so a club page never contradicts the app.
 */
import { useCallback, useMemo, useState } from 'react';
import { getSpotsForSector, ALL_SPOTS } from '../config/spots';
import type { SpotId, SailingSpot } from '../config/spots';
import type { SpotScore } from '../services/spotScoringEngine';
import { scoreAllSpots, MAX_PLAUSIBLE_GUST_KT } from '../services/spotScoringEngine';
import { scaleGustToSpot } from '../services/windUtils';
import { displayVerdict, displayWindDir, displayWindKt, verdictLabel, VERDICT_HEX } from '../config/verdictStyles';
import { SECTORS, isCoastalSector } from '../config/sectors';
import { useVisibilityPolling } from '../hooks/useVisibilityPolling';
import { loadWidgetInputs } from './widgetData';

// ── URL params ──────────────────────────────────────
const params = new URLSearchParams(window.location.search);
const paramSpot = params.get('spot') as SpotId | null;
const paramSector = params.get('sector') || 'rias';
const paramTheme = params.get('theme') || 'dark';
const paramCompact = params.get('compact') === 'true';

const REFRESH_MS = 5 * 60_000;

const isDark = paramTheme === 'dark';
const rootBg = isDark ? '#0f172a' : '#ffffff';
const cardBg = isDark ? '#1e293b' : '#f8fafc';
const cardBorder = isDark ? '#334155' : '#e2e8f0';
const textPrimary = isDark ? '#e2e8f0' : '#1e293b';
const textSecondary = isDark ? '#94a3b8' : '#64748b';
const textMuted = isDark ? '#64748b' : '#94a3b8';
const linkColor = isDark ? '#60a5fa' : '#2563eb';

/**
 * The spots this widget shows. Surf spots are judged by the waves in the app, never by the
 * wind, so a wind verdict for one here would contradict the map: they are left out.
 */
export function widgetSpots(spotId: string | null, sectorId: string): SailingSpot[] {
  const pool = spotId ? ALL_SPOTS.filter((s) => s.id === spotId) : getSpotsForSector(sectorId);
  return pool.filter((s) => s.category !== 'surf');
}

export function WidgetApp() {
  const [scores, setScores] = useState<Map<string, SpotScore> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sector = SECTORS.find((s) => s.id === paramSector);
  const spots = useMemo(() => widgetSpots(paramSpot, paramSector), []);

  const load = useCallback(async () => {
    if (!sector) return;
    try {
      const { stations, readings, buoys } = await loadWidgetInputs(isCoastalSector(sector.id));
      setScores(scoreAllSpots(spots, stations, readings, buoys));
      setError(null);
    } catch (err) {
      console.error('[Widget] Error loading data:', err);
      setError('Error cargando datos');
    }
  }, [sector, spots]);

  // Every five minutes while the page is visible. Coming back to the tab asks again only if
  // the last answer is older than that; the old listener reloaded everything on every switch.
  useVisibilityPolling(load, REFRESH_MS, sector !== undefined && spots.length > 0);

  // A failed refresh keeps the last good scores on screen: the error only shows with nothing else.
  const problem = !sector ? 'Sector no válido'
    : spots.length === 0 ? 'Spot no disponible'
    : !scores ? error
    : null;

  return (
    <div style={{
      background: rootBg,
      padding: paramCompact ? '4px' : '8px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      minHeight: paramCompact ? 'auto' : '80px',
    }}>
      {problem ? (
        <div style={{ color: '#f87171', fontSize: '12px', padding: '12px' }}>{problem}</div>
      ) : !scores ? (
        <LoadingSkeleton />
      ) : paramCompact ? (
        <CompactRow spots={spots} scores={scores} />
      ) : (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
        }}>
          {spots.map((spot) => (
            <SpotCard key={spot.id} spot={spot} score={scores.get(spot.id) ?? null} />
          ))}
        </div>
      )}
      <WidgetFooter />
    </div>
  );
}

// ── Spot Card ───────────────────────────────────────
export function SpotCard({ spot, score }: { spot: SailingSpot; score: SpotScore | null }) {
  const color = VERDICT_HEX[displayVerdict(score)];
  const ready = score != null && !score.provisional;
  const windKt = displayWindKt(score);
  // The gust travels with the mean the card shows, as in the map's popup.
  const gustKt = windKt != null && score?.gustKt != null
    ? scaleGustToSpot(score.gustKt, score.wind?.avgSpeedKt ?? 0, windKt, MAX_PLAUSIBLE_GUST_KT)
    : null;
  // "variable" with no arrow when the sources disagree, as on the map.
  const dirView = ready ? displayWindDir(score) : null;
  const dirDeg = dirView?.deg ?? null;
  const waveM = ready ? score.waves?.waveHeight ?? null : null;
  const temp = score?.airTemp ?? null;

  return (
    <div style={{
      background: cardBg,
      border: `1px solid ${cardBorder}`,
      borderRadius: '10px',
      padding: '12px 14px',
      flex: '1 1 280px',
      maxWidth: '360px',
      minWidth: '260px',
    }}>
      {/* Header: name + verdict */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: textPrimary }}>{spot.shortName}</div>
        <div style={{
          fontSize: '11px',
          fontWeight: 700,
          color,
          background: `${color}26`,
          padding: '2px 8px',
          borderRadius: '6px',
          letterSpacing: '0.02em',
        }}>
          {verdictLabel(score)}
        </div>
      </div>

      {/* Data grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' }}>
        <DataCell label="Viento" value={windKt != null ? `${Math.round(windKt)} kt` : '—'} color={color} />
        <DataCell label="Dirección" value={dirView?.label ?? '—'} icon={dirDeg != null ? (
          <span style={{
            display: 'inline-block',
            transform: `rotate(${dirDeg + 180}deg)`,
            fontSize: '11px',
            marginRight: '3px',
          }}>↑</span>
        ) : undefined} />
        {gustKt != null && gustKt > 0 && (
          <DataCell label="Racha" value={`${Math.round(gustKt)} kt`} />
        )}
        {waveM != null && (
          <DataCell label="Olas" value={`${waveM.toFixed(1)} m`} />
        )}
        {temp != null && (
          <DataCell label="Temp" value={`${Math.round(temp)}°C`} />
        )}
        {score?.waterTemp != null && (
          <DataCell label="Agua" value={`${score.waterTemp.toFixed(1)}°C`} />
        )}
      </div>

      {/* Summary */}
      {ready && score.summary && (
        <div style={{ fontSize: '10px', color: textMuted, marginTop: '6px', lineHeight: '1.4' }}>
          {score.summary}
        </div>
      )}
    </div>
  );
}

// ── Data Cell ───────────────────────────────────────
function DataCell({ label, value, color, icon }: {
  label: string;
  value: string;
  color?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
      <span style={{ fontSize: '10px', color: textSecondary }}>{label}</span>
      <span style={{ fontSize: '12px', fontWeight: 600, color: color || textPrimary, fontVariantNumeric: 'tabular-nums' }}>
        {icon}{value}
      </span>
    </div>
  );
}

// ── Compact Row (single-line mode) ──────────────────
function CompactRow({ spots, scores }: { spots: SailingSpot[]; scores: Map<string, SpotScore> }) {
  return (
    <div style={{
      display: 'flex',
      gap: '8px',
      flexWrap: 'wrap',
      alignItems: 'center',
    }}>
      {spots.map((spot) => {
        const score = scores.get(spot.id) ?? null;
        const color = VERDICT_HEX[displayVerdict(score)];
        const windKt = displayWindKt(score);
        const dirLabel = score && !score.provisional ? displayWindDir(score)?.label ?? null : null;
        return (
          <div key={spot.id} style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: cardBg,
            border: `1px solid ${cardBorder}`,
            borderRadius: '8px',
            padding: '6px 10px',
          }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: color, flexShrink: 0 }} />
            <span style={{ fontSize: '12px', fontWeight: 600, color: textPrimary }}>{spot.shortName}</span>
            <span style={{ fontSize: '11px', color, fontWeight: 700 }}>
              {windKt != null ? `${Math.round(windKt)}kt` : '—'}
            </span>
            {dirLabel && <span style={{ fontSize: '10px', color: textSecondary }}>{dirLabel}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ── Loading Skeleton ────────────────────────────────
function LoadingSkeleton() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '16px',
      color: textSecondary,
      fontSize: '12px',
    }}>
      <div style={{
        width: '16px', height: '16px', borderRadius: '50%',
        border: `2px solid ${cardBorder}`, borderTopColor: linkColor,
        animation: 'widget-spin 0.8s linear infinite',
      }} />
      Cargando datos...
      <style>{`@keyframes widget-spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}

// ── Footer ──────────────────────────────────────────
function WidgetFooter() {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: '6px',
      paddingTop: '4px',
      borderTop: `1px solid ${isDark ? 'rgba(51,65,85,0.5)' : 'rgba(226,232,240,0.8)'}`,
    }}>
      <a
        href="https://meteomapgal.navia3d.com"
        target="_blank"
        rel="noopener noreferrer"
        style={{ fontSize: '9px', color: linkColor, textDecoration: 'none', fontWeight: 600 }}
      >
        MeteoMapGal
      </a>
      <span style={{ fontSize: '9px', color: textMuted }}>
        Datos en tiempo real
      </span>
    </div>
  );
}
