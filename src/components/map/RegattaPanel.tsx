import { memo, useEffect, useState, useCallback } from 'react';
import { useRegattaStore, type SemaphoreLevel, type ZoneConditions } from '../../store/regattaStore';
import { useWeatherStore } from '../../store/weatherStore';
import { useBuoyStore } from '../../store/buoyStore';
import { useAlertStore } from '../../store/alertStore';
import { useLightningStore } from '../../hooks/useLightningData';
import { useAviationStore } from '../../store/aviationStore';
import { isPointInBounds, haversineDistance } from '../../services/geoUtils';
import { msToKnots, degreesToCardinal } from '../../services/windUtils';
import type { NormalizedStation, NormalizedReading } from '../../types/weather';

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
  for (const st of stations) {
    const r = readings.get(st.id);
    if (!r || r.windSpeed == null) continue;
    const d = haversineDistance(centerLat, centerLon, st.lat, st.lon);
    if (d <= maxDistKm) results.push({ station: st, reading: r, distKm: d });
  }
  results.sort((a, b) => a.distKm - b.distKm);
  return results.slice(0, maxCount);
}

export const RegattaPanel = memo(function RegattaPanel() {
  const { active, zone, timerRunning, timerStartMs, elapsedMs, conditions, buoyMarkers } = useRegattaStore();
  const stations = useWeatherStore((s) => s.stations);
  const readings = useWeatherStore((s) => s.currentReadings);
  const buoys = useBuoyStore((s) => s.buoys);
  const alerts = useAlertStore((s) => s.alerts);
  const stormAlert = useLightningStore((s) => s.stormAlert);
  const [displayMs, setDisplayMs] = useState(0);
  const [expanded, setExpanded] = useState(false);

  // Timer tick
  useEffect(() => {
    if (!timerRunning) { setDisplayMs(elapsedMs); return; }
    const iv = setInterval(() => setDisplayMs(elapsedMs + (Date.now() - timerStartMs)), 100);
    return () => clearInterval(iv);
  }, [timerRunning, timerStartMs, elapsedMs]);

  // Compute zone conditions — uses in-zone + nearest stations
  const computeConditions = useCallback(() => {
    if (!zone) return;
    const { ne, sw } = zone;
    const centerLat = (ne[1] + sw[1]) / 2;
    const centerLon = (ne[0] + sw[0]) / 2;
    const store = useRegattaStore.getState();

    // First try stations IN zone
    let inZone: { station: NormalizedStation; reading: NormalizedReading; distKm: number }[] = [];
    for (const st of stations) {
      if (!isPointInBounds(st.lat, st.lon, ne, sw)) continue;
      const r = readings.get(st.id);
      if (!r || r.windSpeed == null) continue;
      inZone.push({ station: st, reading: r, distKm: haversineDistance(centerLat, centerLon, st.lat, st.lon) });
    }

    // If none in zone, find 5 nearest within 30km
    const sources = inZone.length > 0 ? inZone : findNearestStations(stations, readings, centerLat, centerLon, 5, 30);

    let totalSpeed = 0, maxGust = 0, count = 0, maxTemp: number | null = null, minTemp: number | null = null;
    const dirs: number[] = [];
    const humids: number[] = [];

    for (const { reading: r } of sources) {
      const speedKt = msToKnots(r.windSpeed!);
      const gustKt = r.windGust != null ? msToKnots(r.windGust) : 0;
      totalSpeed += speedKt;
      if (gustKt > maxGust) maxGust = gustKt;
      if (r.windDirection != null && r.windDirection > 0) dirs.push(r.windDirection);
      if (r.humidity != null) humids.push(r.humidity);
      if (r.temperature != null) {
        if (maxTemp == null || r.temperature > maxTemp) maxTemp = r.temperature;
        if (minTemp == null || r.temperature < minTemp) minTemp = r.temperature;
      }
      count++;
    }

    const avgWind = count > 0 ? totalSpeed / count : 0;
    const windDir = dirs.length > 0 ? Math.round(dirs.reduce((a, b) => a + b, 0) / dirs.length) : null;
    const avgHumidity = humids.length > 0 ? Math.round(humids.reduce((a, b) => a + b, 0) / humids.length) : null;

    // Buoy data (nearest buoy to zone center)
    let waveHeight: number | null = null;
    let waterTemp: number | null = null;
    let nearestBuoyDist = Infinity;
    for (const b of buoys) {
      if (b.latitude == null || b.longitude == null) continue;
      const d = haversineDistance(centerLat, centerLon, b.latitude, b.longitude);
      if (d < nearestBuoyDist && d < 40) {
        nearestBuoyDist = d;
        if (b.waveHeight != null) waveHeight = b.waveHeight;
        if (b.waterTemperature != null) waterTemp = b.waterTemperature;
      }
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
    if (waterTemp != null && waterTemp < 14) {
      if (semaphore !== 'red') semaphore = 'yellow';
      alertMsgs.push(`Agua fria: ${waterTemp.toFixed(1)}°C — riesgo hipotermia`);
    }

    // 5. FOG (high humidity + low wind)
    if (avgHumidity != null && avgHumidity > 90 && avgWind < 5) {
      if (semaphore !== 'red') semaphore = 'yellow';
      alertMsgs.push(`Posible niebla: HR ${avgHumidity}% + calma`);
    }

    // 6. AVIATION — aircraft near event zone
    const avAlert = useAviationStore.getState().alert;
    if (avAlert.level === 'critical') {
      semaphore = 'red';
      alertMsgs.push(`AERONAVE MUY CERCA: ${avAlert.nearestAircraft?.callsign || 'desconocida'} a ${avAlert.nearestAircraft?.distanceKm.toFixed(1)}km, ${Math.round(avAlert.nearestAircraft?.altitude || 0)}m`);
    } else if (avAlert.level === 'moderate') {
      if (semaphore !== 'red') semaphore = 'yellow';
      alertMsgs.push(`Aeronave descendiendo: ${avAlert.nearestAircraft?.callsign || ''} a ${avAlert.nearestAircraft?.distanceKm.toFixed(1)}km`);
    } else if (avAlert.level === 'info' && avAlert.aircraftInBbox > 0) {
      alertMsgs.push(`${avAlert.aircraftInBbox} aeronave(s) en zona (~${avAlert.nearestAircraft?.distanceKm.toFixed(0)}km)`);
    }

    // 7. General alerts from alertStore
    for (const a of alerts) {
      if ((a.category === 'storm' || a.category === 'rain') && !alertMsgs.some(m => m.includes('ormenta') || m.includes('ayo'))) {
        alertMsgs.push(a.title);
      }
    }

    store.setConditions({
      avgWindKt: Math.round(avgWind * 10) / 10,
      maxGustKt: Math.round(maxGust * 10) / 10,
      windDir,
      stationsInZone: count,
      semaphore,
      alerts: alertMsgs,
      // Extended data stored as extra fields
      ...(avgHumidity != null && { avgHumidity }),
      ...(maxTemp != null && { maxTemp, minTemp }),
      ...(waveHeight != null && { waveHeight }),
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

  if (!active || !zone) return null;

  const sem = conditions ? SEM[conditions.semaphore] : SEM.green;
  const mins = Math.floor(displayMs / 60_000);
  const secs = Math.floor((displayMs % 60_000) / 1000);
  const timer = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  const cond = conditions as any; // access extended fields

  return (
    <div className="absolute top-20 right-2 z-40 w-72 rounded-xl bg-slate-900/95 border border-amber-500/40 backdrop-blur-md shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 bg-amber-500/15 border-b border-amber-500/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-amber-400 text-sm font-bold uppercase tracking-wider">Modo Evento</span>
          <span className="text-[8px] text-amber-400/60 font-bold uppercase bg-amber-500/20 px-1.5 py-0.5 rounded">alpha</span>
        </div>
        <button onClick={() => useRegattaStore.getState().deactivate()}
          className="text-slate-500 hover:text-red-400 text-lg leading-none cursor-pointer" title="Minimizar">x</button>
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
            <div className="text-[9px] text-teal-400/70 mb-1">Datos interpolados de {conditions.stationsInZone} estaciones cercanas</div>
          )}
          {!cond.interpolated && conditions.stationsInZone > 0 && (
            <div className="text-[9px] text-green-400/70 mb-1">{conditions.stationsInZone} estaciones en zona</div>
          )}

          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Viento medio</span>
            <span className={`font-bold ${conditions.avgWindKt > 20 ? 'text-red-400' : conditions.avgWindKt > 12 ? 'text-amber-400' : conditions.avgWindKt > 6 ? 'text-green-400' : 'text-slate-400'}`}>
              {conditions.avgWindKt.toFixed(1)} kt
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Racha max</span>
            <span className={`font-bold ${conditions.maxGustKt > 20 ? 'text-red-400' : conditions.maxGustKt > 10 ? 'text-amber-400' : 'text-white'}`}>
              {conditions.maxGustKt.toFixed(1)} kt
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Direccion</span>
            <span className="text-white font-bold">
              {conditions.windDir ? `${degreesToCardinal(conditions.windDir)} (${conditions.windDir}°)` : 'Variable'}
            </span>
          </div>

          {/* Marine data */}
          {cond.waveHeight != null && (
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Oleaje</span>
              <span className={`font-bold ${cond.waveHeight > 2 ? 'text-amber-400' : 'text-cyan-400'}`}>{cond.waveHeight.toFixed(1)} m</span>
            </div>
          )}
          {cond.waterTemp != null && (
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Temp. agua</span>
              <span className={`font-bold ${cond.waterTemp < 14 ? 'text-blue-400' : cond.waterTemp < 17 ? 'text-cyan-400' : 'text-green-400'}`}>
                {cond.waterTemp.toFixed(1)} °C {cond.waterTemp < 14 ? '(fria)' : ''}
              </span>
            </div>
          )}

          {/* Expandable details */}
          {expanded && (
            <>
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

      {/* Actions */}
      <div className="px-3 py-2 border-t border-slate-700/40 flex gap-2">
        <button onClick={() => {
          if (!zone) return;
          const cLon = (zone.ne[0] + zone.sw[0]) / 2;
          const cLat = (zone.ne[1] + zone.sw[1]) / 2;
          useRegattaStore.getState().addBuoy(cLon, cLat);
        }}
          className="flex-1 px-2 py-1.5 rounded text-[10px] font-bold bg-teal-500/20 border border-teal-400/40 text-teal-300 cursor-pointer hover:bg-teal-500/30 transition-all">
          + Baliza ({buoyMarkers.length})
        </button>
        <button onClick={() => useRegattaStore.getState().deactivate()}
          className="flex-1 px-2 py-1.5 rounded text-[10px] font-bold bg-red-500/15 border border-red-400/30 text-red-400 cursor-pointer hover:bg-red-500/25 transition-all">
          Finalizar
        </button>
      </div>
    </div>
  );
});
