/**
 * ConditionsTicker — scrolling marquee strip below header.
 *
 * Shows real-time highlights: top wind spots, gusts, temperature extremes,
 * active alerts. Auto-scrolls horizontally with CSS animation.
 * Minimal overhead: reads from existing stores (no new fetches).
 */
import { memo, useMemo, useState, useEffect } from 'react';
import { useWeather, useBuoy, useSpot } from '../../store/typedSelectors';
import { useSectorStore } from '../../store/sectorStore';
import { useForecastStore } from '../../hooks/useForecastTimeline';
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
  // Typed selectors — compile error if property name is wrong (R6, prevents v1.21.0 crash)
  const scores = useSpot.use.scores();
  const readings = useWeather.use.currentReadings();
  const stations = useWeather.use.stations();
  const buoyReadings = useBuoy.use.buoys();
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const forecastHourly = useForecastStore((s) => s.hourly);

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
    }, 60 * 60_000); // refresh every 60min
    return () => { cancelled = true; clearInterval(iv); };
  }, [sectorId]);

  const items = useMemo(() => {
    const result: { key: string; text: string; color: string }[] = [];

    // ── Spot verdicts ──
    const spots = getSpotsForSector(sectorId);
    for (const spot of spots) {
      const sc = scores.get(spot.id);
      if (!sc) continue;
      const v = VERDICT_STYLE[sc.verdict];
      const kt = sc.wind?.avgSpeedKt;
      const dir = sc.wind?.dominantDir ?? '';
      result.push({
        key: `spot-${spot.id}`,
        text: `${spot.shortName}: ${v.label}${kt != null && sc.verdict !== 'calm' ? ` ${dir} ${kt.toFixed(0)}kt` : ''}`,
        color: v.text,
      });
    }

    // ── Max gust across stations ──
    let maxGust = 0;
    let maxGustStation = '';
    for (const st of stations) {
      const r = readings.get(st.id);
      if (r?.windGust != null && r.windGust > maxGust) {
        maxGust = r.windGust;
        maxGustStation = st.name;
      }
    }
    if (maxGust > 3) { // > ~6kt
      result.push({
        key: 'max-gust',
        text: `Racha max: ${msToKnots(maxGust).toFixed(0)}kt ${maxGustStation}`,
        color: maxGust > 8 ? 'text-orange-400' : 'text-slate-300',
      });
    }

    // ── Max wave height from buoys ──
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
      });
    }

    // ── Temperature extremes ──
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
      });
    }

    // ── Tide info (Rías only) ──
    if (sectorId === 'rias' && tidePoints.length > 0) {
      const next = getNextTide(tidePoints);
      if (next) {
        const label = next.point.type === 'high' ? 'Pleamar' : 'Bajamar';
        const arrow = next.isRising ? '↑' : '↓';
        result.push({
          key: 'tide-next',
          text: `Marea ${arrow} ${label} ${next.point.time}h (${next.point.height.toFixed(1)}m)`,
          color: 'text-cyan-400',
        });
      }
    }

    // ── Day forecast summary (from Open-Meteo, sector-specific) ──
    const sectorLabel = sectorId === 'rias' ? 'Rias' : 'Embalse';
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
            text: `Prev ${sectorLabel}: viento max ${maxWindKt}kt hoy`,
            color: maxWindKt > 15 ? 'text-orange-400' : 'text-sky-400',
          });
        }
        if (maxRainProb >= 40) {
          result.push({
            key: 'fcst-rain',
            text: `Prev ${sectorLabel}: lluvia ${maxRainProb}% hoy`,
            color: maxRainProb >= 70 ? 'text-amber-400' : 'text-slate-400',
          });
        }
      }

      // Thermal forecast early warning — only for sectors with thermal spots
      const thermalSignals = detectThermalForecast(forecastHourly);
      for (const s of thermalSignals) {
        const color = s.confidence === 'alta' ? 'text-green-400' : s.confidence === 'media' ? 'text-blue-400' : 'text-slate-400';
        result.push({
          key: `thermal-fcst-${s.day}`,
          text: `${sectorLabel}: ${s.label}`,
          color,
        });
      }
    }

    // ── Fallback: station count + sector when no wind/score data yet ──
    if (result.length === 0 && stations.length > 0) {
      result.push({
        key: 'station-count',
        text: `${stations.length} estaciones activas`,
        color: 'text-slate-400',
      });
    }

    return result;
  }, [scores, readings, stations, buoyReadings, sectorId, forecastHourly, tidePoints]);

  if (items.length === 0) return null;

  // Duplicate items for seamless loop
  const tickerContent = [...items, ...items];

  return (
    <div role="marquee" aria-label="Condiciones meteorológicas en tiempo real" className="h-7 bg-slate-900/80 border-b border-slate-700/50 overflow-hidden relative flex-shrink-0">
      <div className="ticker-scroll flex items-center h-full gap-6 whitespace-nowrap px-4">
        {tickerContent.map((item, i) => (
          <span key={`${item.key}-${i}`} className={`text-[11px] font-medium ${item.color} flex items-center gap-1`}>
            <span className="w-1 h-1 rounded-full bg-current opacity-50" />
            {item.text}
          </span>
        ))}
      </div>
    </div>
  );
});
