/**
 * ConditionsTicker: the official warnings, fixed, and ONE line under them with the most important
 * thing that the map does not already say. It does not move: a marquee made people wait for the
 * message they needed, and everything it cycled through lived somewhere else anyway.
 *
 * What it can say: beach day (by day and with the air measured), a strong meteorological tide, UV,
 * air quality (station and distance), fires (naming the zone), storm and rain from the forecast,
 * and the thermal forecast inland. It goes silent while the safety band is on: then the band speaks.
 *
 * `simple` prop (simpleMode): the official warnings always show, the line only with what is essential
 * for a casual user. With nothing to say it renders nothing (silence by default).
 * Reads from existing stores: no fetches of its own.
 */
import { memo, useEffect, useMemo } from 'react';
import { useSpot } from '../../store/typedSelectors';
import { useSectorStore } from '../../store/sectorStore';
import { isCoastalSector } from '../../config/sectors';
import { useRainNowStore } from '../../store/rainNowStore';
import { useForecastStore } from '../../hooks/useForecastTimeline';
import { useLightningStatus } from '../../hooks/useLightningStatus';
import { formatStrikeAge } from '../../services/lightningStatus';
import { useSpotLightningRisk } from '../../hooks/useSpotLightningRisk';
import { useWarningsStore } from '../../hooks/useWarnings';
import { mgWarningsLastOkMs } from '../../api/mgWarningsClient';
import { officialWarningsKnown, OFFICIAL_UNKNOWN_DETAIL, OFFICIAL_UNKNOWN_TITLE } from '../../services/alerts/officialKnown';
import { warningTitleEs } from '../../services/dayNotices';
import { useAirQualityStore } from '../../store/airQualityStore';
import { useAlertStore } from '../../store/alertStore';
import { useIcaStore } from '../../store/icaStore';
import { icaCategory } from '../../api/meteoGaliciaIcaClient';
import { useFireStore } from '../../store/fireStore';
import { selectFireClusters } from '../../services/fireClustering';
import { aggregateFiresForSector, formatFireAge } from '../../services/fireService';
import { describeFireLocation } from '../../services/fireRegion';
import { cardTideStation, getSpotsForSector, isBeachSpot } from '../../config/spots';
import { assessBeachDay, type BeachDayResult } from '../../services/beachDayService';
import { detectThermalForecast } from '../../services/thermalForecastDetector';
import { useAloft } from '../../hooks/useAloft';
import { isDaylight } from '../../services/solarUtils';
import { isPeakUvHour, uvCategory, uvTickerLabel, UV_TICKER_THRESHOLD } from '../../services/uvService';
import { formatMeteoTide } from '../../services/meteoTideService';
import { useMeteoTide } from '../../hooks/useMeteoTide';
import { forecastLines, icaSentence, worstIcaNear } from '../../services/alerts/conditionsList';
import { spanWords } from '../../services/alerts/whenText';
import { topStripPlan } from '../../services/alerts/levelZero';
import { useUIStore } from '../../store/uiStore';
import { useLevelZeroStore } from '../../store/levelZeroStore';
import { WeatherIcon, type IconId } from '../icons/WeatherIcons';
import '../../styles/condiciones.css';

interface ConditionsTickerProps {
  /** Simple mode: the line only with essential items (official warnings always show). */
  simple?: boolean;
}

interface Candidate {
  key: string;
  text: string;
  /** Tone class of the mark: the words stay in ink */
  tone: string;
  priority: number;
  essential?: boolean;
  icon?: IconId;
}

/** Vigo port: the coastal reference gauge. */
const COAST_TIDE_STATION = '29';

/** «Precipitación 12 horas» + «Precipitación 1 hora» = «Precipitación 12 horas y 1 hora»; unrelated kinds, a comma. */
export function joinWarningTypes(a: string, b: string): string {
  const head = a.split(' ')[0];
  if (head && b.startsWith(`${head} `)) return `${a} y ${b.slice(head.length + 1)}`;
  return `${a}, ${b}`;
}

