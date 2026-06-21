/**
 * ConditionsTicker — scrolling marquee strip below header.
 *
 * Shows real-time highlights: top wind spots, gusts, waves, tide,
 * temperature, forecast. Auto-scrolls horizontally with CSS animation.
 * Mobile: limits to most relevant items to avoid overwhelming scroll.
 * Minimal overhead: reads from existing stores (no new fetches).
 */
import { memo, useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useWeather, useBuoy, useSpot } from '../../store/typedSelectors';
import { useSpotStore } from '../../store/spotStore';
import { useSectorStore } from '../../store/sectorStore';
import { isCoastalSector } from '../../config/sectors';
import { useForecastStore } from '../../hooks/useForecastTimeline';
import { useStormPrediction } from '../../hooks/useStormPrediction';
import { useWarningsStore } from '../../hooks/useWarnings';
import { useUIStore } from '../../store/uiStore';
import { useAirQualityStore } from '../../store/airQualityStore';
import { useAlertStore } from '../../store/alertStore';
import { useIcaStore } from '../../store/icaStore';
import { icaCategory } from '../../api/meteoGaliciaIcaClient';
import { useFireStore } from '../../store/fireStore';
import { getSpotsForSector, isBeachSpot } from '../../config/spots';
import { assessBeachDay, type BeachDayResult } from '../../services/beachDayService';
import { msToKnots } from '../../services/windUtils';
import { VERDICT_STYLE } from '../../config/verdictStyles';
import { detectThermalForecast } from '../../services/thermalForecastDetector';
import { assessSeaBreezeRias } from '../../services/seaBreezeService';
import { fetchTidePredictions, type TidePoint } from '../../api/tideClient';
import { isPeakUvHour, uvCategory, uvTickerLabel, UV_TICKER_THRESHOLD } from '../../services/uvService';
import {
  tideCoefficient,
  estimateStormSurge,
  nextAmplitude,
  tideTickerLabel,
  shouldShowTideAlert,
} from '../../services/tideAlertService';

/** Find the next tide point (high or low) relative to now */
function getNextTide(points: TidePoint[]): { point: TidePoint; isRising: boolean } | null {
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  for (let i = 0; i < points.length; i++) {
    if (points[i].time > hhmm) {
      return { point: points[i], isRising: points[i].type === 'high' };
    }
  }
  return null;
}

