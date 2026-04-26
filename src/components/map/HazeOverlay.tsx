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

import { memo, useEffect, useState } from 'react';
import { useAirQualityStore } from '../../store/airQualityStore';
import { classifyHaze, type HazeSeverity } from '../../services/hazeService';

const FADE_IN_MS = 2_000;
const FADE_OUT_MS = 5_000;

function HazeOverlayInner() {
  const data = useAirQualityStore((s) => s.data);
  const assessment = classifyHaze(data?.dust, data?.aerosolOpticalDepth);

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
