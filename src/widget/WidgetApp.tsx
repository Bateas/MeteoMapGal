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
 */
import { useEffect, useState } from 'react';
import { getSpotsForSector, ALL_SPOTS } from '../config/spots';
import type { SpotId, SailingSpot } from '../config/spots';
import type { SpotScore, SpotVerdict } from '../services/spotScoringEngine';
import { scoreAllSpots } from '../services/spotScoringEngine';
import { degToCardinal8 } from '../services/windUtils';
import { discoverStations } from '../api/stationDiscovery';
import { fetchAllObservations } from '../api/aemetClient';
import { fetchLatestForStations } from '../api/meteogaliciaClient';
import { fetchMeteoclimaticFeed } from '../api/meteoclimaticClient';
import { fetchWUObservations } from '../api/wundergroundClient';
import { fetchNetatmoObservations } from '../api/netatmoClient';
import { fetchSkyXReading } from '../api/skyxClient';
import { fetchAllRiasBuoys, mergeBuoyReadings } from '../api/buoyClient';
import { fetchAllObsReadings } from '../api/observatorioCosteiro';
import {
  normalizeAemetObservation,
  normalizeMeteoGaliciaObservation,
  normalizeMeteoclimaticObservation,
} from '../services/normalizer';
import type { NormalizedReading } from '../types/station';
import { SECTORS } from '../config/sectors';

// ── URL params ──────────────────────────────────────
const params = new URLSearchParams(window.location.search);
const paramSpot = params.get('spot') as SpotId | null;
const paramSector = params.get('sector') || 'rias';
const paramTheme = params.get('theme') || 'dark';
const paramCompact = params.get('compact') === 'true';

// ── Verdict styling ─────────────────────────────────
const VERDICT: Record<SpotVerdict, { color: string; bg: string; label: string }> = {
  calm:    { color: '#94a3b8', bg: 'rgba(100,116,139,0.2)', label: 'Calma' },
  light:   { color: '#4ade80', bg: 'rgba(34,197,94,0.15)',  label: 'Flojo' },
  sailing: { color: '#bef264', bg: 'rgba(163,230,53,0.15)', label: 'Navegable' },
  good:    { color: '#facc15', bg: 'rgba(234,179,8,0.15)',  label: 'Buen día' },
  strong:  { color: '#fb923c', bg: 'rgba(249,115,22,0.15)', label: 'Fuerte' },
  unknown: { color: '#94a3b8', bg: 'rgba(100,116,139,0.2)', label: 'Sin datos' },
};

const isDark = paramTheme === 'dark';
const rootBg = isDark ? '#0f172a' : '#ffffff';
const cardBg = isDark ? '#1e293b' : '#f8fafc';
const cardBorder = isDark ? '#334155' : '#e2e8f0';
const textPrimary = isDark ? '#e2e8f0' : '#1e293b';
const textSecondary = isDark ? '#94a3b8' : '#64748b';
const textMuted = isDark ? '#64748b' : '#94a3b8';
const linkColor = isDark ? '#60a5fa' : '#2563eb';

