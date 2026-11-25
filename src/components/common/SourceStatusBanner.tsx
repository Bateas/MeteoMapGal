/**
 * Source status banner — shows a subtle warning when critical data sources
 * are down or returning errors. Appears below the header only when needed.
 *
 * Rules:
 * - Only shows for sources that have failed AND have no recent success (<10min)
 * - Auto-dismisses when source recovers
 * - Collapsible to avoid blocking content
 */

import { memo, useState, useMemo } from 'react';
import { useWeatherStore, type WeatherSource } from '../../store/weatherStore';
import { useShallow } from 'zustand/react/shallow';

const SOURCE_NAMES: Record<WeatherSource, string> = {
  aemet: 'AEMET',
  meteogalicia: 'MeteoGalicia',
  meteoclimatic: 'Meteoclimatic',
  wunderground: 'Weather Underground',
  netatmo: 'Netatmo',
  skyx: 'SkyX',
  ipma: 'IPMA (Portugal)',
};

/** Sources that trigger a visible banner when down */
const CRITICAL_SOURCES: WeatherSource[] = ['aemet', 'meteogalicia'];

/** All sources — shown as secondary info */
const ALL_SOURCES: WeatherSource[] = ['aemet', 'meteogalicia', 'meteoclimatic', 'wunderground', 'netatmo', 'skyx', 'ipma'];

/** Time threshold: source must be down for >5min before showing banner */
const STALE_THRESHOLD_MS = 10 * 60 * 1000;

export const SourceStatusBanner = memo(function SourceStatusBanner() {
  const [dismissed, setDismissed] = useState(false);
  const sourceFreshness = useWeatherStore(useShallow((s) => s.sourceFreshness));

  const downSources = useMemo(() => {
    const down: { source: WeatherSource; message: string; critical: boolean }[] = [];
    const now = Date.now();

    for (const source of ALL_SOURCES) {
      const status = sourceFreshness.get(source);
      if (!status) continue;

      const hasRecentSuccess = status.lastSuccess && (now - status.lastSuccess.getTime()) < STALE_THRESHOLD_MS;
      const hasError = status.lastError && (!status.lastSuccess || status.lastError > status.lastSuccess);

      if (hasError && !hasRecentSuccess) {
        const isCritical = CRITICAL_SOURCES.includes(source);
        const msg = status.errorMessage || 'Sin respuesta';
        down.push({ source, message: msg, critical: isCritical });
      }
    }

    return down;
  }, [sourceFreshness]);

  // Only show if there are critical sources down (or multiple non-critical)
  const criticalDown = downSources.filter((d) => d.critical);
  const shouldShow = criticalDown.length > 0 || downSources.length >= 2;

  if (!shouldShow || dismissed) return null;

  const isMultiple = downSources.length > 1;
  const names = downSources.map((d) => SOURCE_NAMES[d.source]);
  // What is missing, by name: a count says nothing to someone who does not know how many there are
  const mainLabel = `Faltan datos de ${names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}` : names[0]}`;

  return (
    <div className="g-theme gc-notice" role="alert" aria-live="polite">
      <span className="gc-dot gc-t-alto" />
      <span className="gc-notice-text">
        <b>{mainLabel}</b>
        {!isMultiple && downSources[0]?.message && <span className="gc-note">{downSources[0].message}</span>}
      </span>
      <button type="button" onClick={() => setDismissed(true)} className="gc-btn gc-btn--plain gc-btn--icon" aria-label="Cerrar aviso">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
});
