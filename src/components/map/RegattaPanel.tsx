import { memo, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useRegattaStore, type SemaphoreLevel, type ZoneConditions } from '../../store/regattaStore';
import { useWeatherStore } from '../../store/weatherStore';
import { useBuoyStore } from '../../store/buoyStore';
import { useAlertStore } from '../../store/alertStore';
import { useLightningStore } from '../../hooks/useLightningData';
import { useAviationStore } from '../../store/aviationStore';
import { isPointInBounds, haversineDistance } from '../../services/geoUtils';
import { msToKnots, degreesToCardinal } from '../../services/windUtils';
import { getSourceQuality, isWindBlacklisted } from '../../services/spotScoringEngine';
import { STALE_THRESHOLD_MIN } from '../../config/constants';
import { fetchMarineData } from '../../api/marineClient';
import { fetchOpenMeteoForecast } from '../../api/openMeteoClient';
import { APP_VERSION } from '../../config/version';
import { fetchTides48h, type TidePoint } from '../../api/tideClient';
import { fetchAemetAvisos, filterAvisosByProvince, AVISO_COLORS, type AemetAviso } from '../../api/aemetAvisosClient';
import type { NormalizedStation, NormalizedReading } from '../../types/weather';
import type { ForecastPoint } from '../../api/openMeteoClient';

const SEM: Record<SemaphoreLevel, { bg: string; border: string; text: string; label: string }> = {
  green: { bg: 'bg-green-500/20', border: 'border-green-500/50', text: 'text-green-400', label: 'SEGURO' },
  yellow: { bg: 'bg-amber-500/20', border: 'border-amber-400/50', text: 'text-amber-400', label: 'PRECAUCION' },
  red: { bg: 'bg-red-500/20', border: 'border-red-500/50', text: 'text-red-400', label: 'PELIGRO' },
};

/** Find N closest stations to zone center, sorted by distance */
function findNearestStations(
  stations: NormalizedStation[],
  readings: Map<string, NormalizedReading>,
  centerLat: number,
  centerLon: number,
  maxCount: number,
  maxDistKm: number,
): { station: NormalizedStation; reading: NormalizedReading; distKm: number }[] {
  const results: { station: NormalizedStation; reading: NormalizedReading; distKm: number }[] = [];
  const maxAgeMs = STALE_THRESHOLD_MIN * 60_000; // Same 30min hard cutoff as spot scoring
  const now = Date.now();
  for (const st of stations) {
    const r = readings.get(st.id);
    if (!r || r.windSpeed == null) continue;
    // Hard exclude stale readings — matches spotScoringEngine behavior
    if (now - r.timestamp.getTime() > maxAgeMs) continue;
    const d = haversineDistance(centerLat, centerLon, st.lat, st.lon);
    if (d <= maxDistKm) results.push({ station: st, reading: r, distKm: d });
  }
  results.sort((a, b) => a.distKm - b.distKm);
  return results.slice(0, maxCount);
}

