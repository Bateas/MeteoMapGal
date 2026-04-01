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
import { useSectorStore } from '../../store/sectorStore';
import { useForecastStore } from '../../hooks/useForecastTimeline';
import { useUIStore } from '../../store/uiStore';
import { getSpotsForSector } from '../../config/spots';
import { msToKnots } from '../../services/windUtils';
import { VERDICT_STYLE } from '../../config/verdictStyles';
import { detectThermalForecast } from '../../services/thermalForecastDetector';
import type { TidePoint } from '../../api/tideClient';

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
    import('../../api/tideClient').then(({ fetchTidePredictions }) => {
      fetchTidePredictions().then(pts => { if (!cancelled) setTidePoints(pts); }).catch(() => {});
    });
    const iv = setInterval(() => {
      import('../../api/tideClient').then(({ fetchTidePredictions }) => {
        fetchTidePredictions().then(pts => { if (!cancelled) setTidePoints(pts); }).catch(() => {});
      });
    }, 60 * 60_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [sectorId]);

  const items = useMemo(() => {
    const result: { key: string; text: string; color: string; bg: string; priority: number }[] = [];
    const sectorLabel = sectorId === 'rias' ? 'Rías' : 'Embalse';

    // ── Spot verdicts (priority 10 = highest for non-calm, 1 for calm) ──
    const spots = getSpotsForSector(sectorId);
    for (const spot of spots) {
      const sc = scores.get(spot.id);
      if (!sc) continue;
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
  }, [scores, readings, stations, buoyReadings, sectorId, forecastHourly, tidePoints, isMobile]);

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
        className="flex-shrink-0 w-7 h-7 flex items-center justify-center text-slate-500 hover:text-slate-300 transition-colors border-r border-slate-700/50"
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