export const ConditionsTicker = memo(function ConditionsTicker() {
  const scores = useSpot.use.scores();
  const readings = useWeather.use.currentReadings();
  const stations = useWeather.use.stations();
  const buoyReadings = useBuoy.use.buoys();
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const forecastHourly = useForecastStore((s) => s.hourly);
  const stormPrediction = useStormPrediction();
  const mgWarnings = useWarningsStore((s) => s.sectorWarnings);
  const unifiedAlerts = useAlertStore((s) => s.alerts);
  const isMobile = useUIStore((s) => s.isMobile);

  // Touch pause state
  const [paused, setPaused] = useState(false);
  const pauseTimeout = useRef<ReturnType<typeof setTimeout>>();
  const handleTouch = useCallback(() => {
    setPaused(true);
    clearTimeout(pauseTimeout.current);
    pauseTimeout.current = setTimeout(() => setPaused(false), 4000);
  }, []);

  // Tide data — only fetch for Rías sector, cached 60min
  const [tidePoints, setTidePoints] = useState<TidePoint[]>([]);
  useEffect(() => {
    if (!isCoastalSector(sectorId)) { setTidePoints([]); return; }
    let cancelled = false;
    fetchTidePredictions().then(pts => { if (!cancelled) setTidePoints(pts); }).catch(() => {});
    const iv = setInterval(() => {
      if (document.hidden) return; // Skip fetch when tab is backgrounded
      fetchTidePredictions().then(pts => { if (!cancelled) setTidePoints(pts); }).catch(() => {});
    }, 60 * 60_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [sectorId]);

  const items = useMemo(() => {
    const result: { key: string; text: string; color: string; bg: string; priority: number }[] = [];
    const sectorLabel = sectorId === 'rias' ? 'Rías' : 'Embalse';

    // ── Spot verdicts (priority 10 = highest for non-calm, 1 for calm) ──
    const spots = getSpotsForSector(sectorId);
    const surfCache = useSpotStore.getState().surfWaveCache;
    for (const spot of spots) {
      const sc = scores.get(spot.id);
      const isSurf = spot.category === 'surf';

      // Surf spots: use wave cache for label
      if (isSurf) {
        const sw = surfCache.get(spot.id);
        if (sw) {
          const pri = sw.verdictLabel === 'FLAT' ? 1 : sw.verdictLabel === 'PEQUE' ? 3 : 7;
          result.push({
            key: `spot-${spot.id}`,
            text: `${spot.shortName}: ${sw.verdictLabel} ${sw.waveHeight.toFixed(1)}m`,
            color: sw.verdictLabel === 'FLAT' ? 'text-slate-400' : sw.verdictLabel === 'PEQUE' ? 'text-cyan-400' : 'text-blue-400',
            bg: sw.verdictLabel === 'FLAT' ? '' : 'bg-blue-900/25',
            priority: pri,
          });
        }
        continue;
      }

      // Sailing spots: use wind score
      if (!sc || sc.verdict === 'unknown') continue;
      const v = VERDICT_STYLE[sc.verdict];
      // T3-1 fix S136+3+3: prefer effectiveWindKt (detector-boosted) over raw
      // avgSpeedKt — keeps ticker aligned with SpotMarker + popup verdict
      // when Cesantes canalization / Bocana terral are active.
      const kt = sc.effectiveWindKt ?? sc.wind?.avgSpeedKt;
      const dir = sc.wind?.dominantDir ?? '';
      const pri = sc.verdict === 'calm' ? 1 : sc.verdict === 'light' ? 3 : sc.verdict === 'sailing' ? 7 : 10;
      result.push({
        key: `spot-${spot.id}`,
        text: `${spot.shortName}: ${v.label}${kt != null && sc.verdict !== 'calm' ? ` ${dir} ${kt.toFixed(0)}kt` : ''}`,
        color: v.text,
        bg: sc.verdict === 'calm' ? '' : 'bg-emerald-900/25',
        priority: pri,
      });
    }

    // ── Beach-day casual headline (coastal sector, daytime) — EJE ALCANCE ──
    // Reframes conditions as a casual "¿buen día de playa?" for the visitor who
    // doesn't read kt/verdict jargon. Picks the best beach spot in the sector
    // and runs the same assessBeachDay heuristic the SpotPopup uses. Positive
    // nudge only (great/ok): a "mal día" is comfort, not safety (danger has its
    // own items) and would be winter-long noise, so it's suppressed. Daytime
    // only — a beach verdict at night is absurd.
    if (isCoastalSector(sectorId)) {
      const beachHour = new Date().getHours();
      if (beachHour >= 8 && beachHour < 21) {
        const nowMs = Date.now();
        // Cloud + rain context from the sector forecast WHEN available — scores
        // alone (wind/air/water) already give assessBeachDay enough to commit,
        // so the casual headline still shows during a forecast hiccup (the reach
        // lever can't be hostage to the forecast fetch). precipitation (mm)
        // drives "raining now"; precipProbability is noisy on clear days (gotcha)
        // so it only softens to "rain soon", never marks a bad day on its own.
        let cloudCoverPct: number | null = null;
        let rainingNow = false;
        let rainSoon = false;
        if (forecastHourly.length > 0) {
          const curF = forecastHourly.reduce(
            (best, hh) => (Math.abs(hh.time.getTime() - nowMs) < Math.abs(best.time.getTime() - nowMs) ? hh : best),
            forecastHourly[0],
          );
          cloudCoverPct = curF.cloudCover ?? null;
          rainingNow = (curF.precipitation ?? 0) > 0.1;
          let rainSoonProb = 0;
          let rainSoonMm = 0;
          for (const hh of forecastHourly) {
            const dt = hh.time.getTime() - nowMs;
            if (dt >= 0 && dt < 4 * 3600_000) {
              rainSoonProb = Math.max(rainSoonProb, hh.precipProbability ?? 0);
              rainSoonMm = Math.max(rainSoonMm, hh.precipitation ?? 0);
            }
          }
          rainSoon = rainSoonMm > 0.2 || rainSoonProb >= 60;
        }
        const foggy = unifiedAlerts.some(
          (a) => a.category === 'fog' && (a.severity === 'high' || a.severity === 'critical'),
        );

        // Score every beach spot in the sector, keep the best verdict.
        const verdictRank: Record<string, number> = { great: 3, ok: 2, poor: 1, unknown: 0 };
        let bestBeach: { name: string; res: BeachDayResult } | null = null;
        for (const spot of spots) {
          if (!isBeachSpot(spot.id)) continue;
          const sc = scores.get(spot.id);
          if (!sc) continue;
          const res = assessBeachDay({
            cloudCoverPct,
            windKt: sc.effectiveWindKt ?? sc.wind?.avgSpeedKt ?? null,
            airTempC: sc.airTemp ?? null,
            waterTempC: sc.waterTemp ?? null,
            rainingNow,
            rainSoon,
            foggy,
          });
          if (res.verdict !== 'great' && res.verdict !== 'ok') continue;
          if (!bestBeach || verdictRank[res.verdict] > verdictRank[bestBeach.res.verdict]) {
            bestBeach = { name: spot.shortName, res };
          }
        }
        if (bestBeach) {
          const great = bestBeach.res.verdict === 'great';
          const reason = bestBeach.res.reasons.length > 0
            ? ` · ${bestBeach.res.reasons.slice(0, 2).join(', ')}`
            : '';
          result.push({
            key: 'beach-day',
            text: `¿Playa? ${bestBeach.res.summary} en ${bestBeach.name}${reason}`,
            color: great ? 'text-emerald-300' : 'text-amber-300',
            bg: great ? 'bg-emerald-900/25' : 'bg-amber-900/20',
            priority: great ? 9 : 8,
          });
        }
      }
    }

    // ── Max gust across stations (priority 8) ──
    let maxGust = 0;
    let maxGustStation = '';
    for (const st of stations) {
      const r = readings.get(st.id);
      if (r?.windGust != null && r.windGust > maxGust) {
        maxGust = r.windGust;
        maxGustStation = st.name;
      }
    }
    if (maxGust > 3) {
      result.push({
        key: 'max-gust',
        text: `Racha máx: ${msToKnots(maxGust).toFixed(0)}kt ${maxGustStation}`,
        color: maxGust > 8 ? 'text-orange-400' : 'text-slate-300',
        bg: maxGust > 8 ? 'bg-amber-900/25' : '',
        priority: 8,
      });
    }

    // ── Max wave height from buoys (priority 6) ──
    let maxWave = 0;
    let maxWaveName = '';
    for (const br of buoyReadings) {
      if (br.waveHeight != null && br.waveHeight > maxWave) {
        maxWave = br.waveHeight;
        maxWaveName = br.stationName;
      }
    }
    if (maxWave > 0.3) {
      result.push({
        key: 'max-wave',
        text: `Olas: ${maxWave.toFixed(1)}m ${maxWaveName}`,
        color: maxWave > 2 ? 'text-cyan-400' : 'text-slate-300',
        bg: 'bg-cyan-900/20',
        priority: 6,
      });
    }

    // NOTE: regional temperature range ("Temp X°–Y°C entre estación A y B")
    // removed S136+3+5 — it's a sector-wide spread that doesn't change any
    // decision RIGHT NOW (reactive-map doctrine: regional averages/ranges =
    // noise). Microclimate detail lives on the map (temperature overlay +
    // per-station markers), not the ticker.

    // ── Tide info — Rías only (priority 7) ──
    if (isCoastalSector(sectorId) && tidePoints.length > 0) {
      const next = getNextTide(tidePoints);
      if (next) {
        const label = next.point.type === 'high' ? 'Pleamar' : 'Bajamar';
        const arrow = next.isRising ? '↑' : '↓';
        result.push({
          key: 'tide-next',
          text: `Marea ${arrow} ${label} ${next.point.time}h (${next.point.height.toFixed(1)}m)`,
          color: 'text-cyan-400',
          bg: 'bg-cyan-900/20',
          priority: 7,
        });

        // ── Aguas vivas / storm-surge alert (priority 8-9) ──
        // Compute coef from the next consecutive amplitude. Cross-check buoy
        // pressure for inverse-barometric surge (≥ 0.2 m worth surfacing).
        const amp = nextAmplitude(tidePoints);
        const coef = tideCoefficient(amp);
        // Cheapest/freshest pressure: any buoy reporting airPressure (Cabo
        // Silleiro typical). Pick the lowest — we want surge worst-case.
        let minPressure: number | null = null;
        for (const b of buoyReadings.values()) {
          if (b.airPressure != null && (minPressure == null || b.airPressure < minPressure)) {
            minPressure = b.airPressure;
          }
        }
        const surge = estimateStormSurge(minPressure);
        if (coef != null && shouldShowTideAlert(coef, surge)) {
          const isExtreme = coef >= 100;
          result.push({
            key: 'tide-alert',
            text: tideTickerLabel(coef, next.point, surge),
            color: isExtreme ? 'text-cyan-200' : 'text-cyan-300',
            bg: isExtreme ? 'bg-cyan-800/30' : 'bg-cyan-900/25',
            priority: isExtreme ? 9 : 8,
          });
        }
      }
    }

    // ── Forecast summary (priority 5) ──
    if (forecastHourly.length > 0) {
      const now = new Date();
      const todayStr = now.toDateString();
      const futureToday = forecastHourly.filter(h =>
        h.time.toDateString() === todayStr && h.time > now,
      );
      if (futureToday.length >= 3) {
        const maxWind = Math.max(...futureToday.map(h => h.windSpeed ?? 0));
        const maxRainProb = Math.max(...futureToday.map(h => h.precipProbability ?? 0));
        const maxWindKt = Math.round(msToKnots(maxWind));

        if (maxWindKt > 5) {
          result.push({
            key: 'fcst-wind',
            text: `Prev ${sectorLabel}: viento máx ${maxWindKt}kt hoy`,
            color: maxWindKt > 15 ? 'text-orange-400' : 'text-sky-400',
            bg: 'bg-sky-900/20',
            priority: 5,
          });
        }
        if (maxRainProb >= 40) {
          result.push({
            key: 'fcst-rain',
            text: `Prev ${sectorLabel}: lluvia ${maxRainProb}% hoy`,
            color: maxRainProb >= 70 ? 'text-amber-400' : 'text-slate-400',
            bg: maxRainProb >= 70 ? 'bg-amber-900/25' : '',
            priority: 4,
          });
        }
      }

      // Thermal forecast early warning (priority 9)
      const thermalSignals = detectThermalForecast(forecastHourly);
      for (const s of thermalSignals) {
        const color = s.confidence === 'alta' ? 'text-green-400' : s.confidence === 'media' ? 'text-blue-400' : 'text-slate-400';
        result.push({
          key: `thermal-fcst-${s.day}`,
          text: `${sectorLabel}: ${s.label}`,
          color,
          bg: 'bg-amber-900/25',
          priority: 9,
        });
      }
    }

    // ── sky_state FOG/STORMS forecast from MeteoSIX (priority 8) ──
    if (forecastHourly.length > 0) {
      const now2 = new Date();
      const next12h = forecastHourly.filter(h => {
        const diff = h.time.getTime() - now2.getTime();
        return diff >= 0 && diff < 12 * 3600_000;
      });

      // First FOG in forecast
      const fogHour = next12h.find(h => h.skyState === 'FOG' || h.skyState === 'FOG_BANK' || h.skyState === 'MIST');
      if (fogHour) {
        const hh = fogHour.time.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false });
        result.push({
          key: 'fcst-fog',
          text: `Niebla prevista ${hh}`,
          color: 'text-slate-300',
          bg: 'bg-slate-700/30',
          priority: 8,
        });
      }

      // First STORMS in forecast
      const stormHour = next12h.find(h =>
        h.skyState === 'STORMS' || h.skyState === 'STORM_THEN_CLOUDY' || h.skyState === 'NIGHT_STORMS' || h.skyState === 'RAIN_HAIL',
      );
      if (stormHour) {
        const hh = stormHour.time.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false });
        result.push({
          key: 'fcst-storm-sky',
          text: `WRF prevé tormentas ${hh}`,
          color: 'text-purple-400',
          bg: 'bg-purple-900/25',
          priority: 8,
        });
      }
    }

    // ── Real-time thermal precursors (priority 9) — Embalse + thermal spots ──
    if (sectorId === 'embalse') {
      const precursors = useSpotStore.getState().thermalPrecursors;
      for (const [spotId, p] of precursors) {
        if (p.probability < 30 || p.level === 'none') continue;
        const color = p.level === 'imminent' || p.level === 'active' ? 'text-green-400'
          : p.level === 'probable' ? 'text-amber-400' : 'text-blue-400';
        const etaStr = p.eta ? ` — ${p.eta}` : '';
        result.push({
          key: `precursor-${spotId}`,
          text: `Precursor: ${p.probability}% ${p.level === 'active' ? 'ACTIVO' : p.level === 'imminent' ? 'INMINENTE' : ''}${etaStr}`,
          color,
          bg: 'bg-amber-900/25',
          priority: p.level === 'active' || p.level === 'imminent' ? 10 : 9,
        });
      }
    }

    // ── Storm prediction (priority 11 = highest urgency) ──
    if (stormPrediction.probability >= 25) {
      const isImminent = stormPrediction.horizon === 'imminent';
      const isLikely = stormPrediction.horizon === 'likely';
      const etaStr = stormPrediction.etaMinutes != null && stormPrediction.etaMinutes < 120
        ? ` ETA ~${stormPrediction.etaMinutes}min`
        : '';
      const text = isImminent
        ? `TORMENTA INMINENTE ${stormPrediction.probability}%${etaStr}`
        : isLikely
        ? `Tormenta probable ${stormPrediction.probability}%${etaStr}`
        : `Riesgo tormenta ${stormPrediction.probability}%`;
      result.push({
        key: 'storm-prediction',
        text,
        color: isImminent ? 'text-purple-400' : isLikely ? 'text-amber-400' : 'text-slate-400',
        bg: isImminent ? 'bg-purple-900/30' : isLikely ? 'bg-amber-900/25' : '',
        priority: isImminent ? 11 : isLikely ? 10 : 6,
      });
    }

    // ── MG official warnings — NOT pushed to the ticker ──
    // Rendered as a static strip ABOVE the marquee (see return block below).
    // Reason: official MeteoGalicia AMARILLO/NARANJA/ROJO warnings are too
    // critical to bury in a scrolling strip — the user reported they get
    // cut off / stacked. Static strip means they're always visible without
    // waiting for the marquee to cycle.

    // ── UV warning — only in peak hours (12-16h) and only actionable values ──
    // Reactive map philosophy: UV during off-peak hours doesn't change a user's
    // current decision (no real exposure outside the window). Threshold raised
    // from ≥6 to ≥7 to dedupe with the standard "high" threshold; sub-7 is the
    // upper-half of "moderate" and the user usually knows already.
    const aq = useAirQualityStore.getState().data;
    if (aq && aq.uvIndex >= UV_TICKER_THRESHOLD && isPeakUvHour()) {
      const uvRounded = Math.round(aq.uvIndex);
      const cat = uvCategory(uvRounded);
      const isExtreme = cat === 'extreme';
      const isVeryHigh = cat === 'very_high';
      result.push({
        key: 'uv-index',
        text: uvTickerLabel(uvRounded),
        color: isExtreme ? 'text-purple-400' : isVeryHigh ? 'text-red-400' : 'text-amber-400',
        bg: isExtreme ? 'bg-purple-900/25' : isVeryHigh ? 'bg-red-900/20' : 'bg-amber-900/20',
        priority: isExtreme ? 8 : isVeryHigh ? 6 : 4,
      });
    }

    // ── Air quality warning (priority 5 — only when poor) ──
    // PRIMARY: MeteoGalicia ICA (official Xunta, station-by-station). When any
    // station registers ICA ≥ 2.5 (deficiente or worse), surface the worst one.
    // FALLBACK: Open-Meteo European AQI when ICA has no readings yet (boot or
    // outage at ideg.xunta.gal).
    const icaReadings = useIcaStore.getState().readings;
    if (icaReadings.length > 0) {
      let worst: typeof icaReadings[0] | null = null;
      for (const r of icaReadings) {
        if ((!worst || r.ica > worst.ica) && r.ica >= 2.5) worst = r;
      }
      if (worst) {
        const cat = icaCategory(worst.ica);
        const labelEs = worst.categoryEs || (cat === 'muy_mala' ? 'Muy mala' : cat === 'mala' ? 'Mala' : 'Deficiente');
        const isSevere = cat === 'mala' || cat === 'muy_mala';
        // Expand pollutant code so non-technical users understand what's high.
        // The label "Calidad del aire" (feminine) agrees with categoryEs values
        // ("Moderada", "Mala") — earlier "Aire Moderada" was a gender mismatch.
        const pollutantEs = ({
          O3: 'ozono', NO2: 'NO₂', PM10: 'partículas PM10',
          PM25: 'PM2.5', 'PM2.5': 'PM2.5', SO2: 'SO₂', CO: 'CO',
        } as Record<string, string>)[worst.dominantPollutant] ?? worst.dominantPollutant;
        result.push({
          key: 'air-quality',
          text: `Calidad del aire ${labelEs.toLowerCase()} en ${worst.station}${pollutantEs ? ` · ${pollutantEs}` : ''}`,
          color: isSevere ? 'text-red-400' : 'text-orange-400',
          bg: isSevere ? 'bg-red-900/20' : 'bg-orange-900/20',
          priority: isSevere ? 7 : 5,
        });
      }
    } else if (aq && aq.europeanAqi >= 60) {
      // Fallback to Open-Meteo when ICA hasn't loaded
      const aqLabel = aq.europeanAqi >= 80 ? 'Muy mala' : 'Mala';
      const pm25Label = aq.pm2_5 >= 35 ? ` (PM2.5 ${Math.round(aq.pm2_5)})` : '';
      result.push({
        key: 'air-quality',
        text: `Calidad del aire: ${aqLabel}${pm25Label}`,
        color: aq.europeanAqi >= 80 ? 'text-red-400' : 'text-orange-400',
        bg: aq.europeanAqi >= 80 ? 'bg-red-900/20' : 'bg-orange-900/20',
        priority: aq.europeanAqi >= 80 ? 7 : 5,
      });
    }

    // ── Active wildfires warning (NASA FIRMS, priority 6 — high) ──
    const fires = useFireStore.getState().fires;
    if (fires.length > 0) {
      const maxFrp = fires.reduce((m, f) => Math.max(m, f.frp), 0);
      const isLarge = maxFrp >= 100 || fires.length >= 5;
      result.push({
        key: 'active-fires',
        text: fires.length === 1
          ? `🔥 1 foco activo${maxFrp >= 50 ? ` (${Math.round(maxFrp)}MW)` : ''}`
          : `🔥 ${fires.length} focos activos${isLarge ? ` (max ${Math.round(maxFrp)}MW)` : ''}`,
        color: isLarge ? 'text-red-400' : 'text-orange-400',
        bg: isLarge ? 'bg-red-900/20' : 'bg-orange-900/20',
        priority: isLarge ? 7 : 6,
      });
    }

    // ── Sea breeze / viración térmica engine (priority 6 — Rías only) ──
    // Sector-wide thermal driver: when inland heats well above the coast on a
    // summer afternoon, the breeze fills in. Tells the user the engine is ON
    // before any individual spot flips. Phase A surface (ticker); animated
    // front arrow is Phase B.
    if (isCoastalSector(sectorId)) {
      const breeze = assessSeaBreezeRias(readings, stations);
      if (breeze.active && breeze.phase !== 'building') {
        // Only surface once the breeze has actually filled in (active/mature) —
        // 'building' is too speculative for the ticker.
        result.push({
          key: 'sea-breeze',
          text: `Brisa marina ${breeze.phase === 'mature' ? 'plena' : 'activa'}${breeze.deltaT != null ? ` · Δ${breeze.deltaT.toFixed(0)}°C costa-interior` : ''}`,
          color: 'text-emerald-400',
          bg: 'bg-emerald-900/20',
          priority: 6,
        });
      }
    }

    // ── Upwelling / coastal cold-water rise (priority 5 — Rías only) ──
    // Surface the upwelling alert that the pipeline builds but previously
    // never reached the user (only AlertPanel). Useful for divers/anglers:
    // N/NW wind drives Ekman transport → cold deep water rises → fish move.
    if (isCoastalSector(sectorId)) {
      const up = unifiedAlerts.find((a) => a.category === 'upwelling');
      if (up) {
        result.push({
          key: 'upwelling',
          text: `Afloramiento: ${up.title}${up.detail ? ` · ${up.detail}` : ''}`,
          color: 'text-cyan-400',
          bg: 'bg-cyan-900/20',
          priority: up.urgent ? 6 : 5,
        });
      }
    }

    // ── Data-quality WARNING (priority 1) — only when significantly degraded ──
    // The routine "N/M estaciones activas" count was sector-level noise (a
    // status count doesn't change a decision NOW). Keep only the warning when
    // many stations have gone stale → the map is less trustworthy right now.
    const staleCount = stations.filter(s => {
      const r = readings.get(s.id);
      if (!r?.timestamp) return false;
      return (Date.now() - r.timestamp.getTime()) > 30 * 60_000;
    }).length;
    if (staleCount > 10) {
      result.push({
        key: 'station-status',
        text: `Datos parciales — ${staleCount} estaciones sin actualizar`,
        color: 'text-amber-400',
        bg: '',
        priority: 1,
      });
    }

    // ── Fallback ──
    if (result.length === 0 && stations.length > 0) {
      result.push({
        key: 'station-count',
        text: `${stations.length} estaciones activas`,
        color: 'text-slate-400',
        bg: '',
        priority: 0,
      });
    }

    // Sort by priority descending, then cap so the marquee stays readable
    // instead of an endless scroll (the "se hace enorme" problem on desktop,
    // which had NO cap). The priority sort keeps the decision-relevant items
    // (storm, spot verdicts, waves, tide); secondary ones (UV, fire, ICA,
    // afloramiento) still appear when nothing more urgent is happening, but
    // cede their place during busy conditions — no content type is removed,
    // it's prioritised by what matters NOW.
    result.sort((a, b) => b.priority - a.priority);

    const cap = isMobile ? 6 : 9;
    return result.length > cap ? result.slice(0, cap) : result;
  }, [scores, readings, stations, buoyReadings, sectorId, forecastHourly, stormPrediction, mgWarnings, unifiedAlerts, tidePoints, isMobile]);

  // ── Official MG warnings — static strip above the marquee ─────
  // Highest-priority signals (AMARILLO/NARANJA/ROJO from MeteoGalicia RSS).
  // Stacked vertically when there are several so the user sees ALL of them
  // immediately without waiting for the ticker to cycle.
  const officialWarnings = useMemo(() => {
    return mgWarnings.map((w) => {
      const levelLabel = w.maxLevel === 3 ? 'ROJO' : w.maxLevel === 2 ? 'NARANJA' : 'AMARILLO';
      const zoneNames = w.zones.map((z) => z.name).join(', ');
      const color = w.maxLevel === 3
        ? 'text-red-200'
        : w.maxLevel === 2 ? 'text-orange-200' : 'text-yellow-200';
      const bg = w.maxLevel === 3
        ? 'bg-red-950/70 border-l-red-500'
        : w.maxLevel === 2
          ? 'bg-orange-950/60 border-l-orange-500'
          : 'bg-yellow-950/50 border-l-yellow-500';
      const chipColor = w.maxLevel === 3
        ? 'bg-red-500/30 text-red-100'
        : w.maxLevel === 2 ? 'bg-orange-500/30 text-orange-100' : 'bg-yellow-500/25 text-yellow-100';
      return {
        key: `mg-${w.typeId}-${w.maxLevel}`,
        levelLabel,
        type: w.type,
        zoneNames,
        color,
        bg,
        chipColor,
      };
    });
  }, [mgWarnings]);

  if (items.length === 0 && officialWarnings.length === 0) return null;

  // Dynamic animation speed: ~8s per item (more items = slower scroll)
  const duration = Math.max(20, items.length * 8);

  // Duplicate items for seamless loop
  const tickerContent = [...items, ...items];

  return (
    <div className="flex-shrink-0">
      {/* ── Static official warnings strip ── */}
      {officialWarnings.length > 0 && (
        <div className="flex flex-col">
          {officialWarnings.map((w) => (
            <div
              key={w.key}
              role="alert"
              className={`flex items-center gap-2 px-3 py-1 text-[11px] border-l-4 border-b border-slate-800/60 ${w.bg} ${w.color}`}
            >
              <span className={`font-bold uppercase tracking-wide px-1.5 py-0.5 rounded text-[10px] ${w.chipColor}`}>
                Aviso {w.levelLabel}
              </span>
              <span className="font-semibold">{w.type}</span>
              <span className="opacity-60">·</span>
              <span className="opacity-90 truncate">{w.zoneNames}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Scrolling ticker (everything else) ── */}
      {items.length > 0 && (
    <div
      role="marquee"
      aria-label="Condiciones meteorológicas en tiempo real"
      className="h-7 bg-slate-900/80 border-b border-slate-700/50 overflow-hidden relative flex"
    >
      <button
        onClick={() => setPaused(p => !p)}
        className="flex-shrink-0 w-8 h-7 flex items-center justify-center text-slate-500 hover:text-slate-300 transition-colors border-r border-slate-700/50"
        aria-label={paused ? 'Reanudar ticker de alertas' : 'Pausar ticker de alertas'}
        title={paused ? 'Reanudar' : 'Pausar'}
      >
        {paused ? (
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
        ) : (
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
        )}
      </button>
      <div
        className="flex-1 overflow-hidden"
        onClick={handleTouch}
        onTouchStart={handleTouch}
      >
        <div
          className="ticker-scroll flex items-center h-full gap-6 whitespace-nowrap px-4"
          style={{
            animationDuration: `${duration}s`,
            animationPlayState: paused ? 'paused' : 'running',
          }}
        >
          {tickerContent.map((item, i) => (
            <span key={`${item.key}-${i}`} className={`text-[11px] font-medium ${item.color} flex items-center gap-1 ${item.bg ? `${item.bg} px-2 py-0.5 rounded` : ''}`}>
              <span className="w-1 h-1 rounded-full bg-current opacity-50" />
              {item.text}
            </span>
          ))}
        </div>
      </div>
    </div>
      )}
    </div>
  );
});