export const RegattaPanel = memo(function RegattaPanel() {
  const { active, minimized, eventName, zone, timerRunning, timerStartMs, elapsedMs, conditions, buoyMarkers } = useRegattaStore();
  const stations = useWeatherStore((s) => s.stations);
  const readings = useWeatherStore((s) => s.currentReadings);
  const buoys = useBuoyStore((s) => s.buoys);
  const alerts = useAlertStore((s) => s.alerts);
  const stormAlert = useLightningStore((s) => s.stormAlert);
  const safetyLog = useRegattaStore((s) => s.safetyLog);
  const conditionsHistory = useRegattaStore((s) => s.conditionsHistory);
  const [displayMs, setDisplayMs] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [forecast, setForecast] = useState<ForecastPoint[]>([]);
  const [tides, setTides] = useState<TidePoint[]>([]);
  const [aemetAvisos, setAemetAvisos] = useState<AemetAviso[]>([]);
  const [panelPos, setPanelPos] = useState({ x: 56, y: 80 }); // left:56px (left-14), top:80px
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  // Timer tick
  useEffect(() => {
    if (!timerRunning) { setDisplayMs(elapsedMs); return; }
    const iv = setInterval(() => setDisplayMs(elapsedMs + (Date.now() - timerStartMs)), 100);
    return () => clearInterval(iv);
  }, [timerRunning, timerStartMs, elapsedMs]);

  // Compute zone conditions — uses in-zone + nearest stations
  const computeConditions = useCallback(async () => {
    if (!zone) return;
    const { ne, sw } = zone;
    const centerLat = (ne[1] + sw[1]) / 2;
    const centerLon = (ne[0] + sw[0]) / 2;
    const store = useRegattaStore.getState();

    // First try stations IN zone (exclude stale readings >30min)
    const staleMs = STALE_THRESHOLD_MIN * 60_000;
    const now = Date.now();
    let inZone: { station: NormalizedStation; reading: NormalizedReading; distKm: number }[] = [];
    for (const st of stations) {
      if (!isPointInBounds(st.lat, st.lon, ne, sw)) continue;
      const r = readings.get(st.id);
      if (!r || r.windSpeed == null) continue;
      if (now - r.timestamp.getTime() > staleMs) continue;
      inZone.push({ station: st, reading: r, distKm: haversineDistance(centerLat, centerLon, st.lat, st.lon) });
    }

    // If none in zone, find 8 nearest within 25km (generous to match spot scoring coverage)
    const sources = inZone.length > 0 ? inZone : findNearestStations(stations, readings, centerLat, centerLon, 8, 25);

    // Unified weighting: IDW × sourceQuality × freshness (matches spotScoringEngine)
    // + wind blacklist + directional coherence filter
    let maxTemp: number | null = null, minTemp: number | null = null;
    const humids: number[] = [];

    // Pass 1: collect all valid wind readings + temp/humidity
    type WindEntry = { id: string; name: string; isBuoy: boolean; speedKt: number; gustKt: number; dir: number | null; weight: number; distKm: number };
    const windEntries: WindEntry[] = [];
    let maxGust = 0;

    for (const { station: st, reading: r, distKm } of sources) {
      if (r.humidity != null) humids.push(r.humidity);
      if (r.temperature != null) {
        if (maxTemp == null || r.temperature > maxTemp) maxTemp = r.temperature;
        if (minTemp == null || r.temperature < minTemp) minTemp = r.temperature;
      }
      if (isWindBlacklisted(st.id)) continue;

      const idwWeight = 1 / Math.max(0.5, distKm) ** 2;
      const qualityMul = getSourceQuality(st.id);
      const ageMin = (Date.now() - r.timestamp.getTime()) / 60_000;
      const freshnessMul = ageMin <= 5 ? 1.0 : ageMin <= 10 ? 0.95 : ageMin <= 20 ? 0.85 : 0.7;
      const weight = idwWeight * qualityMul * freshnessMul;
      const speedKt = msToKnots(r.windSpeed!);
      const gustKt = r.windGust != null ? msToKnots(r.windGust) : 0;
      const dir = (r.windDirection != null && r.windDirection > 0) ? r.windDirection : null;
      if (gustKt > maxGust) maxGust = gustKt;
      windEntries.push({ id: st.id, name: st.name, isBuoy: false, speedKt, gustKt, dir, weight, distKm });
    }

    // Include buoys with wind data — buoys measure wind ON WATER, most reliable
    // Buoys update hourly, so allow 60min max age (vs 30min for land stations)
    const buoyMaxAgeMs = 60 * 60_000;
    for (const b of buoys) {
      if (b.windSpeed == null || b.latitude == null || b.longitude == null) continue;
      const buoyAgeMs = b.timestamp ? (now - new Date(b.timestamp).getTime()) : 0;
      if (buoyAgeMs > buoyMaxAgeMs) continue; // Hard exclude stale buoys
      const d = haversineDistance(centerLat, centerLon, b.latitude, b.longitude);
      if (d > 30) continue; // within 30km
      const speedKt = msToKnots(b.windSpeed);
      if (speedKt < 1) continue;
      const buoyAgeMin = buoyAgeMs / 60_000;
      const freshnessMul = buoyAgeMin <= 10 ? 1.0 : buoyAgeMin <= 30 ? 0.95 : buoyAgeMin <= 60 ? 0.85 : 0.7;
      const weight = (1 / Math.max(0.5, d) ** 2) * 1.0 * freshnessMul;
      const bGustKt = b.windGust != null ? msToKnots(b.windGust) : 0;
      if (bGustKt > maxGust) maxGust = bGustKt;
      const dir = b.windDir != null ? b.windDir : null;
      windEntries.push({ id: `buoy_${b.stationId}`, name: b.stationName, isBuoy: true, speedKt, gustKt: bGustKt, dir, weight, distKm: d });
    }

    // Pass 2: compute consensus direction, then filter outliers >90° off
    let consensusDir: number | null = null;
    if (windEntries.length >= 2) {
      let sinSum = 0, cosSum = 0;
      for (const e of windEntries) {
        if (e.dir != null) { const r = (e.dir * Math.PI) / 180; sinSum += Math.sin(r) * e.weight; cosSum += Math.cos(r) * e.weight; }
      }
      let avg = (Math.atan2(sinSum, cosSum) * 180) / Math.PI;
      if (avg < 0) avg += 360;
      consensusDir = avg;
    }

    // Filter: discard stations >90° from consensus (incoherent — likely error or anomaly)
    const coherent = windEntries.filter((e) => {
      if (consensusDir == null || e.dir == null || e.speedKt < 2) return true; // calm/unknown = keep
      let diff = Math.abs(e.dir - consensusDir);
      if (diff > 180) diff = 360 - diff;
      return diff <= 90; // within 90° of consensus = coherent
    });

    // Pass 3: weighted average from coherent stations only
    let weightedSpeed = 0, totalWeight = 0, count = 0, sourcesAbove7kt = 0;
    const dirs: { deg: number; weight: number }[] = [];

    for (const e of coherent) {
      weightedSpeed += e.speedKt * e.weight;
      totalWeight += e.weight;
      if (e.dir != null) dirs.push({ deg: e.dir, weight: e.weight });
      if (e.speedKt >= 7) sourcesAbove7kt++;
      count++;
    }

    let avgWind = totalWeight > 0 ? weightedSpeed / totalWeight : 0;
    // Consensus bonus: when 3+ sources agree on decent wind (>7kt), +1kt
    // Compensates for land stations underreporting on-water conditions
    if (sourcesAbove7kt >= 3) avgWind += 1;
    // Weighted circular mean for wind direction (IDW + handles 350°+10° correctly)
    let windDir: number | null = null;
    if (dirs.length > 0) {
      let sinSum = 0, cosSum = 0;
      for (const { deg, weight } of dirs) {
        const rad = (deg * Math.PI) / 180;
        sinSum += Math.sin(rad) * weight;
        cosSum += Math.cos(rad) * weight;
      }
      let avg = (Math.atan2(sinSum, cosSum) * 180) / Math.PI;
      if (avg < 0) avg += 360;
      windDir = Math.round(avg);
    }
    const avgHumidity = humids.length > 0 ? Math.round(humids.reduce((a, b) => a + b, 0) / humids.length) : null;

    // Marine data: buoy first, Open-Meteo Marine ONLY for exposed coast
    // IMPORTANT: Open-Meteo Marine gives open-sea data — WRONG for sheltered
    // ría interiors (e.g. Cesantes shows 0.5m waves when real = 0-0.1m).
    // Only use Open-Meteo for SST, not wave height in sheltered waters.
    let waveHeight: number | null = null;
    let waterTemp: number | null = null;
    let swellHeight: number | null = null;
    let wavePeriod: number | null = null;
    let nearestBuoyDist = Infinity;

    // Check if zone center is in sheltered waters (inside ría, embalse)
    // Heuristic: if lon > -8.8 in Rías sector = interior ría (sheltered from Atlantic)
    const isSheltered = centerLon > -8.78 || store.selectedZoneId?.includes('embalse');

    // Try buoys first (real-time, always valid)
    for (const b of buoys) {
      if (b.latitude == null || b.longitude == null) continue;
      const d = haversineDistance(centerLat, centerLon, b.latitude, b.longitude);
      if (d < nearestBuoyDist && d < 30) {
        nearestBuoyDist = d;
        if (b.waveHeight != null) waveHeight = b.waveHeight;
        if (b.waterTemperature != null) waterTemp = b.waterTemperature;
      }
    }

    // Open-Meteo Marine fallback — SST always OK, waves ONLY for exposed coast
    if (waterTemp == null || (!isSheltered && waveHeight == null)) {
      const marine = await fetchMarineData(centerLat, centerLon);
      if (marine) {
        if (waterTemp == null) waterTemp = marine.seaSurfaceTemp;
        // Only use wave data for exposed coastal zones
        if (!isSheltered) {
          if (waveHeight == null) waveHeight = marine.waveHeight;
          swellHeight = marine.swellHeight;
          wavePeriod = marine.wavePeriod;
        }
      }
    }

    // Sheltered zones: show "Aguas protegidas" instead of wrong wave data
    if (isSheltered && waveHeight == null) {
      // Don't show wave data — it would be misleading
    }

    // Semaphore + safety alerts based on ALL data
    let semaphore: SemaphoreLevel = 'green';
    const alertMsgs: string[] = [];

    // 1. STORMS — highest priority
    const storm = useLightningStore.getState().stormAlert;
    if (storm.level === 'danger') {
      semaphore = 'red';
      alertMsgs.push(`TORMENTA A ${storm.nearestKm.toFixed(0)}km${storm.etaMinutes ? ` — ETA ${storm.etaMinutes}min` : ''}`);
    } else if (storm.level === 'warning') {
      semaphore = 'red';
      alertMsgs.push(`Tormenta detectada a ${storm.nearestKm.toFixed(0)}km${storm.trend === 'approaching' ? ' — acercandose' : ''}`);
    } else if (storm.level === 'watch') {
      if (semaphore !== 'red') semaphore = 'yellow';
      alertMsgs.push(`Rayos detectados a ${storm.nearestKm.toFixed(0)}km`);
    }

    // 2. WIND
    if (avgWind > 25 || maxGust > 35) {
      semaphore = 'red';
      alertMsgs.push(`Viento fuerte: ${avgWind.toFixed(0)}kt, racha ${maxGust.toFixed(0)}kt`);
    } else if (avgWind > 15 || maxGust > 25) {
      if (semaphore !== 'red') semaphore = 'yellow';
      alertMsgs.push(`Viento moderado: ${avgWind.toFixed(0)}kt`);
    }

    // 3. WAVES
    if (waveHeight != null && waveHeight > 2.5) {
      semaphore = 'red';
      alertMsgs.push(`Oleaje peligroso: ${waveHeight.toFixed(1)}m`);
    } else if (waveHeight != null && waveHeight > 1.5) {
      if (semaphore !== 'red') semaphore = 'yellow';
      alertMsgs.push(`Oleaje: ${waveHeight.toFixed(1)}m`);
    }

    // 4. COLD WATER
    // Only warn at <10°C (Galicia normal = 13-15°C, not dangerous)
    if (waterTemp != null && waterTemp < 10) {
      if (semaphore !== 'red') semaphore = 'yellow';
      alertMsgs.push(`Agua muy fria: ${waterTemp.toFixed(1)}°C — riesgo hipotermia`);
    }

    // 5. FOG (high humidity + low wind)
    if (avgHumidity != null && avgHumidity > 90 && avgWind < 5) {
      if (semaphore !== 'red') semaphore = 'yellow';
      alertMsgs.push(`Posible niebla: HR ${avgHumidity}% + calma`);
    }

    // 6. AVIATION — only low-altitude aircraft matter (not cruisers at 10000m)
    const avAlert = useAviationStore.getState().alert;
    const nearAlt = avAlert.nearestAircraft?.altitude ?? 99999;
    if (avAlert.level === 'critical' && nearAlt < 500) {
      semaphore = 'red';
      alertMsgs.push(`AERONAVE MUY BAJA: ${avAlert.nearestAircraft?.callsign || '?'} a ${avAlert.nearestAircraft?.distanceKm.toFixed(1)}km, ${Math.round(nearAlt)}m`);
    } else if (avAlert.level === 'moderate' && nearAlt < 1000) {
      if (semaphore !== 'red') semaphore = 'yellow';
      alertMsgs.push(`Aeronave baja altitud: ${avAlert.nearestAircraft?.callsign || '?'} a ${Math.round(nearAlt)}m`);
    }
    // Skip info level — cruisers at 10000m don't matter for events

    // 7. General alerts from alertStore
    for (const a of alerts) {
      if ((a.category === 'storm' || a.category === 'rain') && !alertMsgs.some(m => m.includes('ormenta') || m.includes('ayo'))) {
        alertMsgs.push(a.title);
      }
    }

    // Build wind sources for transparency display
    const windSources = coherent
      .map(e => ({
        name: e.name,
        type: (e.isBuoy ? 'buoy' : 'station') as 'station' | 'buoy',
        speedKt: Math.round(e.speedKt * 10) / 10,
        dir: e.dir != null ? degreesToCardinal(e.dir) : null,
        distKm: Math.round(e.distKm * 10) / 10,
        weightPct: totalWeight > 0 ? Math.round((e.weight / totalWeight) * 100) : 0,
      }))
      .sort((a, b) => b.weightPct - a.weightPct);

    store.setConditions({
      avgWindKt: Math.round(avgWind * 10) / 10,
      maxGustKt: Math.round(maxGust * 10) / 10,
      windDir,
      stationsInZone: count,
      semaphore,
      alerts: alertMsgs,
      windSources,
      // Extended data stored as extra fields
      ...(avgHumidity != null && { avgHumidity }),
      ...(maxTemp != null && { maxTemp, minTemp }),
      ...(waveHeight != null && { waveHeight }),
      ...(swellHeight != null && { swellHeight }),
      ...(wavePeriod != null && { wavePeriod }),
      ...(waterTemp != null && { waterTemp }),
      ...(inZone.length === 0 && count > 0 && { interpolated: true }),
    } as ZoneConditions);
  }, [zone, stations, readings, buoys, alerts]);

  useEffect(() => {
    if (!active || !zone) return;
    computeConditions();
    const iv = setInterval(computeConditions, 10_000);
    return () => clearInterval(iv);
  }, [active, zone, computeConditions]);

  // Load forecast for timeline — with BIAS CORRECTION from real station data
  // Problem: Open-Meteo models underestimate local wind (e.g. model=12kt, real=17kt)
  // Solution: compute bias from current real vs model, apply to future hours
  useEffect(() => {
    if (!active || !zone) return;
    let cancelled = false;
    const load = async () => {
      const cLat = (zone.ne[1] + zone.sw[1]) / 2;
      const cLon = (zone.ne[0] + zone.sw[0]) / 2;
      const fc = await fetchOpenMeteoForecast(cLat, cLon, 10);
      if (cancelled || fc.length === 0) return;

      // Compute bias using NEAREST station (not diluted average of 5)
      // The nearest station is most representative of local conditions
      const now = new Date();
      const currentStations = useWeatherStore.getState().stations;
      const currentReadings = useWeatherStore.getState().currentReadings;

      // Find nearest station with wind data
      let bestStationWindMs: number | null = null;
      let bestDist = Infinity;
      for (const st of currentStations) {
        const r = currentReadings.get(st.id);
        if (!r || r.windSpeed == null) continue;
        const d = haversineDistance(cLat, cLon, st.lat, st.lon);
        if (d < bestDist && d < 20) { // within 20km
          bestDist = d;
          bestStationWindMs = r.windSpeed; // already in m/s
        }
      }

      // Find model's estimate for current hour
      const currentModelPt = fc.find((p) => Math.abs(p.timestamp.getTime() - now.getTime()) < 90 * 60_000);
      const modelWindMs = currentModelPt?.windSpeed ?? null;

      // Bias = nearest real station - model (positive = model underestimates)
      let biasMs = 0;
      if (bestStationWindMs != null && modelWindMs != null && modelWindMs > 0) {
        biasMs = bestStationWindMs - modelWindMs;
        // Allow up to 100% correction (was 50% — too conservative)
        biasMs = Math.max(-modelWindMs * 0.8, Math.min(biasMs, modelWindMs * 1.0));
      }

      // Apply bias to future hours, decaying over time (bias fades in 6h)
      const upcoming = fc.filter((p) => p.timestamp > now).slice(0, 6);
      const corrected = upcoming.map((p, i) => {
        const decayFactor = Math.max(0, 1 - i * 0.15); // 100% → 10% over 6 hours
        const correctedWind = Math.max(0, (p.windSpeed ?? 0) + biasMs * decayFactor);
        return { ...p, windSpeed: correctedWind };
      });

      if (!cancelled) setForecast(corrected);
    };
    load();
    const iv = setInterval(load, 10 * 60_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [active, zone]);

  // Fetch tides (Rías sector only)
  useEffect(() => {
    if (!active || !zone) return;
    let cancelled = false;
    fetchTides48h().then((data) => {
      if (cancelled) return;
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      // Get today's upcoming tides + first of tomorrow
      const upcoming = [...data.today.filter((t) => t.time >= hhmm), ...data.tomorrow.slice(0, 2)];
      setTides(upcoming.slice(0, 4));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [active, zone]);

  // Fetch AEMET official warnings
  useEffect(() => {
    if (!active || !zone) return;
    let cancelled = false;
    const load = async () => {
      const all = await fetchAemetAvisos();
      if (cancelled) return;
      // Filter by sector province (Pontevedra=36 for Rias, Ourense=32 for Embalse)
      const centerLon = (zone.ne[0] + zone.sw[0]) / 2;
      const province = centerLon < -8.4 ? '36' : '32'; // rough heuristic
      setAemetAvisos(filterAvisosByProvince(all, province as '36' | '32'));
    };
    load();
    const iv = setInterval(load, 15 * 60_000); // refresh every 15min
    return () => { cancelled = true; clearInterval(iv); };
  }, [active, zone]);

  // Export safety log as text
  const exportLog = useCallback(() => {
    const store = useRegattaStore.getState();
    const z = store.zone;
    const c = store.conditions as any;
    const labels: Record<string, string> = { green: 'SEGURO', yellow: 'PRECAUCION', red: 'PELIGRO' };
    const elapsed = Math.floor((store.elapsedMs + (store.timerRunning ? Date.now() - store.timerStartMs : 0)) / 60000);
    const lines = [
      `══════════════════════════════════════════════════`,
      `  MeteoMapGal — INFORME DE SEGURIDAD DE EVENTO`,
      `══════════════════════════════════════════════════`,
      ``,
      `Evento:      ${store.eventName || 'Sin nombre'}`,
      `Fecha:       ${new Date().toLocaleString('es-ES')}`,
      `Zona:        ${store.selectedZoneId || 'Zona personalizada'}`,
      `Duracion:    ${elapsed} minutos`,
      `Nivel:       ${labels[c?.semaphore] || '?'}`,
      ``,
      `--- COORDENADAS ZONA ---`,
      z ? `NE: ${z.ne[1].toFixed(5)}°N, ${z.ne[0].toFixed(5)}°W` : '',
      z ? `SW: ${z.sw[1].toFixed(5)}°N, ${z.sw[0].toFixed(5)}°W` : '',
      z ? `Centro: ${((z.ne[1]+z.sw[1])/2).toFixed(5)}°N, ${((z.ne[0]+z.sw[0])/2).toFixed(5)}°W` : '',
      ``,
      `--- CONDICIONES METEOROLOGICAS ---`,
      `Viento medio:  ${c?.avgWindKt?.toFixed(1) || '?'} kt`,
      `Racha maxima:  ${c?.maxGustKt?.toFixed(1) || '?'} kt`,
      `Direccion:     ${c?.windDir ? `${degreesToCardinal(c.windDir)} (${c.windDir}°)` : 'Variable'}`,
      `Estaciones:    ${c?.stationsInZone || 0}${c?.interpolated ? ' (interpoladas)' : ''}`,
      ``,
      `--- DATOS MARINOS ---`,
      `Oleaje:        ${c?.waveHeight != null ? c.waveHeight.toFixed(1) + ' m' : 'Aguas protegidas'}`,
      c?.swellHeight != null ? `Mar de fondo:  ${c.swellHeight.toFixed(1)} m` : '',
      c?.wavePeriod != null ? `Periodo ola:   ${c.wavePeriod.toFixed(1)} s` : '',
      `Temp. agua:    ${c?.waterTemp != null ? c.waterTemp.toFixed(1) + ' °C' : 'Sin datos'}`,
      ``,
      `--- MAREAS ---`,
      ...tides.map((t) => `${t.type === 'high' ? 'Pleamar' : 'Bajamar'}: ${t.time} (${t.height.toFixed(1)}m)`),
      tides.length === 0 ? 'Sin datos de mareas' : '',
      ``,
      `--- DATOS ATMOSFERICOS ---`,
      c?.avgHumidity != null ? `Humedad:       ${c.avgHumidity}%` : '',
      c?.maxTemp != null ? `Temp. aire:    ${c.minTemp?.toFixed(1)}–${c.maxTemp?.toFixed(1)} °C` : '',
      ``,
      `--- AVISOS AEMET OFICIALES ---`,
      ...aemetAvisos.map((a) => `[${a.level.toUpperCase()}] ${a.areaDesc}: ${a.event}`),
      aemetAvisos.length === 0 ? 'Sin avisos AEMET activos' : '',
      ``,
      `--- AVISOS SISTEMA ---`,
      ...(c?.alerts?.length > 0 ? c.alerts : ['Sin avisos activos']),
      ``,
      `══════════════════════════════════════════════════`,
      `  REGISTRO DE SEGURIDAD (${store.safetyLog.length} eventos)`,
      `══════════════════════════════════════════════════`,
      ...store.safetyLog.map((e) => `${new Date(e.timestamp).toLocaleTimeString('es-ES')} [${e.type.toUpperCase()}] ${e.message}`),
      store.safetyLog.length === 0 ? 'Sin incidencias registradas' : '',
      ``,
      `--- Generado por MeteoMapGal v${APP_VERSION} | meteomapgal.navia3d.com ---`,
    ].filter(Boolean);
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const nameSlug = (store.eventName || 'evento').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase().slice(0, 20);
    a.download = `informe-${nameSlug}-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // Drag handlers for movable panel
  const onDragStart = useCallback((e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: panelPos.x, origY: panelPos.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setPanelPos({
        x: Math.max(0, dragRef.current.origX + ev.clientX - dragRef.current.startX),
        y: Math.max(0, dragRef.current.origY + ev.clientY - dragRef.current.startY),
      });
    };
    const onUp = () => { dragRef.current = null; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [panelPos]);

  // Wind trend from last 10min of history (MUST be before any conditional return)
  const windTrend = useMemo(() => {
    if (conditionsHistory.length < 3) return { label: 'Estable', arrow: '', color: 'text-slate-400' };
    const recent = conditionsHistory.slice(-6);
    const older = conditionsHistory.slice(0, Math.max(3, conditionsHistory.length - 6));
    const avgRecent = recent.reduce((s, h) => s + h.avgWindKt, 0) / recent.length;
    const avgOlder = older.reduce((s, h) => s + h.avgWindKt, 0) / older.length;
    const diff = avgRecent - avgOlder;
    if (diff > 2) return { label: 'Subiendo', arrow: ' ↑', color: 'text-amber-400' };
    if (diff < -2) return { label: 'Bajando', arrow: ' ↓', color: 'text-cyan-400' };
    return { label: 'Estable', arrow: ' →', color: 'text-green-400' };
  }, [conditionsHistory]);

  if (!active || !zone) return null;

  const sem = conditions ? SEM[conditions.semaphore] : SEM.green;
  const mins = Math.floor(displayMs / 60_000);
  const secs = Math.floor((displayMs % 60_000) / 1000);
  const timer = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  const cond = conditions as any;

  // Minimized: compact bar with semaphore + timer + expand button
  if (minimized) {
    return (
      <div className="absolute top-20 left-14 z-40 rounded-xl bg-slate-900/95 border border-amber-500/40 backdrop-blur-md shadow-2xl overflow-hidden">
        <button
          onClick={() => useRegattaStore.getState().toggleMinimize()}
          className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer ${sem.bg} ${sem.border} border rounded-xl`}
        >
          <div className={`w-3 h-3 rounded-full ${conditions?.semaphore === 'red' ? 'bg-red-500 animate-pulse' : conditions?.semaphore === 'yellow' ? 'bg-amber-500' : 'bg-green-500'}`} />
          <span className="font-mono text-xl font-bold text-white">{timer}</span>
          <span className={`text-xs font-bold ${sem.text}`}>{sem.label}</span>
          {conditions && conditions.alerts.length > 0 && (
            <span className="text-[9px] text-red-400 font-bold">{conditions.alerts.length} avisos</span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div role="region" aria-label="Panel de seguridad del evento" className="fixed z-40 w-72 rounded-xl bg-slate-900/95 border border-amber-500/40 backdrop-blur-md shadow-2xl overflow-hidden" style={{ left: panelPos.x, top: panelPos.y }}>
      {/* Header — draggable */}
      <div
        onMouseDown={onDragStart}
        className="px-3 py-2 bg-amber-500/15 border-b border-amber-500/30 flex items-center justify-between cursor-grab active:cursor-grabbing select-none"
      >
        <div className="flex items-center gap-2">
          <span className="text-amber-400 text-sm font-bold uppercase tracking-wider">Modo Evento</span>
          <span className="text-[8px] text-amber-400/60 font-bold uppercase bg-amber-500/20 px-1.5 py-0.5 rounded">alpha</span>
        </div>
        <button onClick={() => useRegattaStore.getState().toggleMinimize()}
          className="text-slate-500 hover:text-slate-300 text-sm leading-none cursor-pointer" title="Minimizar">_</button>
      </div>

      {/* Event name */}
      <div className="px-3 py-1 border-b border-slate-700/30">
        <input
          type="text"
          value={eventName}
          onChange={(e) => useRegattaStore.getState().setEventName(e.target.value)}
          placeholder="Nombre del evento..."
          className="w-full bg-transparent text-[11px] text-white placeholder-slate-600 outline-none border-none"
        />
      </div>

      {/* Timer */}
      <div className="px-3 py-2 border-b border-slate-700/40 text-center">
        <div className="font-mono text-3xl font-bold text-white tracking-widest">{timer}</div>
        <div className="flex justify-center gap-2 mt-1.5">
          <button onClick={() => useRegattaStore.getState().toggleTimer()}
            className={`px-3 py-1 rounded text-xs font-bold cursor-pointer transition-all ${timerRunning ? 'bg-red-500/25 border border-red-400/50 text-red-300' : 'bg-green-500/25 border border-green-400/50 text-green-300'}`}>
            {timerRunning ? 'Parar' : 'Iniciar'}
          </button>
          <button onClick={() => useRegattaStore.getState().resetTimer()}
            className="px-3 py-1 rounded text-xs font-bold bg-slate-700/50 border border-slate-600/50 text-slate-400 cursor-pointer hover:text-white transition-all">Reset</button>
        </div>
      </div>

      {/* Semaphore */}
      <div className={`mx-3 mt-2 px-3 py-2 rounded-lg ${sem.bg} border ${sem.border}`}>
        <div className={`text-center text-sm font-black ${sem.text}`}>{sem.label}</div>
      </div>

      {/* Main conditions */}
      {conditions && (
        <div className="px-3 py-2 space-y-1">
          {cond.interpolated && (
            <div className="text-[9px] text-teal-400/70 mb-1">Datos interpolados de {conditions.stationsInZone} fuentes cercanas</div>
          )}
          {!cond.interpolated && conditions.stationsInZone > 0 && (
            <div className="text-[9px] text-green-400/70 mb-1">{conditions.stationsInZone} fuentes en zona</div>
          )}

          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Viento medio</span>
            <span className={`font-bold ${conditions.avgWindKt >= 40 ? 'text-violet-600' : conditions.avgWindKt >= 30 ? 'text-purple-400' : conditions.avgWindKt >= 25 ? 'text-red-400' : conditions.avgWindKt >= 18 ? 'text-cyan-400' : conditions.avgWindKt >= 12 ? 'text-emerald-400' : conditions.avgWindKt >= 8 ? 'text-amber-300' : conditions.avgWindKt >= 6 ? 'text-sky-400' : 'text-slate-400'}`}>
              {conditions.avgWindKt.toFixed(1)} kt
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Racha max</span>
            <span className={`font-bold ${conditions.maxGustKt >= 40 ? 'text-violet-600' : conditions.maxGustKt >= 30 ? 'text-purple-400' : conditions.maxGustKt >= 25 ? 'text-red-400' : conditions.maxGustKt >= 18 ? 'text-cyan-400' : conditions.maxGustKt >= 12 ? 'text-emerald-400' : conditions.maxGustKt >= 8 ? 'text-amber-300' : 'text-white'}`}>
              {conditions.maxGustKt.toFixed(1)} kt
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Direccion</span>
            <span className="text-white font-bold">
              {conditions.windDir ? `${degreesToCardinal(conditions.windDir)} (${conditions.windDir}°)` : 'Variable'}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Tendencia</span>
            <span className={`font-bold ${windTrend.color}`}>{windTrend.label}{windTrend.arrow}</span>
          </div>

          {/* Wind sources (collapsible transparency) */}
          {cond.windSources && cond.windSources.length > 0 && (
            <details className="mt-1">
              <summary className="text-[9px] text-blue-400/70 cursor-pointer hover:text-blue-300">
                Fuentes ({cond.windSources.length})
              </summary>
              <div className="mt-0.5 space-y-0.5">
                {cond.windSources.slice(0, 8).map((s, i) => (
                  <div key={i} className="flex items-center gap-0.5 text-[8px] text-slate-400">
                    <span className={`w-[10px] shrink-0 ${s.type === 'buoy' ? 'text-cyan-400' : 'text-slate-600'}`}>
                      {s.type === 'buoy' ? 'B' : 'E'}
                    </span>
                    <span className="truncate flex-1" title={s.name}>{s.name}</span>
                    <span className="font-semibold text-slate-300 w-[28px] text-right">{s.speedKt}kt</span>
                    <span className="w-[14px] text-center">{s.dir ?? '-'}</span>
                    <span className="text-slate-600 w-[20px] text-right">{s.distKm}km</span>
                    <span className="text-slate-600 w-[18px] text-right">{s.weightPct}%</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Marine data */}
          {cond.waveHeight != null ? (
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Oleaje</span>
              <span className={`font-bold ${cond.waveHeight > 2 ? 'text-amber-400' : 'text-cyan-400'}`}>{cond.waveHeight.toFixed(1)} m</span>
            </div>
          ) : (
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Oleaje</span>
              <span className="text-green-400/70 font-medium text-[10px]">Aguas protegidas</span>
            </div>
          )}
          {cond.waterTemp != null && (
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Temp. agua</span>
              <span className={`font-bold ${cond.waterTemp < 10 ? 'text-blue-400' : cond.waterTemp < 15 ? 'text-cyan-400' : 'text-green-400'}`}>
                {cond.waterTemp.toFixed(1)} °C
              </span>
            </div>
          )}

          {/* Expandable details */}
          {expanded && (
            <>
              {cond.swellHeight != null && (
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Mar de fondo</span>
                  <span className="text-cyan-400 font-bold">{cond.swellHeight.toFixed(1)} m</span>
                </div>
              )}
              {cond.wavePeriod != null && (
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Periodo ola</span>
                  <span className="text-white font-bold">{cond.wavePeriod.toFixed(1)} s</span>
                </div>
              )}
              {cond.avgHumidity != null && (
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Humedad</span>
                  <span className="text-white font-bold">{cond.avgHumidity}%</span>
                </div>
              )}
              {cond.maxTemp != null && (
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Temp. aire</span>
                  <span className="text-white font-bold">{cond.minTemp?.toFixed(1)}–{cond.maxTemp?.toFixed(1)} °C</span>
                </div>
              )}
            </>
          )}

          <button onClick={() => setExpanded(!expanded)}
            className="text-[9px] text-slate-500 hover:text-slate-300 cursor-pointer mt-1">
            {expanded ? 'Menos detalle' : 'Mas detalle'}
          </button>

          {/* AEMET official warnings */}
          {aemetAvisos.length > 0 && (
            <div className="mt-2 p-2 rounded-lg bg-orange-500/10 border border-orange-500/30 space-y-1">
              <div className="text-[8px] font-black uppercase tracking-wider text-orange-400">AEMET Avisos Oficiales</div>
              {aemetAvisos.map((a, i) => {
                const c = AVISO_COLORS[a.level];
                return (
                  <div key={i} className={`flex items-center gap-1.5 text-[10px] ${c.text}`}>
                    <span className={`px-1 py-0.5 rounded text-[7px] font-black uppercase ${c.bg}`}>{c.label}</span>
                    <span className="font-semibold truncate">{a.areaDesc}: {a.event.replace(/Aviso de /, '').replace(/ de nivel \w+/, '')}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Safety alerts — prominent */}
          {conditions.alerts.length > 0 && (
            <div className={`mt-2 p-2 rounded-lg space-y-1 ${
              conditions.semaphore === 'red' ? 'bg-red-500/15 border border-red-500/30' :
              'bg-amber-500/10 border border-amber-500/20'
            }`}>
              <div className={`text-[9px] font-black uppercase tracking-wider ${
                conditions.semaphore === 'red' ? 'text-red-400' : 'text-amber-400'
              }`}>Avisos seguridad</div>
              {conditions.alerts.map((a, i) => (
                <div key={i} className={`text-[11px] font-semibold ${
                  a.includes('TORMENTA') || a.includes('peligroso') ? 'text-red-400' :
                  a.includes('hipotermia') || a.includes('niebla') ? 'text-amber-400' :
                  'text-amber-300'
                }`}>{a}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tides */}
      {tides.length > 0 && (
        <div className="px-3 py-1 border-t border-slate-700/40">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[8px] text-slate-500 font-bold uppercase">Mareas</span>
            {tides.map((t, i) => (
              <span key={i} className="text-[10px]">
                <span className={t.type === 'high' ? 'text-cyan-400' : 'text-blue-400'}>
                  {t.type === 'high' ? '▲' : '▼'}
                </span>
                <span className="text-white font-bold"> {t.time}</span>
                <span className="text-slate-500"> ({t.height.toFixed(1)}m)</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Activity timeline — next 6h with bias correction */}
      {forecast.length > 0 && (
        <div className="px-2 py-1.5 border-t border-slate-700/40">
          <div className="flex items-center gap-1 mb-1">
            <span className="text-[8px] text-slate-500 font-bold uppercase">Prevision {forecast.length}h</span>
            <span className="text-[7px] text-teal-400/60 font-medium">(corregida con datos reales)</span>
          </div>
          <div className="flex">
            {forecast.map((p, i) => {
              const wKt = Math.round(msToKnots(p.windSpeed ?? 0));
              const prevKt = i > 0 ? Math.round(msToKnots(forecast[i - 1].windSpeed ?? 0)) : (conditions?.avgWindKt ?? wKt);
              const trend = wKt > prevKt + 2 ? '+' : wKt < prevKt - 2 ? '-' : '';
              const isRed = wKt > 25;
              const isYellow = wKt > 15;
              const bg = isRed ? 'bg-red-500/30' : isYellow ? 'bg-amber-500/25' : 'bg-green-500/20';
              const tc = isRed ? 'text-red-400' : isYellow ? 'text-amber-400' : 'text-green-400';
              return (
                <div key={i} className={`flex-1 flex flex-col items-center py-1 ${bg} ${i > 0 ? 'border-l border-slate-700/20' : ''}`}>
                  <span className="text-[9px] text-white font-bold">{p.timestamp.getHours()}h</span>
                  <span className={`text-[10px] font-black ${tc}`}>{wKt}{trend}kt</span>
                  <span className="text-[7px] text-slate-500">{Math.round(p.temperature ?? 0)}°</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Safety log */}
      {showLog && safetyLog.length > 0 && (
        <div className="px-2 py-1.5 border-t border-slate-700/40 max-h-32 overflow-y-auto">
          <div className="text-[8px] text-slate-500 font-bold uppercase mb-1">Registro seguridad ({safetyLog.length})</div>
          {safetyLog.map((e, i) => (
            <div key={i} className="text-[9px] text-slate-400 py-0.5 border-b border-slate-800/50">
              <span className="text-slate-600">{new Date(e.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              {' '}
              <span className={e.type === 'alert' ? 'text-amber-400' : e.type === 'semaphore' ? 'text-teal-400' : 'text-slate-400'}>{e.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="px-3 py-2 border-t border-slate-700/40 space-y-1.5">
        <div className="flex gap-2">
          <button onClick={() => {
            if (!zone) return;
            const cLon = (zone.ne[0] + zone.sw[0]) / 2;
            const cLat = (zone.ne[1] + zone.sw[1]) / 2;
            useRegattaStore.getState().addBuoy(cLon, cLat);
          }}
            className="flex-1 px-2 py-1.5 rounded text-[10px] font-bold bg-teal-500/20 border border-teal-400/40 text-teal-300 cursor-pointer hover:bg-teal-500/30 transition-all">
            + Baliza ({buoyMarkers.length})
          </button>
          <button onClick={() => useRegattaStore.getState().toggleMinimize()}
            className="flex-1 px-2 py-1.5 rounded text-[10px] font-bold bg-slate-700/50 border border-slate-600/40 text-slate-300 cursor-pointer hover:bg-slate-600/50 transition-all">
            Minimizar
          </button>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowLog(!showLog)}
            className="flex-1 px-2 py-1 rounded text-[9px] font-bold bg-slate-700/30 border border-slate-600/30 text-slate-400 cursor-pointer hover:text-white transition-all">
            {showLog ? 'Ocultar log' : `Log (${safetyLog.length})`}
          </button>
          <button onClick={exportLog}
            className="flex-1 px-2 py-1 rounded text-[9px] font-bold bg-slate-700/30 border border-slate-600/30 text-slate-400 cursor-pointer hover:text-white transition-all">
            Exportar informe
          </button>
        </div>
        <button onClick={() => useRegattaStore.getState().deactivate()}
          className="w-full text-[9px] text-slate-600 hover:text-red-400 cursor-pointer transition-colors text-center py-0.5">
          Cerrar evento
        </button>
      </div>
    </div>
  );
});