export function WidgetApp() {
  const [scores, setScores] = useState<Map<SpotId, SpotScore>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Determine which spots to show
  const spots: SailingSpot[] = paramSpot
    ? ALL_SPOTS.filter((s) => s.id === paramSpot)
    : getSpotsForSector(paramSector);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        const sector = SECTORS.find((s) => s.id === paramSector);
        if (!sector) { setError('Sector no válido'); setLoading(false); return; }

        // 1. Discover stations
        const stations = await discoverStations({
          center: sector.center,
          radiusKm: sector.radiusKm,
          meteoclimaticRegions: sector.meteoclimaticRegions,
          extraCoveragePoints: sector.extraCoveragePoints,
          sectorId: sector.id,
        });
        if (cancelled) return;

        // 2. Fetch observations in parallel
        const readings = new Map<string, NormalizedReading>();
        const aemetIds = stations.filter((s) => s.id.startsWith('aemet_')).map((s) => s.id.replace('aemet_', ''));
        const mgIds = stations.filter((s) => s.id.startsWith('mg_')).map((s) => s.id.replace('mg_', ''));

        const results = await Promise.allSettled([
          aemetIds.length > 0 ? fetchAllObservations(aemetIds).catch(() => []) : Promise.resolve([]),
          mgIds.length > 0 ? fetchLatestForStations(mgIds).catch(() => []) : Promise.resolve([]),
          fetchMeteoclimaticFeed(sector.meteoclimaticRegions).catch(() => []),
          fetchWUObservations(stations.filter((s) => s.id.startsWith('wu_'))).catch(() => []),
          fetchNetatmoObservations(sector.center, sector.radiusKm).catch(() => []),
          fetchSkyXReading().catch(() => null),
        ]);
        if (cancelled) return;

        // Process AEMET
        const aemetObs = results[0].status === 'fulfilled' ? results[0].value : [];
        for (const obs of (aemetObs as Array<Record<string, unknown>>)) {
          const r = normalizeAemetObservation(obs);
          if (r) readings.set(r.stationId, r);
        }
        // Process MG
        const mgObs = results[1].status === 'fulfilled' ? results[1].value : [];
        for (const obs of (mgObs as Array<Record<string, unknown>>)) {
          const r = normalizeMeteoGaliciaObservation(obs);
          if (r) readings.set(r.stationId, r);
        }
        // Process MC
        const mcObs = results[2].status === 'fulfilled' ? results[2].value : [];
        for (const obs of (mcObs as Array<Record<string, unknown>>)) {
          const r = normalizeMeteoclimaticObservation(obs);
          if (r) readings.set(r.stationId, r);
        }
        // Process WU
        const wuObs = results[3].status === 'fulfilled' ? results[3].value : [];
        for (const r of (wuObs as NormalizedReading[])) {
          readings.set(r.stationId, r);
        }
        // Process Netatmo
        const ntObs = results[4].status === 'fulfilled' ? results[4].value : [];
        for (const r of (ntObs as NormalizedReading[])) {
          readings.set(r.stationId, r);
        }
        // Process SkyX
        const skyxReading = results[5].status === 'fulfilled' ? results[5].value : null;
        if (skyxReading) readings.set((skyxReading as NormalizedReading).stationId, skyxReading as NormalizedReading);

        // 3. Fetch buoys (Rías only)
        let buoys: import('../api/buoyClient').BuoyReading[] = [];
        if (paramSector === 'rias') {
          try {
            const [portus, obs] = await Promise.allSettled([
              fetchAllRiasBuoys(),
              fetchAllObsReadings(),
            ]);
            const portusData = portus.status === 'fulfilled' ? portus.value : [];
            const obsData = obs.status === 'fulfilled' ? obs.value : [];
            buoys = mergeBuoyReadings(portusData, obsData);
          } catch { /* buoys optional */ }
        }
        if (cancelled) return;

        // 4. Score spots
        const spotsToScore = paramSpot
          ? ALL_SPOTS.filter((s) => s.id === paramSpot)
          : getSpotsForSector(paramSector);
        const scored = scoreAllSpots(spotsToScore, stations, readings, buoys);
        setScores(scored);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          console.error('[Widget] Error loading data:', err);
          setError('Error cargando datos');
          setLoading(false);
        }
      }
    }

    loadData();

    // Auto-refresh every 5 minutes
    const refreshId = setInterval(() => { loadData(); }, 5 * 60_000);

    return () => { cancelled = true; clearInterval(refreshId); };
  }, []);  

  return (
    <div style={{
      background: rootBg,
      padding: paramCompact ? '4px' : '8px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      minHeight: paramCompact ? 'auto' : '80px',
    }}>
      {error ? (
        <div style={{ color: '#f87171', fontSize: '12px', padding: '12px' }}>{error}</div>
      ) : loading ? (
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
function SpotCard({ spot, score }: { spot: SailingSpot; score: SpotScore | null }) {
  const v = score ? VERDICT[score.verdict] : VERDICT.unknown;
  const windKt = score?.wind?.avgKt ?? null;
  const gustKt = score?.wind?.gustKt ?? null;
  const dir = score?.windDirDeg != null ? degToCardinal8(score.windDirDeg) : null;
  const waveM = score?.waves?.height ?? null;
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
          color: v.color,
          background: v.bg,
          padding: '2px 8px',
          borderRadius: '6px',
          letterSpacing: '0.02em',
        }}>
          {v.label}
        </div>
      </div>

      {/* Data grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' }}>
        <DataCell label="Viento" value={windKt != null ? `${Math.round(windKt)} kt` : '—'} color={v.color} />
        <DataCell label="Dirección" value={dir ?? '—'} icon={score?.windDirDeg != null ? (
          <span style={{
            display: 'inline-block',
            transform: `rotate(${(score.windDirDeg ?? 0) + 180}deg)`,
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
      {score?.summary && (
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
function CompactRow({ spots, scores }: { spots: SailingSpot[]; scores: Map<SpotId, SpotScore> }) {
  return (
    <div style={{
      display: 'flex',
      gap: '8px',
      flexWrap: 'wrap',
      alignItems: 'center',
    }}>
      {spots.map((spot) => {
        const score = scores.get(spot.id);
        const v = score ? VERDICT[score.verdict] : VERDICT.unknown;
        const windKt = score?.wind?.avgKt ?? null;
        const dir = score?.windDirDeg != null ? degToCardinal8(score.windDirDeg) : '';
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
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: v.color, flexShrink: 0 }} />
            <span style={{ fontSize: '12px', fontWeight: 600, color: textPrimary }}>{spot.shortName}</span>
            <span style={{ fontSize: '11px', color: v.color, fontWeight: 700 }}>
              {windKt != null ? `${Math.round(windKt)}kt` : '—'}
            </span>
            {dir && <span style={{ fontSize: '10px', color: textSecondary }}>{dir}</span>}
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
