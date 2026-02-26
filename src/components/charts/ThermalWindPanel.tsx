import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts';
import { useWeatherStore } from '../../store/weatherStore';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { msToKnots, degreesToCardinal, windSpeedColor } from '../../services/windUtils';
import { WindCompass } from '../common/WindCompass';
import type { NormalizedStation, NormalizedReading } from '../../types/station';

/** Altitude classification for thermal wind analysis */
type AltitudeZone = 'valley' | 'mid' | 'mountain';

interface StationSnapshot {
  station: NormalizedStation;
  reading: NormalizedReading | undefined;
  zone: AltitudeZone;
}

function classifyAltitude(altitude: number): AltitudeZone {
  if (altitude < 300) return 'valley';
  if (altitude < 550) return 'mid';
  return 'mountain';
}

const ZONE_LABELS: Record<AltitudeZone, string> = {
  valley: 'Valle',
  mid: 'Ladera',
  mountain: 'Montaña',
};

const ZONE_ICONS: Record<AltitudeZone, string> = {
  valley: '\u2003\u23E3', // valley shape
  mid: '\u2571',
  mountain: '\u25B2',
};

/**
 * Calculate angular difference between two directions (0-180)
 * Accounts for wraparound (e.g. 350° vs 10° = 20°)
 */
