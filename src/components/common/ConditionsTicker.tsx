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
import { useForecastStore } from '../../hooks/useForecastTimeline';
import { useStormPrediction } from '../../hooks/useStormPrediction';
import { useWarningsStore } from '../../hooks/useWarnings';
import { useUIStore } from '../../store/uiStore';
import { getSpotsForSector } from '../../config/spots';
import { msToKnots } from '../../services/windUtils';
import { VERDICT_STYLE } from '../../config/verdictStyles';
import { detectThermalForecast } from '../../services/thermalForecastDetector';
import { fetchTidePredictions, type TidePoint } from '../../api/tideClient';

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
    if (sectorId !== 'rias') { setTidePoints([]); return; }
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
      const kt = sc.wind?.avgSpeedKt;
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

    // ── Temperature extremes (priority 2) ──
    let minTemp = 999, maxTemp = -999;
    let minTempSt = '', maxTempSt = '';
    for (const st of stations) {
      const r = readings.get(st.id);
      if (r?.temperature == null) continue;
      if (r.temperature < minTemp) { minTemp = r.temperature; minTempSt = st.name; }
      if (r.temperature > maxTemp) { maxTemp = r.temperature; maxTempSt = st.name; }
    }
    if (maxTemp > -999 && maxTemp - minTemp > 2) {
      result.push({
        key: 'temp-range',
        text: `Temp: ${minTemp.toFixed(0)}°–${maxTemp.toFixed(0)}°C (${minTempSt}–${maxTempSt})`,
        color: 'text-slate-300',
        bg: '',
        priority: 2,
      });
    }

    // ── Tide info — Rías only (priority 7) ──
    if (sectorId === 'rias' && tidePoints.length > 0) {
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

    // ── MG official warnings (priority 10 — high visibility) ──
    for (const w of mgWarnings) {
      const levelLabel = w.maxLevel === 3 ? 'ROJO' : w.maxLevel === 2 ? 'NARANJA' : 'AMARILLO';
      const color = w.maxLevel === 3 ? 'text-red-400' : w.maxLevel === 2 ? 'text-orange-400' : 'text-yellow-400';
      const bg = w.maxLevel >= 2 ? 'bg-orange-900/25' : 'bg-yellow-900/20';
      const zoneNames = w.zones.map((z) => z.name).join(', ');
      result.push({
        key: `mg-${w.typeId}-${w.maxLevel}`,
        text: `Aviso ${levelLabel}: ${w.type} · ${zoneNames}`,
        color,
        bg,
        priority: w.maxLevel >= 2 ? 10 : 8,
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

    // Sort by priority descending, then limit on mobile
    result.sort((a, b) => b.priority - a.priority);

    // Mobile: top 6 items max to keep ticker readable
    if (isMobile && result.length > 6) {
      return result.slice(0, 6);
    }

    return result;
  }, [scores, readings, stations, buoyReadings, sectorId, forecastHourly, stormPrediction, mgWarnings, tidePoints, isMobile]);

  if (items.length === 0) return null;

  // Dynamic animation speed: ~8s per item (more items = slower scroll)
  const duration = Math.max(20, items.length * 8);

  // Duplicate items for seamless loop
  const tickerContent = [...items, ...items];

  return (
    <div
      role="marquee"
      aria-label="Condiciones meteorológicas en tiempo real"
      className="h-7 bg-slate-900/80 border-b border-slate-700/50 overflow-hidden relative flex-shrink-0 flex"
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
  );
});
