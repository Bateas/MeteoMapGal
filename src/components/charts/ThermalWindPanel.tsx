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
import type { MicroZoneId, ZoneAlert, AlertLevel, TendencyLevel, RuleScore } from '../../types/thermal';
import type { HumidityAssessment } from '../../services/humidityWindAnalyzer';
import { ALERT_COLORS } from '../../config/alertColors';

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
    tendencySignals, humidityAssessments,
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
  const forecastChartData = useMemo(() => {
    const embalseFC = zoneForecast.get('embalse') || [];
    if (embalseFC.length === 0) return [];

    return embalseFC.map((point) => {
      const hourAlerts = forecastAlerts.filter(
        (a) => a.expectedTime.getHours() === point.timestamp.getHours()
      );
      const maxScore = hourAlerts.reduce((max, a) => Math.max(max, a.score), 0);

      return {
        time: point.timestamp.getTime(),
        score: maxScore,
        temp: point.temperature,
        wind: point.windSpeed != null ? msToKnots(point.windSpeed) : null,
        cloud: point.cloudCover,
        cape: point.cape,
      };
    });
  }, [zoneForecast, forecastAlerts]);

  if (stations.length === 0) {
    return (
      <div className="text-center text-slate-500 text-xs py-6 px-4">
        <div className="text-lg mb-2">&#x1F32C;&#xFE0F;</div>
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
          className={`flex-1 text-[10px] font-semibold py-1.5 rounded transition-colors ${
            activeSection === 'alerts'
              ? 'bg-amber-600 text-white'
              : 'bg-slate-800 text-slate-400 hover:bg-slate-750'
          }`}
        >
          Alertas
        </button>
        <button
          onClick={() => setActiveSection('historical')}
          className={`flex-1 text-[10px] font-semibold py-1.5 rounded transition-colors ${
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
              <span className="text-[10px] text-slate-500">
                Rango diurno (ΔT)
              </span>
              <span className={`text-[10px] font-mono font-semibold ${
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
                    <span className="text-[10px] text-slate-500">Nubes</span>
                    <span className={`text-[10px] font-mono font-semibold ${
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
                    <span className="text-[10px] text-slate-500">Rad.</span>
                    <span className={`text-[10px] font-mono font-semibold ${
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
                    <span className="text-[10px] text-slate-500">CAPE</span>
                    <span className={`text-[10px] font-mono font-semibold ${
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
                          <span className="text-[9px] font-semibold uppercase tracking-wider"
                            style={{ color: TENDENCY_COLORS[signal.level] }}>
                            {TENDENCY_LABELS[signal.level]}
                          </span>
                          <span className="text-[9px] text-slate-500" style={{ color: zone.color }}>
                            {zone.name}
                          </span>
                        </div>
                        <div className="text-[9px] text-slate-400 truncate">{signal.summary}</div>
                        {/* Precursor breakdown */}
                        <div className="flex gap-2 mt-0.5">
                          {signal.precursors.tempRiseRate !== null && (
                            <span className="text-[8px] text-slate-500">
                              T: +{signal.precursors.tempRiseRate.toFixed(1)}&deg;C/h
                            </span>
                          )}
                          {signal.precursors.windInSector && (
                            <span className="text-[8px] text-green-500">
                              Viento en sector
                            </span>
                          )}
                          {signal.precursors.humidityDropRate !== null && signal.precursors.humidityDropRate > 0 && (
                            <span className="text-[8px] text-slate-500">
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
                          <div className="text-[8px] text-slate-500">
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

          {/* Propagation events */}
          {propagationEvents.length > 0 && (
            <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-2.5">
              <div className="text-[10px] font-semibold text-blue-400 uppercase tracking-wider mb-1.5">
                Propagaci&oacute;n detectada
              </div>
              {propagationEvents.map((event, i) => {
                const sourceZone = zones.find((z) => z.id === event.sourceZone);
                const targetZone = zones.find((z) => z.id === event.targetZone);
                return (
                  <div key={i} className="text-[10px] text-slate-400 flex items-center gap-1.5">
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

          {/* Forecast timeline */}
          {forecastChartData.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Predicci&oacute;n T&eacute;rmica (pr&oacute;x. horas)
              </div>
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
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      formatter={((value: any, name: any) => {
                        const v = Number(value) || 0;
                        if (name === 'score') return [`${v}%`, 'Prob. térmico'];
                        if (name === 'temp') return [value != null ? `${v.toFixed(1)}°C` : '--', 'Temp'];
                        if (name === 'wind') return [value != null ? `${v.toFixed(1)} kt` : '--', 'Viento'];
                        if (name === 'cloud') return [value != null ? `${Math.round(v)}%` : '--', 'Nubes'];
                        if (name === 'cape') return [value != null ? `${Math.round(v)} J/kg` : '--', 'CAPE'];
                        return [v, String(name ?? '')];
                      }) as never}
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
            className="w-full text-[10px] text-slate-500 py-1 hover:text-slate-400 transition-colors"
          >
            {showRules ? 'Ocultar reglas' : 'Configurar reglas'} ({rules.filter((r) => r.enabled).length}/{rules.length})
          </button>

          {showRules && (
            <div className="space-y-1">
              {rules.map((rule) => (
                <button
                  key={rule.id}
                  onClick={() => toggleRule(rule.id)}
                  className={`w-full flex items-center gap-2 text-left text-[10px] px-2 py-1.5 rounded transition-colors ${
                    rule.enabled
                      ? 'bg-slate-800/80 text-slate-300'
                      : 'bg-slate-900 text-slate-600'
                  }`}
                >
                  <span className={`w-3 h-3 rounded border flex items-center justify-center text-[8px] ${
                    rule.enabled
                      ? 'border-amber-500 bg-amber-500/20 text-amber-500'
                      : 'border-slate-600'
                  }`}>
                    {rule.enabled && '\u2713'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{rule.name}</div>
                    <div className="text-[8px] text-slate-600 truncate">
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
        <div className="text-[10px] text-slate-500">
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
            <div className="text-[10px] font-semibold" style={{ color: zone.color }}>
              {zone.name}
            </div>
            <div className="text-[9px] text-slate-500">
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
            <div className="text-[8px] text-slate-500 uppercase">
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
          <div className="text-[9px] text-slate-500">
            {stations.length} est.
          </div>
        </div>

        {/* Zone average conditions */}
        <div className="flex items-center gap-2">
          <WindCompass direction={zoneAvg.dir} speed={zoneAvg.wind} size={28} />
          <div className="text-right">
            <div className="text-[10px] font-bold text-slate-300">
              {zoneAvg.temp != null ? `${zoneAvg.temp.toFixed(1)}\u00b0` : '--'}
            </div>
            <div className="text-[9px]" style={{ color: windSpeedColor(zoneAvg.wind) }}>
              {zoneAvg.wind != null ? `${msToKnots(zoneAvg.wind).toFixed(1)} kt` : '--'}
            </div>
          </div>
        </div>

        {/* Score badge */}
        {maxScore > 0 && (
          <div
            className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded"
            style={{
              color: ALERT_COLORS[alert?.alertLevel || 'none'],
              background: ALERT_COLORS[alert?.alertLevel || 'none'] + '15',
            }}
          >
            {maxScore}%
          </div>
        )}

        <span className={`text-slate-600 text-[10px] transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
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
                        <span className="text-[9px] text-slate-400 truncate flex-1">{rule.name}</span>
                        <span className="text-[9px] font-mono ml-1" style={{ color }}>
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
                <span className="text-[9px] text-slate-500">HR zona</span>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-mono font-semibold ${
                    humidityAssessment.confidence >= 0.8 ? 'text-slate-300' :
                    humidityAssessment.confidence >= 0.5 ? 'text-amber-400' :
                    'text-red-400'
                  }`}>
                    {humidityAssessment.adjustedAvg?.toFixed(0) ?? '--'}%
                  </span>
                  {humidityAssessment.rawAvg !== humidityAssessment.adjustedAvg && (
                    <span className="text-[8px] text-slate-600 line-through">
                      {humidityAssessment.rawAvg.toFixed(0)}%
                    </span>
                  )}
                  <span className={`text-[8px] px-1 rounded ${
                    humidityAssessment.confidence >= 0.8 ? 'bg-green-500/15 text-green-400' :
                    humidityAssessment.confidence >= 0.5 ? 'bg-amber-500/15 text-amber-400' :
                    'bg-red-500/15 text-red-400'
                  }`}>
                    {(humidityAssessment.confidence * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
              {humidityAssessment.warning && (
                <div className="text-[8px] text-amber-400/80 mt-0.5">
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
                  <div className="text-[10px] font-medium text-slate-300 truncate">
                    {station.name}
                  </div>
                  <div className="text-[9px] text-slate-500">{station.altitude}m</div>
                </div>
                <div className="text-right">
                  <div
                    className="text-[10px] font-bold tabular-nums"
                    style={{ color: windSpeedColor(reading?.windSpeed ?? null) }}
                  >
                    {reading?.windSpeed != null
                      ? `${msToKnots(reading.windSpeed).toFixed(1)}`
                      : '--'}
                    <span className="text-[8px] text-slate-500 ml-0.5">kt</span>
                  </div>
                  {reading?.windDirection != null && (
                    <div className="text-[8px] text-slate-500">
                      {degreesToCardinal(reading.windDirection)} {Math.round(reading.windDirection)}\u00b0
                    </div>
                  )}
                </div>
                <div className="text-right w-10">
                  <div className="text-[10px] font-bold text-slate-300 tabular-nums">
                    {reading?.temperature != null ? `${reading.temperature.toFixed(1)}\u00b0` : '--'}
                  </div>
                  {reading?.humidity != null && (
                    <div className="text-[8px] text-slate-500">{Math.round(reading.humidity)}%</div>
                  )}
                </div>
              </div>
            ))}

            {stations.length === 0 && (
              <div className="text-[9px] text-slate-600 text-center py-2">
                Sin estaciones en esta zona
              </div>
            )}
          </div>
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
            className={`flex-1 text-[9px] font-semibold py-1 rounded transition-colors ${
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
      <div className="text-[10px] text-slate-500 text-center py-4">
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
            className={`flex-1 text-[8px] font-semibold py-1 rounded transition-colors ${
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
              <div className="text-[10px] font-bold text-amber-400">{p.direction}</div>
              <div className="text-[9px] text-slate-400">{p.percentage.toFixed(1)}%</div>
              <div className="text-[8px] text-slate-600">#{i + 1}</div>
            </div>
          ))}
      </div>
    </div>
  );
}