function angleDifference(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Detect thermal wind pattern from station data:
 * - Anabatic (daytime): warm valley, wind rises uphill
 * - Katabatic (nighttime): cold mountain air drains downhill
 */
function detectThermalPattern(
  valleyStations: StationSnapshot[],
  mountainStations: StationSnapshot[]
): { type: 'anabatic' | 'katabatic' | 'mixed' | 'none'; confidence: number; description: string } {
  const valleyWithData = valleyStations.filter((s) => s.reading?.temperature != null && s.reading?.windSpeed != null);
  const mountainWithData = mountainStations.filter((s) => s.reading?.temperature != null && s.reading?.windSpeed != null);

  if (valleyWithData.length === 0 || mountainWithData.length === 0) {
    return { type: 'none', confidence: 0, description: 'Datos insuficientes para análisis' };
  }

  const avgValleyTemp = valleyWithData.reduce((sum, s) => sum + s.reading!.temperature!, 0) / valleyWithData.length;
  const avgMountainTemp = mountainWithData.reduce((sum, s) => sum + s.reading!.temperature!, 0) / mountainWithData.length;
  const tempDiff = avgValleyTemp - avgMountainTemp;

  const avgValleyWind = valleyWithData.reduce((sum, s) => sum + (s.reading!.windSpeed ?? 0), 0) / valleyWithData.length;
  const avgMountainWind = mountainWithData.reduce((sum, s) => sum + (s.reading!.windSpeed ?? 0), 0) / mountainWithData.length;

  // Check for wind direction divergence (indicates thermal activity)
  const directionsValid = valleyWithData.some((s) => s.reading?.windDirection != null)
    && mountainWithData.some((s) => s.reading?.windDirection != null);

  let dirDivergence = 0;
  if (directionsValid) {
    const valleyDirs = valleyWithData.filter((s) => s.reading?.windDirection != null).map((s) => s.reading!.windDirection!);
    const mountainDirs = mountainWithData.filter((s) => s.reading?.windDirection != null).map((s) => s.reading!.windDirection!);
    const avgValleyDir = valleyDirs[0]; // simplified
    const avgMountainDir = mountainDirs[0];
    dirDivergence = angleDifference(avgValleyDir, avgMountainDir);
  }

  // Scoring
  let confidence = 0;
  let type: 'anabatic' | 'katabatic' | 'mixed' | 'none' = 'none';

  const hour = new Date().getHours();
  const isDaytime = hour >= 8 && hour <= 20;

  // Temperature gradient: >2°C suggests thermal activity
  if (Math.abs(tempDiff) > 2) confidence += 25;
  if (Math.abs(tempDiff) > 4) confidence += 15;

  // Wind direction divergence >30° suggests thermal influence
  if (dirDivergence > 30) confidence += 20;
  if (dirDivergence > 60) confidence += 15;

  // Wind speed difference
  if (Math.abs(avgValleyWind - avgMountainWind) > 1) confidence += 15;

  // Time-of-day alignment
  if (isDaytime && tempDiff > 2) {
    type = 'anabatic';
    confidence += 10;
  } else if (!isDaytime && tempDiff > 0) {
    type = 'katabatic';
    confidence += 10;
  } else if (confidence > 30) {
    type = 'mixed';
  }

  confidence = Math.min(confidence, 100);

  const descriptions: Record<string, string> = {
    anabatic: `Viento anabático probable: valle ${avgValleyTemp.toFixed(1)}°C → montaña ${avgMountainTemp.toFixed(1)}°C (Δ${tempDiff.toFixed(1)}°C). Aire asciende por calentamiento.`,
    katabatic: `Viento catabático probable: aire frío desciende de montaña (${avgMountainTemp.toFixed(1)}°C) al valle (${avgValleyTemp.toFixed(1)}°C).`,
    mixed: `Patrón térmico mixto: gradiente ${tempDiff.toFixed(1)}°C, divergencia viento ${dirDivergence.toFixed(0)}°.`,
    none: avgValleyWind < 0.5 && avgMountainWind < 0.5
      ? 'Calma generalizada. Sin patrón térmico detectable.'
      : `Sin patrón térmico claro. Gradiente: ${tempDiff.toFixed(1)}°C.`,
  };

  return { type, confidence, description: descriptions[type] };
}

export function ThermalWindPanel() {
  const stations = useWeatherStore((s) => s.stations);
  const currentReadings = useWeatherStore((s) => s.currentReadings);
  const readingHistory = useWeatherStore((s) => s.readingHistory);

  // Build snapshots with zone classification
  const snapshots = useMemo<StationSnapshot[]>(() => {
    return stations.map((station) => ({
      station,
      reading: currentReadings.get(station.id),
      zone: classifyAltitude(station.altitude),
    })).sort((a, b) => a.station.altitude - b.station.altitude);
  }, [stations, currentReadings]);

  const valleyStations = snapshots.filter((s) => s.zone === 'valley');
  const midStations = snapshots.filter((s) => s.zone === 'mid');
  const mountainStations = snapshots.filter((s) => s.zone === 'mountain');

  // Thermal pattern detection
  const thermalPattern = useMemo(() => {
    return detectThermalPattern(
      [...valleyStations, ...midStations.filter((s) => s.station.altitude < 400)],
      [...mountainStations, ...midStations.filter((s) => s.station.altitude >= 400)]
    );
  }, [valleyStations, midStations, mountainStations]);

  // Build comparative chart: temperature by altitude over time
  const altitudeChartData = useMemo(() => {
    // Pick one representative from valley and one from mountain
    const valleyId = valleyStations[0]?.station.id;
    const mountainId = mountainStations[0]?.station.id;
    if (!valleyId || !mountainId) return [];

    const valleyHistory = readingHistory.get(valleyId) || [];
    const mountainHistory = readingHistory.get(mountainId) || [];

    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const timeMap = new Map<number, Record<string, number | null>>();

    for (const reading of valleyHistory) {
      const ts = reading.timestamp.getTime();
      if (ts < cutoff) continue;
      const rounded = Math.round(ts / 300000) * 300000;
      const entry = timeMap.get(rounded) || { time: rounded };
      entry.valleyTemp = reading.temperature;
      entry.valleyWind = reading.windSpeed != null ? msToKnots(reading.windSpeed) : null;
      entry.valleyDir = reading.windDirection;
      timeMap.set(rounded, entry);
    }

    for (const reading of mountainHistory) {
      const ts = reading.timestamp.getTime();
      if (ts < cutoff) continue;
      const rounded = Math.round(ts / 300000) * 300000;
      const entry = timeMap.get(rounded) || { time: rounded };
      entry.mountainTemp = reading.temperature;
      entry.mountainWind = reading.windSpeed != null ? msToKnots(reading.windSpeed) : null;
      entry.mountainDir = reading.windDirection;
      timeMap.set(rounded, entry);
    }

    return Array.from(timeMap.values()).sort(
      (a, b) => (a.time as number) - (b.time as number)
    );
  }, [valleyStations, mountainStations, readingHistory]);

  if (stations.length === 0) {
    return (
      <div className="text-center text-slate-500 text-xs py-6 px-4">
        <div className="text-lg mb-2">🌬️</div>
        <div>Cargando estaciones...</div>
      </div>
    );
  }

  const patternColors = {
    anabatic: '#f59e0b',
    katabatic: '#3b82f6',
    mixed: '#a78bfa',
    none: '#64748b',
  };

  return (
    <div className="space-y-3">
      {/* Thermal pattern indicator */}
      <div
        className="rounded-lg p-3 border"
        style={{
          borderColor: patternColors[thermalPattern.type],
          background: `${patternColors[thermalPattern.type]}10`,
        }}
      >
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: patternColors[thermalPattern.type] }}>
            {thermalPattern.type === 'anabatic' && 'Viento Anabático'}
            {thermalPattern.type === 'katabatic' && 'Viento Catabático'}
            {thermalPattern.type === 'mixed' && 'Patrón Mixto'}
            {thermalPattern.type === 'none' && 'Sin Patrón Térmico'}
          </span>
          {thermalPattern.confidence > 0 && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ color: patternColors[thermalPattern.type], background: `${patternColors[thermalPattern.type]}20` }}>
              {thermalPattern.confidence}%
            </span>
          )}
        </div>
        <p className="text-[10px] text-slate-400 leading-relaxed">{thermalPattern.description}</p>
      </div>

      {/* Station comparison by altitude */}
      {[
        { label: 'mountain', stations: mountainStations },
        { label: 'mid', stations: midStations },
        { label: 'valley', stations: valleyStations },
      ].map(({ label, stations: zoneStations }) => {
        if (zoneStations.length === 0) return null;
        const zone = label as AltitudeZone;
        return (
          <div key={zone}>
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-[10px] text-slate-500">{ZONE_ICONS[zone]}</span>
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                {ZONE_LABELS[zone]}
              </span>
              <span className="text-[9px] text-slate-600">
                ({zoneStations.length} est.)
              </span>
            </div>

            <div className="space-y-1">
              {zoneStations.map(({ station, reading }) => (
                <StationRow key={station.id} station={station} reading={reading} />
              ))}
            </div>
          </div>
        );
      })}

      {/* Comparative chart: Valley vs Mountain temperature */}
      {altitudeChartData.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
            Gradiente Térmico (24h)
          </div>
          <div className="bg-slate-800/50 rounded-lg p-2">
            <ResponsiveContainer width="100%" height={150}>
              <LineChart data={altitudeChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="time"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(ts) => format(new Date(ts), 'HH:mm', { locale: es })}
                  stroke="#64748b"
                  fontSize={9}
                />
                <YAxis stroke="#64748b" fontSize={9} unit="°C" width={35} />
                <Tooltip
                  contentStyle={{
                    background: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: 6,
                    fontSize: 10,
                  }}
                  labelFormatter={(ts) =>
                    format(new Date(ts as number), 'dd/MM HH:mm', { locale: es })
                  }
                  formatter={(value: number, name: string) => [
                    value != null ? `${Number(value).toFixed(1)}°C` : '--',
                    name === 'valleyTemp' ? `Valle (${valleyStations[0]?.station.name})` : `Montaña (${mountainStations[0]?.station.name})`,
                  ]}
                />
                <Line
                  dataKey="valleyTemp"
                  stroke="#ef4444"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  name="valleyTemp"
                />
                <Line
                  dataKey="mountainTemp"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  name="mountainTemp"
                />
                <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
              </LineChart>
            </ResponsiveContainer>
            <div className="flex justify-center gap-4 mt-1">
              <div className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-red-500 inline-block rounded" />
                <span className="text-[9px] text-slate-500">Valle</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-blue-500 inline-block rounded" />
                <span className="text-[9px] text-slate-500">Montaña</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Wind comparison chart */}
      {altitudeChartData.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
            Viento Comparado (24h)
          </div>
          <div className="bg-slate-800/50 rounded-lg p-2">
            <ResponsiveContainer width="100%" height={130}>
              <LineChart data={altitudeChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="time"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(ts) => format(new Date(ts), 'HH:mm', { locale: es })}
                  stroke="#64748b"
                  fontSize={9}
                />
                <YAxis stroke="#64748b" fontSize={9} unit="kt" width={35} />
                <Tooltip
                  contentStyle={{
                    background: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: 6,
                    fontSize: 10,
                  }}
                  labelFormatter={(ts) =>
                    format(new Date(ts as number), 'dd/MM HH:mm', { locale: es })
                  }
                  formatter={(value: number, name: string) => [
                    value != null ? `${Number(value).toFixed(1)} kt` : '--',
                    name === 'valleyWind' ? `Valle` : `Montaña`,
                  ]}
                />
                <Line
                  dataKey="valleyWind"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  name="valleyWind"
                />
                <Line
                  dataKey="mountainWind"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  name="mountainWind"
                />
              </LineChart>
            </ResponsiveContainer>
            <div className="flex justify-center gap-4 mt-1">
              <div className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-amber-500 inline-block rounded" />
                <span className="text-[9px] text-slate-500">Valle</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-violet-500 inline-block rounded" />
                <span className="text-[9px] text-slate-500">Montaña</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Compact row showing a station's current wind + temp */
function StationRow({ station, reading }: { station: NormalizedStation; reading: NormalizedReading | undefined }) {
  const windColor = windSpeedColor(reading?.windSpeed ?? null);

  return (
    <div className="flex items-center gap-2 bg-slate-800/60 rounded px-2 py-1.5">
      {/* Wind compass mini */}
      <WindCompass
        direction={reading?.windDirection ?? null}
        speed={reading?.windSpeed ?? null}
        size={32}
      />

      {/* Station info */}
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-medium text-slate-300 truncate">{station.name}</div>
        <div className="text-[9px] text-slate-500">{station.altitude}m</div>
      </div>

      {/* Wind speed */}
      <div className="text-right">
        <div className="text-[11px] font-bold tabular-nums" style={{ color: windColor }}>
          {reading?.windSpeed != null ? `${msToKnots(reading.windSpeed).toFixed(1)}` : '--'}
          <span className="text-[8px] text-slate-500 ml-0.5">kt</span>
        </div>
        {reading?.windDirection != null && (
          <div className="text-[8px] text-slate-500">
            {degreesToCardinal(reading.windDirection)} {Math.round(reading.windDirection)}°
          </div>
        )}
      </div>

      {/* Temperature */}
      <div className="text-right w-10">
        <div className="text-[11px] font-bold text-slate-300 tabular-nums">
          {reading?.temperature != null ? `${reading.temperature.toFixed(1)}°` : '--'}
        </div>
        {reading?.humidity != null && (
          <div className="text-[8px] text-slate-500">{Math.round(reading.humidity)}%</div>
        )}
      </div>
    </div>
  );
}
