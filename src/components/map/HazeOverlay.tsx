/**
 * HazeOverlay — Saharan dust / calima visual cue.
 *
 * Auto-activates when Open-Meteo Air Quality reports moderate+ dust or AOD.
 * Renders a subtle brownish-ochre tint over the map viewport with smooth
 * 2s fade in / 5s fade out (mimicking the actual rise and slow clearance
 * of a calima episode).
 *
 * - No toggle: condition-driven, like FogOverlay.
 * - Pessimistic init (severity 'none' until data confirms).
 * - DOM overlay outside <Map>, `pointer-events: none` so it never
 *   blocks interactions.
 * - Lazy-loaded from WeatherMap behind <Suspense>.
 */

import { memo, useEffect, useMemo, useState } from 'react';
import { useAirQualityStore } from '../../store/airQualityStore';
import { useSectorStore } from '../../store/sectorStore';
import { useWeatherStore } from '../../store/weatherStore';
import { classifyHaze, type HazeSeverity } from '../../services/hazeService';
import {
  minVisibilityKm,
  selectRelevantVisibility,
  SECTOR_VISIBILITY_RADIUS_FACTOR,
  VISIBILITY_STALE_CHECK_INTERVAL_MS,
} from '../../services/visibilityFreshness';

const FADE_IN_MS = 2_000;
const FADE_OUT_MS = 5_000;

function HazeOverlayInner() {
  const data = useAirQualityStore((s) => s.data);
  const visibilityReadings = useWeatherStore((s) => s.visibilityReadings);
  const sectorCenter = useSectorStore((s) => s.activeSector.center);
  const sectorRadiusKm = useSectorStore((s) => s.activeSector.radiusKm);

  // Age is time-dependent but the store only pushes on a successful AEMET
  // poll — during an outage nothing would re-render this component, so the
  // frozen reading would stay eligible forever. Re-evaluate on our own clock.
  const [freshnessTick, setFreshnessTick] = useState(0);
  useEffect(() => {
    const i = setInterval(
      () => setFreshnessTick((t) => t + 1),
      VISIBILITY_STALE_CHECK_INTERVAL_MS,
    );
    return () => clearInterval(i);
  }, []);

  // multi-evidence cross-feed: AEMET vis < 2km confirms model calima and bumps
  // severity. Visibility alone never triggers (could be fog). The minimum is
  // taken over THIS sector's neighbourhood only — a global minimum let real
  // fog at Estaca de Bares or Fisterra (110-200km) tint the Embalse as heavy
  // calima. Stale readings are excluded for the same reason.
  const minVis = useMemo(() => {
    const [lon, lat] = sectorCenter;
    const relevant = selectRelevantVisibility(
      visibilityReadings,
      lat,
      lon,
      sectorRadiusKm * SECTOR_VISIBILITY_RADIUS_FACTOR,
    );
    return minVisibilityKm(relevant.values());
    // freshnessTick intentionally re-runs the age check over time
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibilityReadings, sectorCenter, sectorRadiusKm, freshnessTick]);

  const assessment = classifyHaze(data?.dust, data?.aerosolOpticalDepth, minVis);

  // Track displayed severity separately from current to drive fade-out
  // even when the latest data swings to 'none' (so the calima visually
  // dissipates instead of vanishing instantly)
  const [displayed, setDisplayed] = useState<HazeSeverity>('none');
  const [opacity, setOpacity] = useState(0);

  useEffect(() => {
    const target = assessment.severity;
    if (target !== 'none') {
      setDisplayed(target);
      // Slight delay so transition picks up
      const t = setTimeout(() => setOpacity(assessment.opacity), 16);
      return () => clearTimeout(t);
    }
    // Fade out
    setOpacity(0);
    const t = setTimeout(() => setDisplayed('none'), FADE_OUT_MS);
    return () => clearTimeout(t);
  }, [assessment.severity, assessment.opacity]);

  if (displayed === 'none' || !assessment.tint) return null;

  const [r, g, b] = assessment.tint;

  return (
    <div
      className="absolute inset-0 pointer-events-none z-[15]"
      style={{
        background: `linear-gradient(180deg, rgba(${r},${g},${b},${opacity}) 0%, rgba(${r},${g},${b},${opacity * 0.6}) 60%, rgba(${r},${g},${b},${opacity * 0.3}) 100%)`,
        transition: `background ${opacity > 0 ? FADE_IN_MS : FADE_OUT_MS}ms ease-${opacity > 0 ? 'in' : 'out'}`,
        // Mix-blend so map colors still bleed through — looks like atmospheric haze
        mixBlendMode: 'multiply',
      }}
      aria-hidden="true"
      data-haze-severity={displayed}
    />
  );
}

export const HazeOverlay = memo(HazeOverlayInner);
