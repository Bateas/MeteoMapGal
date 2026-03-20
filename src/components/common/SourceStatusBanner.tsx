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
};

/** Sources that trigger a visible banner when down */
const CRITICAL_SOURCES: WeatherSource[] = ['aemet', 'meteogalicia'];

/** All sources — shown as secondary info */
const ALL_SOURCES: WeatherSource[] = ['aemet', 'meteogalicia', 'meteoclimatic', 'wunderground', 'netatmo', 'skyx'];

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
  const mainLabel = isMultiple
    ? `${downSources.length} fuentes sin respuesta`
    : `${SOURCE_NAMES[downSources[0].source]} sin respuesta`;

  return (
    <div
      className="flex items-center gap-2 px-3 py-1 bg-amber-950/40 border-b border-amber-500/20 text-amber-300 text-[11px]"
      role="alert"
      aria-live="polite"
    >
      {/* Warning icon */}
      <svg className="w-3.5 h-3.5 shrink-0 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>

      <span className="flex-1 truncate">
        <span className="font-bold">{mainLabel}</span>
        {isMultiple && (
          <span className="text-amber-400/60 ml-1.5">
            ({downSources.map((d) => SOURCE_NAMES[d.source]).join(', ')})
          </span>
        )}
        {!isMultiple && downSources[0]?.message && (
          <span className="text-amber-400/60 ml-1.5">
            — {downSources[0].message}
          </span>
        )}
      </span>

      <span className="text-amber-500/50 text-[9px] shrink-0">Datos parciales</span>

      <button
        onClick={() => setDismissed(true)}
        className="ml-1 text-amber-500/40 hover:text-amber-300 transition-colors shrink-0"
        aria-label="Cerrar aviso"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
});