export const ConditionsTicker = memo(function ConditionsTicker({ simple = false }: ConditionsTickerProps) {
  const scores = useSpot.use.scores();
  const sector = useSectorStore((s) => s.activeSector);
  const sectorId = sector.id;
  const forecastHourly = useForecastStore((s) => s.hourly);
  const convectionData = useForecastStore((s) => s.convectionData);
  // Measured rain («Lluvia ahora» layer): the beach headline must not say «Buen día» under it.
  const rainNowSummary = useRainNowStore((s) => s.summary);
  const lightning = useLightningStatus();
  const mgWarnings = useWarningsStore((s) => s.sectorWarnings);
  // Each poll sets lastFetch, so this is read again after every answer or failure
  const warningsPolled = useWarningsStore((s) => s.lastFetch);
  const officialUnknown = !officialWarningsKnown(warningsPolled, mgWarningsLastOkMs(), Date.now());
  const unifiedAlerts = useAlertStore((s) => s.alerts);
  const airQuality = useAirQualityStore((s) => s.data);
  const icaReadings = useIcaStore((s) => s.readings);
  // Subscribed, not read through getState(): fires poll on their own 30min clock.
  const fires = useFireStore((s) => s.fires);
  const lightningRisks = useSpotLightningRisk();
  // Real measured storm surge from the REDMAR gauge
  const meteoTide = useMeteoTide(isCoastalSector(sectorId) ? COAST_TIDE_STATION : undefined);
  // The open spot card paints its own «Agua N cm…» line when its spot has a tide station and that
  // gauge reads a notable level: the same two conditions as SpotTideSummary, asked of the same hook.
  const openSpotId = useSpot((st) => st.activeSpotId);
  const cardTide = useMeteoTide(cardTideStation(openSpotId));
  const cardSaysTide = !!cardTide && cardTide.level !== 'none';
  const aloft = useAloft();

  // Rays near a spot or a storm overhead: the band says it, closer and with what to do.
  const stormOverhead = unifiedAlerts.some((a) => a.category === 'storm' && a.severity === 'critical');
  const safetyBandOn = lightningRisks.length > 0 || stormOverhead;

  const line = useMemo<Candidate | null>(() => {
    if (safetyBandOn) return null;
    const result: Candidate[] = [];
    const nowDate = new Date();
    const nowMs = nowDate.getTime();

    // ── Beach-day casual headline (coastal sector): a positive nudge only, by day, with the air
    // measured. Without the air the cold gate of assessBeachDay does not act: on 4-nov it said «Sol»
    // at 20:40 with 8.7 °C on the card, until the readings arrived.
    if (isCoastalSector(sectorId) && isDaylight(nowDate, sector.center)) {
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
      // Two gauges that the rain layer confirmed beat a dry model hour (same rule as the panel).
      if (rainNowSummary && !rainNowSummary.sim && rainNowSummary.gauges.length >= 2) rainingNow = true;
      const foggy = unifiedAlerts.some(
        (a) => a.category === 'fog' && (a.severity === 'high' || a.severity === 'critical'),
      );

      // Score every beach spot in the sector, keep the best verdict.
      const verdictRank: Record<string, number> = { great: 3, ok: 2, poor: 1, unknown: 0 };
      let bestBeach: { name: string; res: BeachDayResult } | null = null;
      for (const spot of getSpotsForSector(sectorId)) {
        if (!isBeachSpot(spot.id)) continue;
        const sc = scores.get(spot.id);
        if (!sc || sc.provisional || sc.airTemp == null) continue;
        const res = assessBeachDay({
          cloudCoverPct,
          windKt: sc.effectiveWindKt ?? sc.wind?.avgSpeedKt ?? null,
          gustKt: sc.gustKt ?? null,
          airTempC: sc.airTemp,
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
          tone: great ? 'gc-t-ok' : 'gc-t-moderado',
          priority: great ? 9 : 8,
          essential: true,
          icon: 'beach',
        });
      }
    }

    // ── Strong meteorological tide: measured at the gauge, from the service's own threshold ──
    // With a spot card open that says it (the spot's own tide beside it), the strip never repeats it,
    // the high level included: one voice per fact on a screen (11-nov). A card with no tide line
    // (a spot without a tide station) leaves the strip as the only place, so it stays.
    if (meteoTide && meteoTide.level !== 'none' && !cardSaysTide) {
      const high = meteoTide.level === 'high';
      result.push({
        key: 'tide-surge',
        text: `${formatMeteoTide(meteoTide)}${meteoTide.gaugeName ? ` en ${meteoTide.gaugeName}` : ''} (mareógrafo)`,
        tone: high ? 'gc-t-alto' : 'gc-t-riesgo',
        priority: high ? 9.5 : 8,
        essential: high,
        icon: 'waves',
      });
    }

    // ── Forecast: storm and rain, in the words of the list ──
    for (const l of forecastLines(forecastHourly, convectionData.length > 0 ? convectionData : forecastHourly, nowDate)) {
      if (l.id === 'ahead-storm') {
        result.push({ key: l.id, text: `${l.text} (modelo)`, tone: 'gc-t-moderado', priority: 8, essential: true, icon: 'zap' });
      } else if (l.id === 'ahead-rain') {
        result.push({ key: l.id, text: `${l.text} (modelo)`, tone: 'gc-t-riesgo', priority: 5, icon: 'cloud-rain' });
      }
    }

    // ── Thermal forecast: inland only, the detector means nothing on the coast ──
    if (sectorId === 'embalse' && forecastHourly.length > 0) {
      for (const s of detectThermalForecast(forecastHourly, aloft)) {
        result.push({
          key: `thermal-fcst-${s.day}`,
          text: `${sector.shortName}: ${s.label}`,
          tone: s.confidence === 'alta' ? 'gc-t-ok' : 'gc-t-riesgo',
          priority: 9,
        });
      }
    }

    // ── Lightning measured around the sector point ──
    // Distance of the nearest strike and age of the last one. No percentage and no arrival time:
    // against the stored season neither held up (services/lightningStatus.ts).
    if (lightning.level !== 'none') {
      const isDanger = lightning.level === 'danger';
      const isWarning = lightning.level === 'warning';
      const age = lightning.lastStrikeMin != null ? ` · ${formatStrikeAge(lightning.lastStrikeMin)}` : '';
      result.push({
        key: 'lightning-measured',
        text: isDanger ? `Tormenta encima · ${lightning.headline.toLowerCase()}${age}` : `${lightning.headline}${age}`,
        tone: isDanger ? 'gc-t-critico' : isWarning ? 'gc-t-alto' : 'gc-t-riesgo',
        priority: isDanger ? 11 : isWarning ? 10 : 6,
        essential: true,
        icon: 'zap',
      });
    }

    // ── UV: only in peak hours and only actionable values ──
    if (airQuality && airQuality.uvIndex >= UV_TICKER_THRESHOLD && isPeakUvHour()) {
      const uvRounded = Math.round(airQuality.uvIndex);
      const cat = uvCategory(uvRounded);
      result.push({
        key: 'uv-index',
        text: uvTickerLabel(uvRounded),
        tone: cat === 'extreme' || cat === 'very_high' ? 'gc-t-alto' : 'gc-t-moderado',
        priority: cat === 'extreme' ? 8 : cat === 'very_high' ? 6 : 4,
        icon: 'sun',
      });
    }

    // ── Air quality: the official network, a station near the sector, named with its distance ──
    const ica = worstIcaNear(icaReadings, sector.center, sector.radiusKm);
    if (ica) {
      const cat = icaCategory(ica.reading.ica);
      const severe = cat === 'mala' || cat === 'muy_mala';
      result.push({
        key: 'air-quality',
        text: icaSentence(ica),
        tone: severe ? 'gc-t-alto' : 'gc-t-moderado',
        priority: severe ? 7 : 5,
        icon: 'wind',
      });
    }

    // ── Fires: say the zone, not a distance from an unnamed centre. Clusters, never pixels; past the
    // mention range it stays silent: a fire in Zamora is not news for someone in Vigo. ──
    const fireAgg = aggregateFiresForSector(selectFireClusters(fires), sector.center);
    if (fireAgg.severity !== 'none' && fireAgg.nearest) {
      const { distanceKm, bearing, cluster } = fireAgg.nearest;
      const place = describeFireLocation(cluster.lat, cluster.lon, distanceKm, bearing);
      const placeLower = place.charAt(0).toLowerCase() + place.slice(1);
      const age = formatFireAge(cluster.latestAt);
      const isNear = fireAgg.severity === 'alerta';
      result.push({
        key: 'active-fires',
        text: fireAgg.fireCount === 1
          ? `Incendio ${placeLower} · ${age}`
          : `${fireAgg.fireCount} incendios cerca · el más próximo ${placeLower} · ${age}`,
        tone: isNear ? 'gc-t-critico' : 'gc-t-alto',
        priority: isNear ? 10 : 7,
        essential: true,
        icon: 'flame',
      });
    }

    const pool = simple ? result.filter((it) => it.essential === true) : result;
    pool.sort((a, b) => b.priority - a.priority);
    return pool[0] ?? null;
  }, [safetyBandOn, scores, sectorId, sector, forecastHourly, convectionData, rainNowSummary, lightning, unifiedAlerts, airQuality, icaReadings, meteoTide, cardSaysTide, fires, simple, aloft]);

  // ── Official warnings: fixed, with day and hour: a warning for tomorrow must not read as today ──
  const officialWarnings = useMemo(() => {
    const now = new Date();
    const each = mgWarnings.map((w) => {
      const from = new Date(Math.min(...w.zones.map((z) => z.startTime.getTime())));
      const to = new Date(Math.max(...w.zones.map((z) => z.endTime.getTime())));
      return {
        key: `mg-${w.typeId}-${w.maxLevel}`,
        level: w.maxLevel,
        levelLabel: w.maxLevel === 3 ? 'ROJO' : w.maxLevel === 2 ? 'NARANJA' : 'AMARILLO',
        type: warningTitleEs(w.type),
        // A zone with two time windows comes twice
        where: `${spanWords(from, to, now)} · ${[...new Set(w.zones.map((z) => z.name))].join(', ')}`,
      };
    });
    // Two warnings of the same level for the same hours and places («Precipitación 12 horas» and
    // «1 hora») are one line: on a phone each took two rows of the screen before the map. Never
    // across levels: an orange one keeps its own line.
    const grouped: typeof each = [];
    for (const w of each) {
      const same = grouped.find((g) => g.level === w.level && g.where === w.where);
      if (same) same.type = joinWarningTypes(same.type, w.type);
      else grouped.push({ ...w });
    }
    return grouped;
  }, [mgWarnings]);

  // Simple mode: two entries at most over the map, one warning on a phone; the rest wait in Condiciones.
  const isMobile = useUIStore((st) => st.isMobile);
  const plan = topStripPlan(officialWarnings, line, simple, isMobile);
  const shownLine = plan.line ? line : null;
  // The strip beside the map tools reads this, so it does not say the same thing again.
  const setTickerKey = useLevelZeroStore((st) => st.setTickerKey);
  const shownKey = shownLine?.key ?? null;
  useEffect(() => { setTickerKey(shownKey); }, [shownKey, setTickerKey]);
  useEffect(() => () => setTickerKey(null), [setTickerKey]);

  // MeteoGalicia down and no warnings to show: said where they would be, or the empty strip reads as «none» (18-nov)
  const sayUnknown = officialUnknown && plan.warnings.length === 0;
  if (!shownLine && plan.warnings.length === 0 && !sayUnknown) return null;

  return (
    <div className="g-theme flex-shrink-0">
      {plan.warnings.length > 0 && (
        <div className="flex flex-col">
          {plan.warnings.map((w, i) => (
            <div key={w.key} role="alert" className="gc-official">
              <span className="gc-official-level" data-level={w.level}>Aviso {w.levelLabel}</span>
              <b>{w.type}</b>
              {plan.hidden > 0 && i === plan.warnings.length - 1 && (
                <span className="gc-official-more">y {plan.hidden} más en Condiciones</span>
              )}
              <span>{w.where}</span>
            </div>
          ))}
        </div>
      )}

      {sayUnknown && (
        <div role="status" className="gc-official gc-official--unknown">
          <b>{OFFICIAL_UNKNOWN_TITLE}</b>
          <span>{OFFICIAL_UNKNOWN_DETAIL}</span>
        </div>
      )}

      {shownLine && (
        <div className="gc-ticker" role="status" title={shownLine.text}>
          <span className="gc-tickerline">
            {shownLine.icon ? (
              <span className={`inline-flex shrink-0 ${shownLine.tone}`} style={{ color: 'var(--tone)' }}>
                <WeatherIcon id={shownLine.icon} size={15} />
              </span>
            ) : (
              <span className={`gc-dot ${shownLine.tone}`} />
            )}
            <span>{shownLine.text}</span>
          </span>
        </div>
      )}
    </div>
  );
});
