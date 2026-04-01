import { useMemo, useState, useEffect, memo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts';
import { useShallow } from 'zustand/react/shallow';
import { useWeatherStore } from '../../store/weatherStore';
import { useThermalStore } from '../../store/thermalStore';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { msToKnots, degreesToCardinal, windSpeedColor } from '../../services/windUtils';
import { WindCompass } from '../common/WindCompass';
import { HistoricalAnalysis } from './HistoricalAnalysis';
import { BestDaysSearch } from './BestDaysSearch';
import { WindRose } from './WindRose';
import { loadAemetHistory, getParsedAemetHistory, filterByStation, buildWindRose, type ParsedDay } from '../../services/aemetHistoryParser';
import type { NormalizedStation, NormalizedReading } from '../../types/station';
import type { MicroZoneId, MicroZone, ZoneAlert, AlertLevel, TendencyLevel, RuleScore, PropagationEvent } from '../../types/thermal';
import type { HumidityAssessment } from '../../services/humidityWindAnalyzer';
import type { WindStatus } from '../../services/windStatusService';
import { ALERT_COLORS } from '../../config/alertColors';
import { WeatherIcon } from '../icons/WeatherIcons';

const ALERT_LABELS: Record<AlertLevel, string> = {
  none: 'Sin alerta',
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
};

const TENDENCY_COLORS: Record<TendencyLevel, string> = {
  none: '#64748b',
  building: '#3b82f6',
  likely: '#f59e0b',
  active: '#22c55e',
};

const TENDENCY_LABELS: Record<TendencyLevel, string> = {
  none: 'Sin tendencia',
  building: 'Formándose',
  likely: 'Probable',
  active: 'Activo',
};

type PanelSection = 'alerts' | 'historical';

export const ThermalWindPanel = memo(function ThermalWindPanel() {
  const { stations, currentReadings } = useWeatherStore(
    useShallow((s) => ({
      stations: s.stations,
      currentReadings: s.currentReadings,
    }))
  );

  const {
    zones, rules, ruleScores, zoneAlerts, propagationEvents,
    zoneForecast, forecastAlerts, stationToZone, toggleRule,
    selectZone, selectedZoneId, dailyContext, atmosphericContext,
    tendencySignals, humidityAssessments, windStatus,
  } = useThermalStore(
    useShallow((s) => ({
      zones: s.zones,
      rules: s.rules,
      ruleScores: s.ruleScores,
      zoneAlerts: s.zoneAlerts,
      propagationEvents: s.propagationEvents,
      zoneForecast: s.zoneForecast,
      forecastAlerts: s.forecastAlerts,
      stationToZone: s.stationToZone,
      toggleRule: s.toggleRule,
      selectZone: s.selectZone,
      selectedZoneId: s.selectedZoneId,
      dailyContext: s.dailyContext,
      atmosphericContext: s.atmosphericContext,
      tendencySignals: s.tendencySignals,
      humidityAssessments: s.humidityAssessments,
      windStatus: s.windStatus,
    }))
  );
  const [activeSection, setActiveSection] = useState<PanelSection>('alerts');
  const [showRules, setShowRules] = useState(false);

  // ── Zone station grouping ────────────────────────────
  const zoneStations = useMemo(() => {
    const map = new Map<MicroZoneId, { station: NormalizedStation; reading: NormalizedReading | undefined }[]>();
    for (const zone of zones) {
      map.set(zone.id, []);
    }
    for (const station of stations) {
      const zoneId = stationToZone.get(station.id);
      if (zoneId) {
        const list = map.get(zoneId) || [];
        list.push({ station, reading: currentReadings.get(station.id) });
        map.set(zoneId, list);
      }
    }
    return map;
  }, [stations, currentReadings, zones, stationToZone]);

  // ── Forecast timeline data ───────────────────────────
  // Uses same thermal probability factors as popup (ΔT + atmosphere + tendency)
  // to ensure coherent numbers across the app.
  const forecastChartData = useMemo(() => {
    const embalseFC = zoneForecast.get('embalse') || [];
    if (embalseFC.length === 0) return [];

    // Global thermal factors (same as useSpotScoring thermalProbability)
    const deltaT = dailyContext?.deltaT ?? null;
    let globalThermalProb = 0;
    if (deltaT !== null) {
      const dtScore = deltaT >= 20 ? 15 : deltaT >= 16 ? 12 : deltaT >= 12 ? 8 : deltaT >= 8 ? 4 : 0;
      // Atmosphere: CAPE + PBL + LI
      let atmosScore = 0;
      if (atmosphericContext) {
        if (atmosphericContext.cape != null) atmosScore += atmosphericContext.cape > 200 ? 5 : atmosphericContext.cape > 50 ? 3 : 1;
        if (atmosphericContext.pbl != null) atmosScore += atmosphericContext.pbl > 1500 ? 5 : atmosphericContext.pbl > 800 ? 3 : 1;
        if (atmosphericContext.liftedIndex != null) atmosScore += atmosphericContext.liftedIndex < -2 ? 5 : atmosphericContext.liftedIndex < 0 ? 3 : 1;
      }
      // Tendency: count active signals (tendencySignals is a Map)
      let tendCount = 0;
      if (tendencySignals) tendencySignals.forEach(s => { if (s.active) tendCount++; });
      const tendScore = Math.min(10, tendCount * 3);
      globalThermalProb = Math.min(100, Math.round(
        (dtScore / 15) * 40 + (atmosScore / 15) * 35 + (tendScore / 10) * 25,
      ));
    }

    return embalseFC.map((point) => {
      const hourAlerts = forecastAlerts.filter(
        (a) => a.expectedTime.getHours() === point.timestamp.getHours()
          && a.expectedTime.getDate() === point.timestamp.getDate()
      );
      const alertScore = hourAlerts.reduce((max, a) => Math.max(max, a.score), 0);

      // Per-hour modulation: scale global prob by time-of-day + conditions
      // Castrelo thermal peaks 17-20h (esp. 18:30), NOT at generic 13-17h.
      // Morning precursors (humidity drop, temp rise) visible from 12h.
      const h = point.timestamp.getHours();
      const hum = point.humidity ?? 50;
      let hourFactor = 0;
      if (h >= 17 && h <= 20) hourFactor = 1.0;       // peak thermal window
      else if (h >= 15 && h < 17) hourFactor = 0.6;    // building phase
      else if (h >= 12 && h < 15) hourFactor = 0.25;   // precursors only
      else if (h >= 10 && h < 12) hourFactor = 0.1;    // early signs
      // Humidity penalty (>80% kills thermal, >70% weakens)
      if (hum > 80) hourFactor *= 0.3;
      else if (hum > 70) hourFactor *= 0.6;
      const hourScore = Math.round(globalThermalProb * hourFactor);

      return {
        time: point.timestamp.getTime(),
        score: Math.round(Math.max(alertScore, hourScore)),
        temp: point.temperature,
        wind: point.windSpeed != null ? msToKnots(point.windSpeed) : null,
        cloud: point.cloudCover,
        cape: point.cape,
      };
    });
  }, [zoneForecast, forecastAlerts]);

  if (stations.length === 0) {
    return (
      <div className="text-center text-slate-400 text-xs py-6 px-4">
        <div className="mb-2"><WeatherIcon id="wind" size={24} className="mx-auto text-slate-500" /></div>
        <div>Cargando estaciones...</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Section toggle */}
      <div className="flex gap-1">
        <button
          onClick={() => setActiveSection('alerts')}
          className={`flex-1 text-[11px] font-semibold py-1.5 rounded transition-colors ${
            activeSection === 'alerts'
              ? 'bg-amber-600 text-white'
              : 'bg-slate-800 text-slate-400 hover:bg-slate-750'
          }`}
        >
          Alertas
        </button>
        <button
          onClick={() => setActiveSection('historical')}
          className={`flex-1 text-[11px] font-semibold py-1.5 rounded transition-colors ${
            activeSection === 'historical'
              ? 'bg-amber-600 text-white'
              : 'bg-slate-800 text-slate-400 hover:bg-slate-750'
          }`}
        >
          Hist&oacute;rico
        </button>
      </div>

      {activeSection === 'historical' ? (
        <HistoricalSection />
      ) : (
        <>
          {/* Active alerts banner */}
          <AlertsBanner zoneAlerts={zoneAlerts} zones={zones} />

          {/* ΔT indicator */}
          {dailyContext?.deltaT !== null && dailyContext?.deltaT !== undefined && (
            <div className="rounded-lg border border-slate-700 bg-slate-800/30 px-2.5 py-1.5 flex items-center justify-between">
              <span className="text-[11px] text-slate-500">
                Rango diurno (ΔT)
              </span>
              <span className={`text-[11px] font-mono font-semibold ${
                dailyContext.deltaT >= 20 ? 'text-green-400' :
                dailyContext.deltaT >= 16 ? 'text-emerald-400' :
                dailyContext.deltaT >= 12 ? 'text-slate-300' :
                dailyContext.deltaT >= 8 ? 'text-amber-400' :
                'text-red-400'
              }`}>
                {dailyContext.deltaT.toFixed(1)}°C
                {dailyContext.tempMin !== null && dailyContext.tempMax !== null && (
                  <span className="text-slate-500 font-normal ml-1">
                    ({dailyContext.tempMin.toFixed(0)}→{dailyContext.tempMax.toFixed(0)}°C)
                  </span>
                )}
              </span>
            </div>
          )}

          {/* Atmospheric context (cloud, radiation, CAPE) */}
          {atmosphericContext && (atmosphericContext.cloudCover !== null || atmosphericContext.cape !== null) && (
            <div className="rounded-lg border border-slate-700 bg-slate-800/30 px-2.5 py-1.5">
              <div className="flex items-center justify-between gap-2">
                {atmosphericContext.cloudCover !== null && (
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-slate-500">Nubes</span>
                    <span className={`text-[11px] font-mono font-semibold ${
                      atmosphericContext.cloudCover <= 20 ? 'text-green-400' :
                      atmosphericContext.cloudCover <= 50 ? 'text-emerald-400' :
                      atmosphericContext.cloudCover <= 80 ? 'text-amber-400' :
                      'text-red-400'
                    }`}>
                      {Math.round(atmosphericContext.cloudCover)}%
                    </span>
                  </div>
                )}
                {atmosphericContext.solarRadiation !== null && (
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-slate-500">Rad.</span>
                    <span className={`text-[11px] font-mono font-semibold ${
                      atmosphericContext.solarRadiation > 600 ? 'text-green-400' :
                      atmosphericContext.solarRadiation > 300 ? 'text-emerald-400' :
                      atmosphericContext.solarRadiation > 100 ? 'text-amber-400' :
                      'text-slate-400'
                    }`}>
                      {Math.round(atmosphericContext.solarRadiation)} W/m&sup2;
                    </span>
                  </div>
                )}
                {atmosphericContext.cape !== null && (
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-slate-500">CAPE</span>
                    <span className={`text-[11px] font-mono font-semibold ${
                      atmosphericContext.cape >= 1000 ? 'text-green-400' :
                      atmosphericContext.cape >= 500 ? 'text-emerald-400' :
                      atmosphericContext.cape >= 100 ? 'text-amber-400' :
                      'text-slate-400'
                    }`}>
                      {Math.round(atmosphericContext.cape)} J/kg
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tendency signals (precursor warnings) */}
          {(() => {
            const activeTendencies = [...tendencySignals.entries()]
              .filter(([, signal]) => signal.level !== 'none')
              .sort((a, b) => b[1].score - a[1].score);

            if (activeTendencies.length === 0) return null;

            return (
              <div className="space-y-1">
                {activeTendencies.map(([zoneId, signal]) => {
                  const zone = zones.find((z) => z.id === zoneId);
                  if (!zone) return null;

                  return (
                    <div
                      key={zoneId}
                      className="rounded-lg border p-2 flex items-center gap-2"
                      style={{
                        borderColor: TENDENCY_COLORS[signal.level] + '40',
                        background: TENDENCY_COLORS[signal.level] + '08',
                      }}
                    >
                      <div
                        className={`w-2 h-2 rounded-full ${signal.level === 'active' ? 'animate-pulse' : ''}`}
                        style={{ background: TENDENCY_COLORS[signal.level] }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-semibold uppercase tracking-wider"
                            style={{ color: TENDENCY_COLORS[signal.level] }}>
                            {TENDENCY_LABELS[signal.level]}
                          </span>
                          <span className="text-[11px] text-slate-500" style={{ color: zone.color }}>
                            {zone.name}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 truncate">{signal.summary}</div>
                        {/* Precursor breakdown */}
                        <div className="flex gap-2 mt-0.5">
                          {signal.precursors.tempRiseRate !== null && (
                            <span className="text-[11px] text-slate-500">
                              T: +{signal.precursors.tempRiseRate.toFixed(1)}&deg;C/h
                            </span>
                          )}
                          {signal.precursors.windInSector && (
                            <span className="text-[11px] text-green-500">
                              Viento en sector
                            </span>
                          )}
                          {signal.precursors.humidityDropRate !== null && signal.precursors.humidityDropRate > 0 && (
                            <span className="text-[11px] text-slate-500">
                              HR: -{signal.precursors.humidityDropRate.toFixed(1)}%/h
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] font-bold font-mono"
                          style={{ color: TENDENCY_COLORS[signal.level] }}>
                          {signal.score}%
                        </div>
                        {signal.estimatedOnsetMin !== null && (
                          <div className="text-[11px] text-slate-500">
                            ~{signal.estimatedOnsetMin} min
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* Wind Status — always visible */}
          <WindStatusCard windStatus={windStatus} propagationEvents={propagationEvents} zones={zones} />

          {/* Zone cards */}
          {zones.map((zone) => {
            const alert = zoneAlerts.get(zone.id);
            const stns = zoneStations.get(zone.id) || [];
            const isSelected = selectedZoneId === zone.id;

            return (
              <ZoneCard
                key={zone.id}
                zoneName={zone.name}
                zoneColor={zone.color}
                alert={alert}
                stations={stns}
                ruleScores={ruleScores.filter((s) => s.matchedZone === zone.id)}
                rules={rules}
                humidityAssessment={humidityAssessments.get(zone.id)}
                isExpanded={isSelected}
                onToggle={() => selectZone(isSelected ? null : zone.id)}
              />
            );
          })}

          {/* Forecast timeline — thermal window summary + chart */}
          {forecastChartData.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Predicci&oacute;n T&eacute;rmica (pr&oacute;x. horas)
              </div>
              <ThermalWindowSummary data={forecastChartData} />
              <div className="bg-slate-800/50 rounded-lg p-2">
                <ResponsiveContainer width="100%" height={120}>
                  <AreaChart data={forecastChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis
                      dataKey="time"
                      type="number"
                      domain={['dataMin', 'dataMax']}
                      tickFormatter={(ts) => format(new Date(ts), 'HH:mm', { locale: es })}
                      stroke="#64748b"
                      fontSize={9}
                    />
                    <YAxis
                      stroke="#64748b"
                      fontSize={9}
                      domain={[0, 100]}
                      width={28}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#1e293b',
                        border: '1px solid #334155',
                        borderRadius: 6,
                        fontSize: 10,
                      }}
                      labelFormatter={(ts) =>
                        format(new Date(ts as number), 'HH:mm', { locale: es })
                      }
                      formatter={(value: number | string, name: string) => {
                        const v = Number(value) || 0;
                        if (name === 'score') return [`${Math.round(v)}%`, 'Prob. térmico'];
                        if (name === 'temp') return [value != null ? `${v.toFixed(1)}°C` : '--', 'Temp'];
                        if (name === 'wind') return [value != null ? `${v.toFixed(1)} kt` : '--', 'Viento'];
                        if (name === 'cloud') return [value != null ? `${Math.round(v)}%` : '--', 'Nubes'];
                        if (name === 'cape') return [value != null ? `${Math.round(v)} J/kg` : '--', 'CAPE'];
                        return [v, name];
                      }}
                    />
                    <ReferenceLine y={55} stroke="#f59e0b" strokeDasharray="3 3" strokeOpacity={0.5} />
                    <ReferenceLine y={75} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.5} />
                    <Area
                      dataKey="score"
                      stroke="#f59e0b"
                      fill="#f59e0b"
                      fillOpacity={0.15}
                      strokeWidth={2}
                      type="monotone"
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Rules config toggle */}
          <button
            onClick={() => setShowRules(!showRules)}
            className="w-full text-[11px] text-slate-500 py-1 hover:text-slate-400 transition-colors"
          >
            {showRules ? 'Ocultar reglas' : 'Configurar reglas'} ({rules.filter((r) => r.enabled).length}/{rules.length})
          </button>

          {showRules && (
            <div className="space-y-1">
              {rules.map((rule) => (
                <button
                  key={rule.id}
                  onClick={() => toggleRule(rule.id)}
                  className={`w-full flex items-center gap-2 text-left text-[11px] px-2 py-1.5 rounded transition-colors ${
                    rule.enabled
                      ? 'bg-slate-800/80 text-slate-300'
                      : 'bg-slate-900 text-slate-600'
                  }`}
                >
                  <span className={`w-3 h-3 rounded border flex items-center justify-center text-[11px] ${
                    rule.enabled
                      ? 'border-amber-500 bg-amber-500/20 text-amber-500'
                      : 'border-slate-600'
                  }`}>
                    {rule.enabled && '\u2713'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{rule.name}</div>
                    <div className="text-[11px] text-slate-600 truncate">
                      {rule.source === 'historical' ? 'Hist.' : 'Manual'} &middot; {rule.description}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
});

// ── Thermal Window Summary ────────────────────────────────
// Detects contiguous hours with thermal score ≥35 and shows a plain-text summary
// e.g. "Térmico probable 13–17h (pico 85% a las 15h)"

function ThermalWindowSummary({ data }: { data: { time: number; score: number }[] }) {
  const now = Date.now();
  const futureData = data.filter((d) => d.time >= now - 3600_000); // include current hour
  if (futureData.length === 0) return null;

  // Find contiguous windows with score ≥ 35
  const windows: { start: number; end: number; peak: number; peakTime: number }[] = [];
  let current: { start: number; end: number; peak: number; peakTime: number } | null = null;

  for (const point of futureData) {
    if (point.score >= 35) {
      if (!current) {
        current = { start: point.time, end: point.time, peak: point.score, peakTime: point.time };
      } else {
        current.end = point.time;
        if (point.score > current.peak) {
          current.peak = point.score;
          current.peakTime = point.time;
        }
      }
    } else if (current) {
      // Check gap tolerance (1h)
      if (point.time - current.end <= 3600_000) continue;
      windows.push(current);
      current = null;
    }
  }
  if (current) windows.push(current);

  // Only show windows with ≥2 hours
  const validWindows = windows.filter((w) => w.end - w.start >= 3600_000);
  if (validWindows.length === 0) {
    // Check if any hour has score ≥ 20 (weak signal)
    const maxScore = futureData.reduce((max, d) => Math.max(max, d.score), 0);
    if (maxScore < 20) return null;
    return (
      <div className="rounded border border-slate-700/50 bg-slate-800/30 px-2.5 py-1.5 mb-1.5">
        <span className="text-[11px] text-slate-500">
          Sin ventana t&eacute;rmica clara. M&aacute;x. probabilidad: <span className="text-slate-400 font-mono">{Math.round(maxScore)}%</span>
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-1 mb-1.5">
      {validWindows.slice(0, 2).map((w, i) => {
        const startH = format(new Date(w.start), 'HH:mm', { locale: es });
        const endH = format(new Date(w.end), 'HH:mm', { locale: es });
        const peakH = format(new Date(w.peakTime), 'HH:mm', { locale: es });
        const color = w.peak >= 75 ? 'text-green-400 border-green-500/30 bg-green-500/5'
          : w.peak >= 55 ? 'text-amber-400 border-amber-500/30 bg-amber-500/5'
          : 'text-sky-400 border-sky-500/30 bg-sky-500/5';

        return (
          <div key={i} className={`rounded border px-2.5 py-1.5 flex items-center justify-between ${color}`}>
            <div className="text-[11px] font-semibold">
              T&eacute;rmico {w.peak >= 75 ? 'muy probable' : w.peak >= 55 ? 'probable' : 'posible'}{' '}
              <span className="font-mono">{startH}&ndash;{endH}</span>
            </div>
            <div className="text-[11px] font-mono">
              pico {Math.round(w.peak)}% ({peakH})
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────

function AlertsBanner({
  zoneAlerts,
  zones,
}: {
  zoneAlerts: Map<MicroZoneId, ZoneAlert>;
  zones: { id: MicroZoneId; name: string; color: string }[];
}) {
  const activeAlerts = zones
    .map((z) => ({ zone: z, alert: zoneAlerts.get(z.id) }))
    .filter((a) => a.alert && a.alert.alertLevel !== 'none');

  if (activeAlerts.length === 0) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800/30 p-2.5 text-center">
        <div className="text-[11px] text-slate-500">
          Sin alertas t&eacute;rmicas activas
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {activeAlerts.map(({ zone, alert }) => (
        <div
          key={zone.id}
          className="rounded-lg border p-2.5 flex items-center gap-2"
          style={{
            borderColor: ALERT_COLORS[alert!.alertLevel] + '40',
            background: ALERT_COLORS[alert!.alertLevel] + '08',
          }}
        >
          <div
            className={`w-2 h-2 rounded-full ${alert!.alertLevel === 'high' ? 'animate-pulse' : ''}`}
            style={{ background: ALERT_COLORS[alert!.alertLevel] }}
          />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-semibold" style={{ color: zone.color }}>
              {zone.name}
            </div>
            <div className="text-[11px] text-slate-500">
              {alert!.activeRules.length} regla{alert!.activeRules.length !== 1 ? 's' : ''} activa{alert!.activeRules.length !== 1 ? 's' : ''}
            </div>
          </div>
          <div className="text-right">
            <div
              className="text-[11px] font-bold font-mono"
              style={{ color: ALERT_COLORS[alert!.alertLevel] }}
            >
              {alert!.maxScore}%
            </div>
            <div className="text-[11px] text-slate-500 uppercase">
              {ALERT_LABELS[alert!.alertLevel]}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ZoneCard({
  zoneName,
  zoneColor,
  alert,
  stations,
  ruleScores,
  rules,
  humidityAssessment,
  isExpanded,
  onToggle,
}: {
  zoneName: string;
  zoneColor: string;
  alert: ZoneAlert | undefined;
  stations: { station: NormalizedStation; reading: NormalizedReading | undefined }[];
  ruleScores: RuleScore[];
  rules: { id: string; name: string; enabled: boolean }[];
  humidityAssessment?: HumidityAssessment;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const maxScore = alert?.maxScore || 0;

  // Zone averages
  const zoneAvg = useMemo(() => {
    const readings = stations.map((s) => s.reading).filter(Boolean) as NormalizedReading[];
    const temps = readings.filter((r) => r.temperature != null).map((r) => r.temperature!);
    const winds = readings.filter((r) => r.windSpeed != null).map((r) => r.windSpeed!);
    const dir = readings.find((r) => r.windDirection != null)?.windDirection ?? null;

    return {
      temp: temps.length > 0 ? temps.reduce((a, b) => a + b, 0) / temps.length : null,
      wind: winds.length > 0 ? winds.reduce((a, b) => a + b, 0) / winds.length : null,
      dir,
    };
  }, [stations]);

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 p-2 hover:bg-slate-800/50 transition-colors"
      >
        <div className="w-1.5 h-8 rounded-full" style={{ background: zoneColor }} />
        <div className="flex-1 text-left min-w-0">
          <div className="text-[11px] font-semibold text-slate-200">{zoneName}</div>
          <div className="text-[11px] text-slate-500">
            {stations.length} est.
          </div>
        </div>

        {/* Zone average conditions */}
        <div className="flex items-center gap-2">
          <WindCompass direction={zoneAvg.dir} speed={zoneAvg.wind} size={28} />
          <div className="text-right">
            <div className="text-[11px] font-bold text-slate-300">
              {zoneAvg.temp != null ? `${zoneAvg.temp.toFixed(1)}\u00b0` : '--'}
            </div>
            <div className="text-[11px]" style={{ color: windSpeedColor(zoneAvg.wind) }}>
              {zoneAvg.wind != null ? `${msToKnots(zoneAvg.wind).toFixed(1)} kt` : '--'}
            </div>
          </div>
        </div>

        {/* Score badge */}
        {maxScore > 0 && (
          <div
            className="text-[11px] font-bold font-mono px-1.5 py-0.5 rounded"
            style={{
              color: ALERT_COLORS[alert?.alertLevel || 'none'],
              background: ALERT_COLORS[alert?.alertLevel || 'none'] + '15',
            }}
          >
            {maxScore}%
          </div>
        )}

        <span className={`text-slate-600 text-[11px] transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
          &#x25BC;
        </span>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-slate-700/30 p-2 space-y-2">
          {/* Rule scores as progress bars */}
          {ruleScores.filter((s) => s.score > 0).length > 0 && (
            <div className="space-y-1.5">
              {ruleScores
                .filter((s) => s.score > 0)
                .sort((a, b) => b.score - a.score)
                .map((score) => {
                  const rule = rules.find((r) => r.id === score.ruleId);
                  if (!rule) return null;
                  const color = score.score >= 75 ? '#ef4444'
                    : score.score >= 55 ? '#f59e0b'
                    : score.score >= 30 ? '#3b82f6'
                    : '#64748b';

                  return (
                    <div key={score.ruleId}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[11px] text-slate-400 truncate flex-1">{rule.name}</span>
                        <span className="text-[11px] font-mono ml-1" style={{ color }}>
                          {score.score}%
                        </span>
                      </div>
                      <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${score.score}%`, background: color }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          )}

          {/* Humidity cross-validation */}
          {humidityAssessment && humidityAssessment.rawAvg !== null && (
            <div className="rounded bg-slate-800/60 px-2 py-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-500">HR zona</span>
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] font-mono font-semibold ${
                    humidityAssessment.confidence >= 0.8 ? 'text-slate-300' :
                    humidityAssessment.confidence >= 0.5 ? 'text-amber-400' :
                    'text-red-400'
                  }`}>
                    {humidityAssessment.adjustedAvg?.toFixed(0) ?? '--'}%
                  </span>
                  {humidityAssessment.rawAvg !== humidityAssessment.adjustedAvg && (
                    <span className="text-[11px] text-slate-600 line-through">
                      {humidityAssessment.rawAvg.toFixed(0)}%
                    </span>
                  )}
                  <span className={`text-[11px] px-1 rounded ${
                    humidityAssessment.confidence >= 0.8 ? 'bg-green-500/15 text-green-400' :
                    humidityAssessment.confidence >= 0.5 ? 'bg-amber-500/15 text-amber-400' :
                    'bg-red-500/15 text-red-400'
                  }`}>
                    {(humidityAssessment.confidence * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
              {humidityAssessment.warning && (
                <div className="text-[11px] text-amber-400/80 mt-0.5">
                  {humidityAssessment.warning}
                </div>
              )}
            </div>
          )}

          {/* Station list */}
          <div className="space-y-1">
            {stations.map(({ station, reading }) => (
              <div
                key={station.id}
                className="flex items-center gap-2 bg-slate-800/60 rounded px-2 py-1.5"
              >
                <WindCompass
                  direction={reading?.windDirection ?? null}
                  speed={reading?.windSpeed ?? null}
                  size={28}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-medium text-slate-300 truncate">
                    {station.name}
                  </div>
                  <div className="text-[11px] text-slate-500">{station.altitude}m</div>
                </div>
                <div className="text-right">
                  <div
                    className="text-[11px] font-bold tabular-nums"
                    style={{ color: windSpeedColor(reading?.windSpeed ?? null) }}
                  >
                    {reading?.windSpeed != null
                      ? `${msToKnots(reading.windSpeed).toFixed(1)}`
                      : '--'}
                    <span className="text-[11px] text-slate-500 ml-0.5">kt</span>
                  </div>
                  {reading?.windDirection != null && (
                    <div className="text-[11px] text-slate-500">
                      {degreesToCardinal(reading.windDirection)} {Math.round(reading.windDirection)}\u00b0
                    </div>
                  )}
                </div>
                <div className="text-right w-10">
                  <div className="text-[11px] font-bold text-slate-300 tabular-nums">
                    {reading?.temperature != null ? `${reading.temperature.toFixed(1)}\u00b0` : '--'}
                  </div>
                  {reading?.humidity != null && (
                    <div className="text-[11px] text-slate-500">{Math.round(reading.humidity)}%</div>
                  )}
                </div>
              </div>
            ))}

            {stations.length === 0 && (
              <div className="text-[11px] text-slate-600 text-center py-2">
                Sin estaciones en esta zona
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Wind Status Card ─────────────────────────────────────

function WindStatusCard({
  windStatus,
  propagationEvents,
  zones,
}: {
  windStatus: WindStatus | null;
  propagationEvents: PropagationEvent[];
  zones: MicroZone[];
}) {
  if (!windStatus) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800/30 p-2.5">
        <div className="flex items-center gap-1.5">
          <WeatherIcon id="wind" size={13} className="text-slate-500" />
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            Viento en estaciones
          </span>
        </div>
        <div className="text-[11px] text-slate-600 mt-1">Cargando datos...</div>
      </div>
    );
  }

  const { consensus, trend, spreadDeg, zoneSummaries, consensusDurationMin, stableHours } = windStatus;

  // Color logic for consensus
  const consensusColor = consensus
    ? consensus.stationCount >= 5 && consensus.avgSpeedKt >= 5
      ? '#10b981' // emerald
      : consensus.stationCount >= 3 && consensus.avgSpeedKt >= 3
        ? '#f59e0b' // amber
        : '#64748b' // slate
    : '#64748b';

  // Spread label
  const spreadLabel = spreadDeg !== null
    ? spreadDeg < 25 ? 'Muy consistente'
      : spreadDeg < 45 ? 'Consistente'
        : 'Variable'
    : null;

  const spreadColor = spreadDeg !== null
    ? spreadDeg < 25 ? 'text-green-400'
      : spreadDeg < 45 ? 'text-emerald-400'
        : 'text-amber-400'
    : 'text-slate-500';

  // Trend icon
  const trendIcon = trend
    ? trend.direction === 'rising' ? '↑'
      : trend.direction === 'falling' ? '↓'
        : '→'
    : null;

  const trendColor = trend
    ? trend.direction === 'rising' ? 'text-green-400'
      : trend.direction === 'falling' ? 'text-amber-400'
        : 'text-slate-400'
    : 'text-slate-500';

  const trendLabel = trend
    ? trend.direction === 'rising' ? 'Subiendo'
      : trend.direction === 'falling' ? 'Bajando'
        : 'Estable'
    : null;

  // Zones with wind data
  const zonesWithWind = zoneSummaries.filter((z) => z.stationCount > 0);
  const agreeingZones = zoneSummaries.filter((z) => z.agrees);

  return (
    <div
      className="rounded-lg border p-2.5 space-y-2"
      style={{ borderColor: `${consensusColor}30`, background: `${consensusColor}06` }}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5">
        <WeatherIcon id="wind" size={13} style={{ color: consensusColor }} />
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: consensusColor }}>
          Viento en estaciones
        </span>
      </div>

      {/* Section 1: Consensus */}
      {consensus ? (
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-slate-200">
                {consensus.dominantDir} {consensus.avgSpeedKt.toFixed(0)}kt
              </span>
              <span className="text-[11px] text-slate-500">
                · {consensus.stationCount} est.
              </span>
            </div>
            {/* Progress bar: stations in consensus */}
            <div className="flex items-center gap-1.5 mt-1">
              <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, (consensus.stationCount / 15) * 100)}%`,
                    background: consensusColor,
                  }}
                />
              </div>
              <span className="text-[11px] text-slate-500 w-8 text-right tabular-nums">
                {consensus.stationCount}/15
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-[11px] text-slate-500">Sin viento consistente</div>
      )}

      {/* Section 2: Trend */}
      {trend && (
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-slate-500 w-16 shrink-0">Tendencia</span>
          <span className={`font-semibold ${trendColor}`}>
            {trendIcon} {trendLabel}
          </span>
          <span className="text-[11px] text-slate-600 ml-auto tabular-nums">
            {trend.rateKtPerHour >= 0 ? '+' : ''}{trend.rateKtPerHour.toFixed(1)} kt/h
          </span>
        </div>
      )}

      {/* Section 3: Direction spread */}
      {spreadDeg !== null && (
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-slate-500 w-16 shrink-0">Dispersión</span>
          <span className={`font-semibold ${spreadColor}`}>
            {spreadLabel}
          </span>
          <span className="text-[11px] text-slate-600 ml-auto tabular-nums">
            {spreadDeg.toFixed(0)}°
          </span>
        </div>
      )}

      {/* Section 4: Zone coherence — dots */}
      {zonesWithWind.length > 0 && consensus && (
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-slate-500 w-16 shrink-0">Zonas</span>
          <div className="flex items-center gap-1 flex-wrap">
            {zoneSummaries.map((z) => {
              const zone = zones.find((zz) => zz.id === z.zoneId);
              if (!zone) return null;
              // Short zone name (first word)
              const shortName = zone.name.split(' ')[0];

              return (
                <span
                  key={z.zoneId}
                  className={`text-[11px] px-1 py-0.5 rounded ${
                    z.stationCount === 0
                      ? 'text-slate-600'
                      : z.agrees
                        ? 'text-green-400 bg-green-500/10'
                        : 'text-slate-400 bg-slate-700/30'
                  }`}
                  title={z.dominantDir ? `${z.dominantDir} ${z.avgSpeedKt.toFixed(0)}kt (${z.stationCount} est.)` : 'Sin datos'}
                >
                  {shortName} {z.stationCount === 0 ? '○' : z.agrees ? '✓' : z.dominantDir ?? '○'}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Section 5: Stability duration */}
      {consensusDurationMin !== null && consensusDurationMin > 0 && (
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-slate-500 w-16 shrink-0">Estabilidad</span>
          <span className={`font-semibold ${
            consensusDurationMin >= 120 ? 'text-green-400'
              : consensusDurationMin >= 60 ? 'text-emerald-400'
                : consensusDurationMin >= 20 ? 'text-slate-300'
                  : 'text-slate-400'
          }`}>
            {stableHours !== null
              ? `~${stableHours}h sostenido`
              : `~${consensusDurationMin} min`
            }
          </span>
          {consensusDurationMin < 20 && (
            <span className="text-[11px] text-slate-600 ml-auto">monitorizar</span>
          )}
        </div>
      )}

      {/* Section 6 (conditional): Propagation events */}
      {propagationEvents.length > 0 && (
        <div className="rounded border border-blue-500/30 bg-blue-500/5 p-2 mt-1">
          <div className="text-[11px] font-semibold text-blue-400 uppercase tracking-wider mb-1">
            Propagación detectada
          </div>
          {propagationEvents.map((event, i) => {
            const sourceZone = zones.find((z) => z.id === event.sourceZone);
            const targetZone = zones.find((z) => z.id === event.targetZone);
            return (
              <div key={i} className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <span style={{ color: sourceZone?.color }}>{sourceZone?.name}</span>
                <span className="text-slate-600">&rarr;</span>
                <span style={{ color: targetZone?.color }}>{targetZone?.name}</span>
                <span className="text-slate-600 ml-auto">
                  ~{event.estimatedArrivalMin} min
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Historical section: Best Days + Open-Meteo ──

function HistoricalSection() {
  const [histTab, setHistTab] = useState<'bestdays' | 'openmeteo' | 'windrose'>('bestdays');
  const [historyLoaded, setHistoryLoaded] = useState(() => getParsedAemetHistory().length > 0);

  // Trigger lazy load of AEMET history JSON on first render
  useEffect(() => {
    if (!historyLoaded) {
      loadAemetHistory().then(() => setHistoryLoaded(true));
    }
  }, [historyLoaded]);

  const parsedRecords = getParsedAemetHistory();

  // Records for best days search (Ribadavia)
  const searchRecords = useMemo(() => {
    if (!historyLoaded) return [];
    return filterByStation(parsedRecords, '1701X');
  }, [historyLoaded, parsedRecords]);

  return (
    <div className="space-y-2">
      {/* Sub-tabs */}
      <div className="flex gap-1">
        {([
          { key: 'bestdays' as const, label: 'Mejores Días' },
          { key: 'windrose' as const, label: 'Rosa Vientos' },
          { key: 'openmeteo' as const, label: 'Open-Meteo' },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setHistTab(tab.key)}
            className={`flex-1 text-[11px] font-semibold py-1 rounded transition-colors ${
              histTab === tab.key
                ? 'bg-slate-600 text-white'
                : 'bg-slate-800 text-slate-500 hover:bg-slate-750'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {histTab === 'bestdays' && (
        <BestDaysSearch records={searchRecords} />
      )}

      {histTab === 'windrose' && (
        <WindRoseSection records={parsedRecords} historyLoaded={historyLoaded} />
      )}

      {histTab === 'openmeteo' && (
        <HistoricalAnalysis />
      )}
    </div>
  );
}

// ── Wind Rose section for historical tab ──

function WindRoseSection({ records, historyLoaded }: { records: ParsedDay[]; historyLoaded: boolean }) {
  const [roseStation, setRoseStation] = useState<string>('all');

  const roseData = useMemo(() => {
    if (!historyLoaded || records.length === 0) return null;
    const filtered = roseStation === 'all' ? records : filterByStation(records, roseStation);
    return buildWindRose(filtered, { stationId: roseStation === 'all' ? undefined : roseStation });
  }, [records, historyLoaded, roseStation]);

  if (!roseData) {
    return (
      <div className="text-[11px] text-slate-500 text-center py-4">
        Cargando datos históricos AEMET...
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Station filter */}
      <div className="flex gap-1">
        {[
          { id: 'all', label: 'Todas' },
          { id: '1701X', label: 'Ribadavia' },
          { id: '1690A', label: 'Ourense' },
          { id: '1700X', label: 'Carballiño' },
        ].map((st) => (
          <button
            key={st.id}
            onClick={() => setRoseStation(st.id)}
            className={`flex-1 text-[11px] font-semibold py-1 rounded transition-colors ${
              roseStation === st.id
                ? 'bg-amber-600/30 text-amber-400 border border-amber-500/30'
                : 'bg-slate-800 text-slate-500 hover:text-slate-400'
            }`}
          >
            {st.label}
          </button>
        ))}
      </div>

      <WindRose
        data={roseData.points}
        title={`Rosa de vientos · ${roseData.totalDays} días`}
        stationName={roseStation === 'all' ? 'Todas las estaciones' : undefined}
        size={200}
        showSpeedWeight
      />

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-1">
        {roseData.points
          .sort((a, b) => b.percentage - a.percentage)
          .slice(0, 3)
          .map((p, i) => (
            <div key={p.direction} className="bg-slate-800/50 rounded p-1.5 text-center">
              <div className="text-[11px] font-bold text-amber-400">{p.direction}</div>
              <div className="text-[11px] text-slate-400">{p.percentage.toFixed(1)}%</div>
              <div className="text-[11px] text-slate-600">#{i + 1}</div>
            </div>
          ))}
      </div>
    </div>
  );
}
