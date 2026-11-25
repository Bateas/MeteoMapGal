/**
 * Card of a sailing or surf spot, opened from its marker. In four groups, so it reads at a glance however much
 * it holds: now (the state, the sentence that decides, what can hurt), what comes next, this place, and the
 * rest folded; what asks something of the reader goes last. The shell is Ficha. The state colour is the marker's.
 */
import { memo, useCallback, useState, useMemo, useEffect, useId } from 'react';
import { Ficha, FichaGroup, Note, Chevron, FoldRow, SupportLink, dec } from './Ficha';
import { useSpotStore } from '../../store/spotStore';
import { useUIStore } from '../../store/uiStore';
import { useForecastStore } from '../../hooks/useForecastTimeline';
import { fetchSwanHsAt } from '../../api/swanGetFeatureInfo';
import { ShareSpotModal } from '../spot/ShareSpotModal';

import { WeatherIcon } from '../icons/WeatherIcons';
import type { SpotScore, SpotVerdict } from '../../services/spotScoringEngine';
import { MAX_PLAUSIBLE_GUST_KT as MAX_DISPLAY_GUST_KT } from '../../services/spotScoringEngine';
import type { SailingSpot } from '../../config/spots';
import { isBeachSpot } from '../../config/spots';
import { displayWindKt, displayWindDir, displayVerdict as renderedVerdict, gateWaveText, gateWaveWhere, surfTone, verdictDoubtText, isGusty, GUSTY_LABEL, VERDICT_LINE, windToneOver, fillOf, lineOf } from '../../config/verdictStyles';
import { SpotReportBox } from '../spot/SpotReportBox';
import { fetchRecentReports } from '../../api/fieldReportClient';
import type { RecentReportSummary } from '../../services/fieldReport';
import { canalizationBand } from '../../services/cesantesCanalizationDetector';
import type { SailingWindow, SpotWindowResult } from '../../services/sailingWindowService';
import { formatThermalCountdown } from '../../services/thermalPrecursorService';
import type { ThermalPrecursorResult } from '../../services/thermalPrecursorService';
import type { HourlyForecast } from '../../types/forecast';
import { detectThermalForecast } from '../../services/thermalForecastDetector';
import { useAloft } from '../../hooks/useAloft';
import { getSunTimes, formatTime } from '../../services/solarUtils';
import { useBuoyStore } from '../../store/buoyStore';
import { silentLabel } from '../../services/buoyUtils';
import { mgWarningsAt } from '../../services/warningReach';
import { useWarningsStore } from '../../hooks/useWarnings';
import { useWeatherStore } from '../../store/weatherStore';
import { degreesToCardinal, scaleGustToSpot } from '../../services/windUtils';
import { fetchMarineData } from '../../api/marineClient';
import { fetchMeteoSixSeaTemp } from '../../api/meteoSixClient';
import { fetchSpotForecast, isSpotForecastStale, windChartPlace } from '../../services/spotForecastFetch';
import { useSectorStore } from '../../store/sectorStore';
import { isCoastalSector } from '../../config/sectors';
import { useAirQualityStore } from '../../store/airQualityStore';
import { useAlertStore } from '../../store/alertStore';
import { beachWaveAt, formatSurfWave, surfDisplayState, type SurfSpotShape, type SurfWaveEntry } from '../../services/surfVerdictEngine';
import { detectViracionPhase } from '../../services/viracionDetector';
import { assessRainNowcast } from '../../services/rainNowcastService';
import { useRainNowStore } from '../../store/rainNowStore';
import { assessBeachDay } from '../../services/beachDayService';
import { waterTempLabel } from '../../services/buoyUtils';
import { timeAgoEs } from '../spot/spotColors';
import { SpotTideSummary } from '../spot/SpotTideSummary';
import { SpotWarningNotice } from '../spot/SpotWarningNotice';
import { SpotPushOptIn } from '../spot/SpotPushOptIn';
import { SpotHistoryChart } from '../spot/SpotHistoryChart';
import { Cell } from '../spot/Cell';
import { WindNowNext } from '../spot/WindNowNext';
import { TrendMark } from '../spot/TrendMark';
import { spotWindDrift, TREND_MAX_AGE_MIN, type WindTrend } from '../../services/windTrendService';
import { ageMinutes, dataAge } from '../../services/dataAge';
import { useMinuteClock } from '../../hooks/useMinuteClock';
import { WebcamSection } from '../spot/WebcamSection';
import { useHistoricalBaseline } from '../../hooks/useHistoricalBaseline';
import { describeVsBaseline } from '../../services/historicalBaselineService';
import { buildShareUrl } from '../../services/shareImageGenerator';
import { isSimulationActive, withSimulation } from '../../config/simulation';

// Marker shapes for the state chip (30x30 box): hexagon for wind spots, pentagon for surf.
const HEX_PTS = '15,2 26.26,8.5 26.26,21.5 15,28 3.74,21.5 3.74,8.5';
const PENTA_PTS = '15,2 27.36,10.98 22.64,25.52 7.36,25.52 2.64,10.98';
/** «NAVEGABLE» → «Navegable»: the V3 head writes the state as a word, not a shout. */
const sentenceCase = (s: string) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : s);

const VERDICT_STYLE: Record<SpotVerdict, { label: string }> = {
  calm:    { label: 'CALMA' },
  light:   { label: 'FLOJO' },
  sailing: { label: 'NAVEGABLE' },
  good:    { label: 'BUENO' },
  strong:  { label: 'FUERTE' },
  unknown: { label: 'SIN DATOS' },
};

interface SpotPopupProps {
  spot: SailingSpot;
  score?: SpotScore | undefined;
}

export const SpotPopup = memo(function SpotPopup({ spot, score: propScore }: SpotPopupProps) {
  const storeScore = useSpotStore((s) => s.scores.get(spot.id));
  const score = propScore !== undefined ? propScore : storeScore;
  const selectSpot = useSpotStore((s) => s.selectSpot);
  const favoriteSpotId = useSpotStore((s) => s.favoriteSpotId);
  const toggleFavorite = useSpotStore((s) => s.toggleFavorite);
  const sailingWindows = useSpotStore((s) => s.sailingWindows);
  const thermalPrecursors = useSpotStore((s) => s.thermalPrecursors);
  // Simple mode keeps the decision essentials and hides the technical sections.
  const simpleMode = useUIStore((s) => s.simpleMode);
  const silentBuoys = useBuoyStore((s) => s.silentBuoys);
  const silentPreferred = useMemo(
    () => silentBuoys.filter((b) => spot.preferredBuoys?.includes(b.stationId) && silentLabel(b.timestamp) != null),
    [silentBuoys, spot.preferredBuoys],
  );
  const alphaMode = useUIStore((s) => s.alphaMode);
  // The card speaks only of the warnings whose zone holds the spot (warningReach.ts).
  const sectorWarnings = useWarningsStore((s) => s.sectorWarnings);
  const spotWarnings = useMemo(
    () => mgWarningsAt(sectorWarnings, { lat: spot.center[1], lon: spot.center[0] }),
    [sectorWarnings, spot.center],
  );
  const clock = useMinuteClock();
  const dismiss = useCallback(() => selectSpot(''), [selectSpot]);
  const titleId = useId();
  const spotForecasts = useSpotStore((s) => s.spotForecasts);
  const setSpotForecast = useSpotStore((s) => s.setSpotForecast);
  const windowResult = sailingWindows.get(spot.id);

  // Spot-specific WRF 1km forecast — fetch on open, cache 30min
  const cached = spotForecasts.get(spot.id);
  const spotForecast = cached?.data ?? [];
  // Initial loading = true when no fresh cache → UI shows "Cargando..." from first
  // render instead of flashing blank then loading → blank again.
  const [spotFcLoading, setSpotFcLoading] = useState(() => isSpotForecastStale(cached));
  const [spotFcError, setSpotFcError] = useState(false);
  const chartPlace = windChartPlace({
    isSurf: spot.category === 'surf',
    windKt: displayWindKt(score),
    scorePending: !score || score.provisional === true,
    forecastHours: spotForecast.length,
    loading: spotFcLoading,
    failed: spotFcError,
  });

  useEffect(() => {
    // `spotFcLoading` used to be part of this guard, and since it STARTS true
    // whenever the cache is stale, both branches returned: stale meant loading,
    // and not-stale meant nothing to do. The request had not gone out since
    // 23 April. Dedup belongs in the fetcher, not in a render-state flag —
    // the flag is for the spinner, and the spinner must not gate the fetch.
    if (!isSpotForecastStale(cached)) return;
    setSpotFcLoading(true);
    setSpotFcError(false);
    const [lon, lat] = spot.center;
    fetchSpotForecast(spot.id, lat, lon)
      .then((data) => setSpotForecast(spot.id, data))
      .catch((err) => { console.debug(`[SpotForecast] ${spot.id} both attempts failed:`, err); setSpotFcError(true); })
      .finally(() => setSpotFcLoading(false));
  }, [spot.id, spot.center, cached, setSpotForecast]);
  // The «posible brisa» band (canalization) gives way to someone on the water: the recent reports
  // decide whether it is offered (canalizationBand). Shared cache with SpotReportBox: one request.
  const bandKt = score?.channelingPossibleKt ?? null;
  const [recentReport, setRecentReport] = useState<RecentReportSummary | null>(null);
  useEffect(() => {
    if (bandKt == null) return;
    let alive = true;
    fetchRecentReports(spot.id).then((s) => { if (alive) setRecentReport(s); });
    return () => { alive = false; };
  }, [spot.id, bandKt]);
  // MOHID sea temp (Rías only — fetch alongside spot forecast)
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const aqData = useAirQualityStore((s) => s.data);
  const [mohidSeaTemp, setMohidSeaTemp] = useState<number | null>(null);

  useEffect(() => {
    if (!isCoastalSector(sectorId)) return;
    const [lon, lat] = spot.center;
    fetchMeteoSixSeaTemp(lat, lon)
      .then((data) => {
        // Find current hour's sea temp
        const now = Date.now();
        const closest = data.reduce<{ time: Date; seaTemp: number | null } | null>((best, d) => {
          if (d.seaTemp == null) return best;
          if (!best) return d;
          return Math.abs(d.time.getTime() - now) < Math.abs(best.time.getTime() - now) ? d : best;
        }, null);
        setMohidSeaTemp(closest?.seaTemp ?? null);
      })
      .catch(() => {});
  }, [spot.id, spot.center, sectorId]);

  // Open-Meteo Marine SST — localized fallback for SURF spots. The engine skips
  // the nearest buoy for surf (it can sit in a different water mass — e.g. Patos's
  // closest buoy is A Guarda at the Miño river mouth, river-cooled to ~15.5°C
  // while Patos is ~18°C), and MOHID's estuary-only coverage misses exposed
  // beaches. Open-Meteo Marine SST is global + per-coordinate, so it represents
  // the actual beach far better than a distant buoy in another water mass.
  const [marineSST, setMarineSST] = useState<number | null>(null);
  useEffect(() => {
    if (spot.category !== 'surf') return;
    const [lon, lat] = spot.center;
    fetchMarineData(lat, lon)
      .then((d) => setMarineSST(d?.seaSurfaceTemp ?? null))
      .catch(() => {});
  }, [spot.id, spot.center, spot.category]);

  const precursor = spot.thermalDetection ? thermalPrecursors.get(spot.id) : undefined;

  /**
   * Fog for the beach verdict comes from the GATED alert, never from a raw
   * camera. One webcam calling fog is exactly the failure the rigour rule
   * exists for — low sun reflecting off the water at dusk reads as fog to
   * moondream — which is why `maritimeFogService` demands a second, independent
   * unit of evidence before it emits anything. Reading `visionResult` here
   * walked straight around that gate through the side door, and produced a
   * contradiction the user could see: the ticker said "buen día de playa"
   * while this popup said "mal día — niebla", for the same spot, same minute.
   * The ticker was the one doing it right; this now reads the same source.
   */
  const fogAlertActive = useAlertStore((s) => s.alerts).some(
    (a) => a.category === 'fog' && (a.severity === 'high' || a.severity === 'critical'),
  );

  const verdict: SpotVerdict = score?.verdict ?? 'unknown';
  const vs = VERDICT_STYLE[verdict];
  // Closed by the sea: the headline names the sea and where it was measured, the wind goes second.
  const seaText = gateWaveText(score);
  const seaWhere = gateWaveWhere(score);

  // ── Cesantes canalization — read from the score, never recomputed here ──
  // The engine runs the detector once, rain veto included, and the marker, this card and
  // the alert pipeline all read that one answer. This card used to run its own copy, with
  // other inputs (MOHID water, mouth cameras) and without the engine's confidence gate, so
  // it could headline a figure the engine had refused.
  const channelingPrediction = score?.channeling?.active ? score.channeling : null;
  const measuredKt = score?.wind?.avgSpeedKt ?? 0;
  // Effective wind = the speed that actually drove the verdict (thermal/bocana
  // boost). Display it so the popup never shows a different kt than the marker/
  // ticker/banner for the same spot (O3 coherence — popup-vs-engine asymmetry).
  const effectiveKt = score?.effectiveWindKt ?? score?.wind?.avgSpeedKt ?? 0;
  // "variable" with no arrow when the sources disagree on where the wind comes from.
  const windDirView = displayWindDir(score);
  const windIsBoosted = score?.effectiveWindKt != null && score?.wind != null
    && Math.round(score.effectiveWindKt) !== Math.round(score.wind.avgSpeedKt);

  // The gust has to travel with the mean, or the card contradicts itself.
  //
  // It did: the headline showed the boosted wind while the gust stayed raw, so
  // a spot reading 5kt at the station and boosted to 14 displayed "Racha 10kt"
  // underneath — a gust BELOW the mean, which cannot happen and which anyone
  // spots instantly. The guard made it worse by comparing the gust against the
  // raw mean, so the impossible pair passed the check that existed to prevent
  // exactly this.
  //
  // Scaling by the same factor is the defensible move rather than a guess: the
  // gust factor was measured across four consecutive days at Castrelo and came
  // out flat — x2.6, x2.7, x2.9, x2.8 on days that ranged from a dead afternoon
  // to the best of the week. A ratio that stable is one that survives being
  // carried from the station to the spot. And the alternative is worse: leaving
  // the gust raw states two numbers from two different places as though they
  // described the same water.
  //
  // The sanity cap still applies at the end. A large boost on an already gusty
  // reading could otherwise print something no anemometer in Galicia has seen.
  const effectiveGustKt = scaleGustToSpot(
    score?.gustKt ?? null,
    measuredKt,
    effectiveKt,
    MAX_DISPLAY_GUST_KT,
  );
  const gustIsBoosted = effectiveGustKt != null && score?.gustKt != null
    && Math.round(effectiveGustKt) !== Math.round(score.gustKt);

  // ── Viración (daily wind cycle phase) — Rías sailing spots only ──
  // Cross-validates the spot's reference station against its preferred buoy
  // when both are available. Conservative emit: only renders when the
  // detector's confidence ≥ medium AND phase ≠ unknown. No alerts, no
  // overlays — just one informative line near the wind display.
  const viracion = (() => {
    if (!isCoastalSector(sectorId) || spot.category === 'surf') return null;
    // Frontal flow aloft: the wind is not the breeze, whatever the clock says (the card
    // already shows the veto's own line).
    if (score?.regimeVeto?.vetoed) return null;
    try {
      const readingsMap = useWeatherStore.getState().currentReadings ?? new Map();
      const buoys = useBuoyStore.getState().buoys ?? [];
      const refStationId = spot.preferredStations?.[0];
      const reading = refStationId ? readingsMap.get(refStationId) ?? null : null;
      // Pick the spot's first preferred buoy if it has wind data
      const refBuoyId = spot.preferredBuoys?.[0];
      const buoyRow = refBuoyId ? buoys.find((b) => b.stationId === refBuoyId) : undefined;
      const buoyInput = buoyRow && buoyRow.windDir != null
        ? { windDirection: buoyRow.windDir, windKt: buoyRow.windSpeed != null ? buoyRow.windSpeed * 1.94384 : undefined }
        : null;
      // Use the closest forecast hour as the synoptic gate input
      const nowMs = Date.now();
      let synopticKt: number | null = null;
      let bestDt = Infinity;
      for (const h of spotForecast) {
        const dt = Math.abs(h.time.getTime() - nowMs);
        if (dt < bestDt && h.windSpeed != null) {
          bestDt = dt;
          synopticKt = h.windSpeed * 1.94384;
        }
      }
      const result = detectViracionPhase(spot.id, {
        reading,
        buoy: buoyInput,
        synopticKt,
        now: new Date(nowMs),
      });
      // Conservative: hide everything except medium/high confidence
      if (result.phase === 'unknown' || result.confidence === 'low') return null;
      return result;
    } catch (err) {
      console.debug('[Viracion] detector error:', err);
      return null;
    }
  })();

  // The «Lluvia ahora» layer's measured gauges and radar arrival (same source as the chip and the alerts).
  const rainSummary = useRainNowStore((s) => s.summary);

  // ── Rain nowcast: "¿llueve ahora? / ¿lluvia próxima?" ──────────────
  // Built on data the user trusts: nearby station precip (observed) + the
  // spot's own forecast (short horizon). NOT the webcam-AI precip flag.
  const rain = (() => {
    try {
      const stations = useWeatherStore.getState().stations ?? [];
      const readings = useWeatherStore.getState().currentReadings ?? new Map();
      const forecast = spotForecast.length > 0 ? spotForecast : (useForecastStore.getState().hourly ?? []);
      const arrival = rainSummary?.arrivals.find((a) => a.spotId === spot.id) ?? null;
      return assessRainNowcast({
        spotCenter: spot.center,
        radiusKm: spot.radiusKm,
        stations,
        readings,
        forecast,
        measured: rainSummary && !rainSummary.sim
          ? { gauges: rainSummary.gauges, arrivalMin: arrival ? arrival.etaMin : null }
          : null,
      });
    } catch (err) {
      console.debug('[RainNowcast] error:', err);
      return null;
    }
  })();

  // ── Surf verdict: wave-based, overrides wind verdict for surf spots ──
  // READ from the cache entry useSurfMarineData builds — the same one the
  // marker, the spot list and the ticker read. The popup used to download its
  // own forecast, take its first hour and write it back raw (no coastal
  // factor), so opening Patos turned its marker from «PEQUE 0.6m» into
  // «SURF OK 1.4m» of open sea. It no longer computes or writes anything.
  // Map.get returns a stable reference, so this only fires when the entry
  // itself is replaced.
  const surfEntry = useSpotStore((s) =>
    spot.category === 'surf' ? s.surfWaveCache.get(spot.id) : undefined,
  );
  // 'danger' (the engine's hard gate) makes the card read the engine's own
  // verdict and summary, as it does for any spot — see surfDisplayState.
  const surfState = spot.category === 'surf' ? surfDisplayState(surfEntry, score) : null;
  const surfInfo = surfState === 'ready' ? (surfEntry?.verdict ?? null) : null;

  // ── SWAN per-spot Hs: cross-check Open-Meteo with the
  // CESGA academic high-resolution model at the actual spot location.
  // Returns null if CESGA is down (frequent) or the point is out of domain —
  // silent fail, never blocks the popup. ──
  const [swanHs, setSwanHs] = useState<number | null>(null);
  useEffect(() => {
    if (spot.category !== 'surf') return;
    let cancelled = false;
    fetchSwanHsAt(spot.center[1], spot.center[0]).then((result) => {
      if (!cancelled) setSwanHs(result.hs);
    });
    return () => { cancelled = true; };
  }, [spot.id, spot.category, spot.center]);

  // Share modal
  const [shareOpen, setShareOpen] = useState(false);

  // Surf spots show the surf verdict, never the wind one: while it is not
  // ready the badge says so instead of falling back to «CALMA». The one
  // exception is the engine's hard gate, where the card says what the engine
  // says («FUERTE» — «Viento excesivo (30kt). Peligroso.»): the wave verdict
  // ignores wind speed.
  const displayVerdict = surfInfo
    ? { label: surfInfo.label, summary: surfInfo.summary }
    : spot.category === 'surf' && surfState !== 'danger'
      ? { label: 'SIN DATO DE OLAS', summary: '' }
      : { label: vs.label, summary: surfState === 'danger' ? (score?.summary ?? '') : '' };

  // Spot-local wave for the sport-warning threshold: the cache entry carries
  // the coastal factor and swell alignment, so it describes THIS beach rather
  // than the open sea. The height does not depend on the wind, so it is passed
  // while the wind is pending and over a hard gate too — the case where the
  // 4 m comparison matters most.
  const surfSpotWave = surfEntry?.waveHeight ?? undefined;

  const isSurf = spot.category === 'surf';
  // No score yet (a shared link opened on a cold load) is pending too: the marker says «Calculando…» then,
  // and the card said «Sin datos» beside it (review, 18-nov).
  const pending = !score || !!score.provisional || surfState === 'loading';
  const staleAge = score?.computedAt && dataAge(ageMinutes(score.computedAt, clock)) !== 'fresh' ? timeAgoEs(score.computedAt) : null;
  // One line about the thermal, the strongest: three of them could stack up saying the same.
  const thermalNow = precursor && precursor.level !== 'watch' ? formatThermalCountdown(precursor) : null;
  // The sentence that says what to do with it, right under the state. Not while the figure is withheld:
  // it would state the number the head is keeping back.
  // Nor while the colour is held between two levels: «Insuficiente para navegar» beside «entre Flojo y
  // Navegable» says one of the two answers as if it were sure (P3 review, 19-nov).
  // A light mean with strong gusts: the sentence says both, instead of «Insuficiente para navegar».
  const gusty = !isSurf && isGusty(score, effectiveGustKt);
  const decision = displayVerdict.summary
    || (gusty ? `Media floja, con rachas de ${effectiveGustKt!.toFixed(0)} kt.` : '')
    || (!isSurf && !score?.provisional && !verdictDoubtText(score) ? (score?.reason ?? score?.summary ?? '') : '');
  // The surf figure is a model: hollow, as on the map. Without one there is nothing to draw; the rest, the state.
  const surfHollow = isSurf && surfState === 'ready';
  const chipEmpty = pending || (isSurf && surfState === 'nodata');
  // Past 22 kt a «Fuerte» spot takes the colour of its wind, as on the map
  const spotTone = isSurf ? null : windToneOver(verdict, displayWindKt(score));
  const chip = (
    <svg className="gf-chip" width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
      <polygon
        points={isSurf ? PENTA_PTS : HEX_PTS}
        fill={chipEmpty ? 'var(--g-hair)' : surfHollow ? 'none' : fillOf(verdict, spotTone)}
        stroke={surfHollow && surfInfo ? VERDICT_LINE[surfTone(surfInfo.level)] : 'var(--g-rule)'}
        strokeWidth={surfHollow ? 3 : 1.5}
      />
    </svg>
  );

  return (
    <>
      <Ficha longitude={spot.center[0]} latitude={spot.center[1]} onClose={dismiss} titleId={titleId} backUrl={withSimulation(`${window.location.pathname}?sector=${sectorId}&spot=${spot.id}`)}>
        {/* ── Name and actions ── */}
        <div className="gf-head">
          <div className="gf-titles">
            <h2 className="gf-name" title={spot.description}>
              <span id={titleId}>{spot.name}</span>
            </h2>
            {/* How recent it is says nothing while it is recent: up here only when the figure is not from now. */}
            {staleAge && <div className="gf-sub">{staleAge}</div>}
          </div>
          <div className="gf-acts">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); toggleFavorite(spot.id); }}
              className="gc-btn gc-btn--plain gc-btn--icon"
              title={favoriteSpotId === spot.id ? 'Quitar favorito' : 'Marcar favorito'}
              aria-label={favoriteSpotId === spot.id ? 'Quitar favorito' : 'Marcar favorito'}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill={favoriteSpotId === spot.id ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" aria-hidden="true">
                <path d="m12 3 2.7 5.8 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3.1 1.2-6.2L3 9.6l6.3-.8L12 3Z" />
              </svg>
            </button>
            {/* Hidden while provisional: a shared image outlives the correction. The card settles in a
                cycle or two; a screenshot in someone else's chat does not. Hidden on surf too: the
                image is a WIND card, and it said «CALMA 2 kt» for a beach whose card said «CLÁSICO». */}
            {!simpleMode && score && !score.provisional && !isSurf && !isSimulationActive() && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShareOpen(true); }}
                className="gc-btn gc-btn--plain gc-btn--icon"
                title="Compartir como imagen"
                aria-label="Compartir como imagen"
              >
                <WeatherIcon id="share" size={16} />
              </button>
            )}
          </div>
        </div>

        {/* ── The state, in one big line ── */}
        {pending ? (
          // Cold-load provisional score (same flag SpotMarker reads): never a firm verdict from a partial
          // reading set. Surf: same rule while the wave forecast or the spot's wind has not arrived. The
          // figure is what is withheld: direction and station count stay, the count being the reason.
          <div className="gf-big">
            {chip}
            <span className="gf-pending">
              {surfState === 'loading'
                ? (surfEntry ? 'Calculando (esperando el viento de las estaciones)…' : 'Calculando olas…')
                : 'Calculando condiciones (esperando estaciones)…'}
            </span>
            {!isSurf && score?.wind && (
              <span className="gf-side">
                <span>{windDirView?.deg != null ? `del ${windDirView.label} ${Math.round(windDirView.deg)}°` : 'dirección variable'}</span>
                <span>{score.wind.stationCount} estaciones</span>
              </span>
            )}
          </div>
        ) : seaText ? (
          <div className="gf-big">
            {chip}
            <span key={seaText} className="gf-figure gf-figure--long">Oleaje · {seaText}</span>
            <span className="gf-side">
              <b>{seaWhere}</b>
              {score?.wind && <span>no es viento: {Math.round(effectiveKt)} kt</span>}
            </span>
          </div>
        ) : (
          <div className="gf-big">
            {chip}
            <span key={`${displayVerdict.label}-${effectiveKt.toFixed(0)}-${surfEntry?.waveHeight ?? ''}`} className={`gf-figure${isSurf && !surfInfo ? ' gf-figure--long' : ''}`}>
              {isSurf ? displayVerdict.label : sentenceCase(displayVerdict.label)}
              {/* Same height the marker, the list and the ticker print: a model value, and it says so,
                  because nobody measures waves on this beach. */}
              {surfInfo && surfEntry?.waveHeight != null && <> · {formatSurfWave(surfEntry.waveHeight)}</>}
              {(!isSurf || surfState === 'danger') && score?.wind && <> · {effectiveKt.toFixed(0)}</>}
            </span>
            {surfInfo && surfEntry?.waveHeight != null && <span className="gf-model"> (modelo)</span>}
            {(!isSurf || surfState === 'danger') && score?.wind && (
              <span className="gf-side">
                <b>
                  {windDirView?.deg != null ? (
                    <>
                      nudos del {windDirView.label}{' '}
                      <span style={{ display: 'inline-block', color: 'inherit', transform: `rotate(${(windDirView.deg + 180) % 360}deg)` }} aria-hidden="true">↑</span>
                      {!simpleMode && <> {Math.round(windDirView.deg)}°</>}
                    </>
                  ) : (
                    <span style={{ color: 'inherit' }} title="Las estaciones cercanas no coinciden en la dirección">nudos · rumbo variable</span>
                  )}
                </b>
                {/* Without a heading the trend goes on its own line, named: «dirección variable estable» read as one thing. */}
                {!isSurf && <SpotDrift spotId={spot.id} trend={score.windTrend} computedAt={score.computedAt} ownLine={windDirView?.deg == null} />}
                {/* On a verdict line the reading does not tell the two levels apart: say so. */}
                {!isSurf && verdictDoubtText(score) && <span>{verdictDoubtText(score)}</span>}
                {/* The gust travels with the mean (scaleGustToSpot). What the instrument read is in «Cómo lo sabemos». */}
                {gusty && <span>{GUSTY_LABEL}</span>}
                {effectiveGustKt != null && effectiveGustKt > effectiveKt && <span>racha {effectiveGustKt.toFixed(0)}</span>}
              </span>
            )}
          </div>
        )}

        {decision && (
          <p className="gf-say" style={{ ['--gf-tone' as string]: pending ? undefined : surfHollow && surfInfo ? VERDICT_LINE[surfTone(surfInfo.level)] : lineOf(verdict, spotTone) } as React.CSSProperties}>
            {decision}
          </p>
        )}

        {/* ── What can hurt comes first ── */}
        {score?.hardGateTriggered && (
          <div className="gf-alert" role="alert"><WeatherIcon id="alert-triangle" size={15} /> {score.hardGateTriggered}</div>
        )}
        {score?.hasStormAlert && (
          <div className="gf-alert" role="alert"><WeatherIcon id="alert-triangle" size={15} /> Alerta de tormenta activa</div>
        )}
        {spot.caution && (
          <div className="gf-notes gf-notes--now">
            <Note icon="alert-triangle" tone="alto">{spot.caution}</Note>
          </div>
        )}

        {/* Sport-threshold reading of an active orange marine warning. Informs, never authorises: all copy
            lives in sportWarningService, guarded by the no-authorisation test. Wave ONLY for surf spots,
            where the cache value is already through the spot's coastal factor; a sailing spot gets null
            (its nearest wave buoy measures open water). Demo: ?simorange=1|alta|sindato|rojo */}
        <SpotWarningNotice
          sectorId={sectorId}
          warnings={spotWarnings}
          waveHeightM={isSurf ? (surfSpotWave ?? null) : null}
          waveIsModel={isSurf}
          windKt={score?.provisional ? null : (score?.effectiveWindKt ?? score?.wind?.avgSpeedKt ?? null)}
        />

        {/* ── What is going on now, one line each. An empty list draws nothing. ── */}
        <div className="gf-notes gf-notes--now">
          {/* The word by the figure already says «sube»: a rapid rise is the one that is news. */}
          {score?.windTrend?.signal === 'rapid' && (
            <Note icon="activity" tone="critico" title={score.windTrend.label}>
              Subida rápida: {Math.round(score.windTrend.deltaKt)} kt más en {score.windTrend.minutes} min
            </Note>
          )}

          {/* «¿Llueve?»: station gauge. The rain that is only on its way is under «Lo que viene». */}
          {rain && rain.status === 'raining' && (
            <Note icon="cloud-rain" tone="riesgo" title="Lluvia observada en estación cercana">{rain.summary}</Note>
          )}

          {/* Cesantes canalization: a «posible brisa» band, never the figure */}
          {(() => {
            const band = canalizationBand(bandKt, score?.wind?.avgSpeedKt ?? null, recentReport);
            if (!band || !channelingPrediction) return null;
            if (band.cancelledBy) {
              return <Note icon="wind">Posible brisa por canalización descartada: {band.cancelledBy}.</Note>;
            }
            return (
              <Note icon="wind" tone="riesgo">
                <span className="gf-strong">
                  Posible brisa hasta ~{band.possibleKt} kt {channelingPrediction.predictedDir != null ? degreesToCardinal(channelingPrediction.predictedDir) : ''} (sin confirmar)
                </span>
                <small>
                  {channelingPrediction.signals[0]}. Las estaciones miden {Math.round(score?.wind?.avgSpeedKt ?? 0)} kt
                  {/* Simple mode has no report box to send it with */}
                  {simpleMode ? '.' : ': si en el agua no lo ves, repórtalo.'}
                </small>
              </Note>
            );
          })()}

          {viracion?.confidence === 'high' && <Note icon="wind" tone="riesgo">{viracion.description}</Note>}

          {/* Shown in BOTH modes on purpose: the casual user has the fewest tools to doubt the number, so
              hiding the caveat left the least equipped reader with the most confident-looking screen. */}
          {score && score.scoringConfidence === 'low' && (
            <Note icon="alert-triangle" tone="alto">
              {simpleMode
                ? 'Poco dato cerca de aquí: tómalo como orientativo'
                : `Baja confianza: solo ${score.wind?.stationCount ?? 0} fuente(s) de viento cercana(s)`}
            </Note>
          )}

        </div>

        <FichaGroup title="Lo que viene">
          {/* What was measured and what the model gives, on one axis. Not for a surf spot, whose figure is the
              wave, nor while the figure is withheld. */}
          {/* On the phone the sheet peeks down to here (data-peek-end): verdict and the coming hours without
              sliding (18-nov). */}
          {chartPlace === 'chart' && (
            <div data-peek-end=""><WindNowNext spotId={spot.id} forecast={spotForecast} nowKt={displayWindKt(score)!} /></div>
          )}
          {/* Its place, kept while the forecast or the figure is on its way: the sheet does not grow when it lands. */}
          {chartPlace === 'wait' && <div data-peek-end="" className="gf-plotwait" aria-hidden="true" />}
          {isSurf && <div data-peek-end=""><WaveForecastMini spot={spot} entry={surfEntry} /></div>}
          <div className="gf-notes">
            {rain && rain.status !== 'unknown' && rain.status !== 'dry' && rain.status !== 'raining' && (
              <Note icon="cloud" title="Lluvia prevista (previsión)">{rain.summary}</Note>
            )}
            {/* Thermal onset, deliberately fuzzy (the ETA is ±30 min). It says the conclusion and not what it rests on, and
                'watch' (≤40 %) is noise: only someone testing the app sees those, in the fold under «Más». */}
            {thermalNow && (
              <Note icon="wind" tone={thermalNow.tone === 'active' ? 'ok' : thermalNow.tone === 'soon' ? 'alto' : undefined} title="Estimación aproximada (±30 min)">
                <span className="gf-strong">{thermalNow.text}</span>
              </Note>
            )}
            {!thermalNow && spot.thermalDetection && spotForecast.length > 0 && <ThermalForecastBadge forecast={spotForecast} />}
            {!thermalNow && score?.thermal && score.thermal.thermalProbability >= 40 && (
              <Note icon="sun">
                Térmica: {score.thermal.thermalProbability} % de probabilidad
                {score.thermal.windWindow && `, de ${score.thermal.windWindow.startHour} a ${score.thermal.windWindow.endHour} h`}
              </Note>
            )}
          </div>
          {/* While the spot's own WRF 1 km is in flight, or has failed, the sector's forecast already in memory
              stands in, open because there is no chart yet, and the WRF replaces it when it lands. */}
          {!isSurf && spotForecast.length === 0 && (() => {
            const autoForecast = useForecastStore.getState().hourly;
            if (autoForecast.length > 0) {
              const nowMs = Date.now();
              const next12h = autoForecast.filter((h) => {
                const t = h.time instanceof Date ? h.time.getTime() : new Date(h.time).getTime();
                return t >= nowMs - 30 * 60_000 && t <= nowMs + 12 * 3600_000;
              });
              if (next12h.length >= 3) {
                return (
                  <ForecastMiniTimeline
                    forecast={next12h}
                    note={spotFcError ? 'WRF 1 km no disponible: es la previsión de la zona (Open-Meteo)' : 'De la zona (Open-Meteo) mientras carga la del WRF 1 km'}
                  />
                );
              }
            }
            if (spotFcLoading) return <div className="gf-row gf-row--static">Cargando previsión…</div>;
            if (spotFcError) return <div className="gf-row gf-row--static">Previsión no disponible</div>;
            return null;
          })()}
          {!isSurf && (
            // A button, with its border: as a bold line it read like the section titles around it (18-nov).
            <button type="button" className="gc-btn gf-action gf-action--go" onClick={() => useUIStore.getState().setForecastPanelOpen(true, spot.id)}>
              <span>Ver previsión detallada</span>
              <Chevron dir="right" />
            </button>
          )}
        </FichaGroup>

        <FichaGroup title="Aquí">
          <div className="gf-notes">
          {/* A buoy this spot leans on that went silent: said here, not only greyed on the map (18-nov,
              Ons silent since 17-nov 18:10). */}
          {silentPreferred.map((b) => (
            <Note key={b.stationId} icon="alert-triangle" title="Boya que usa este spot">
              {b.stationName}: {silentLabel(b.timestamp) ?? 'sin dato'}
            </Note>
          ))}
          {/* ¿Buen día de playa? Only on actual beaches (BEACH_SPOT_IDS), and only in daylight: nobody
              goes to the beach at night. */}
          {isBeachSpot(spot.id) && (() => {
            const nowBeach = new Date();
            const sun = getSunTimes(nowBeach, spot.center);
            if (nowBeach < sun.sunrise || nowBeach >= sun.sunset) return null;
            // The forecast hour NEAREST to now, like the ticker: arrays start at different hours, and
            // the first one gave «Sol» under the overcast front of 29-sep.
            const nowHour = spotForecast.reduce<(typeof spotForecast)[number] | null>(
              (best, h) => (!best || Math.abs(h.time.getTime() - nowBeach.getTime()) < Math.abs(best.time.getTime() - nowBeach.getTime()) ? h : best),
              null,
            );
            const beach = assessBeachDay({
              cloudCoverPct: nowHour && Math.abs(nowHour.time.getTime() - nowBeach.getTime()) <= 90 * 60_000 ? (nowHour.cloudCover ?? null) : null,
              // The figure the head shows: the raw mean read «Sin apenas viento» beside «Bueno, 13»
              windKt: displayWindKt(score),
              gustKt: score?.gustKt ?? null,
              airTempC: score?.airTemp ?? null,
              waterTempC: score?.waterTemp ?? mohidSeaTemp ?? marineSST ?? null,
              rainingNow: rain?.status === 'raining',
              rainSoon: rain?.status === 'rain-soon',
              // The gated multi-evidence alert, not a single camera: see fogAlertActive above.
              foggy: fogAlertActive,
            });
            if (beach.verdict === 'unknown' || beach.outOfSeason) return null;
            return (
              <Note icon="beach" tone={beach.verdict === 'great' ? 'ok' : beach.verdict === 'ok' ? 'moderado' : 'alto'} title="Resumen casual de condiciones de playa">
                <span className="gf-strong">¿Playa? {beach.summary}</span>
                {beach.reasons.length > 0 && <small>{beach.reasons.join(' · ')}</small>}
              </Note>
            );
          })()}

          </div>
        {!isSurf && score?.waves && score.waves.waveHeight != null && spot.waveRelevance !== 'none' && (
          <dl className="gf-data">
            {score.waves.localHeight != null && score.waves.localSource !== 'buoy' && (
              <Cell
                label={score.waves.localSource === 'swan' ? 'Ola en la zona (modelo)' : 'Ola en la zona (estimada)'}
                value={`${score.waves.localSource === 'estimate' ? '≈' : ''}${dec(score.waves.localHeight)} m`}
              />
            )}
            {/* The open-ocean buoy only when the spot has no sea of its own: the Silleiro figure next to
                the spot's own added nothing, and it stays in the gate text. */}
            {(score.waves.localHeight == null || score.waves.localSource === 'buoy') && (
              <Cell
                label={score.waves.sourceBuoy ? `Oleaje (${score.waves.sourceBuoy}, mar abierto)` : 'Oleaje'}
                value={`${dec(score.waves.waveHeight)} m`}
              />
            )}
            {score.waves.wavePeriod != null && <Cell label="Período" value={`${score.waves.wavePeriod.toFixed(0)} s`} />}
          </dl>
        )}
        {score && (score.airTemp != null || score.waterTemp != null || mohidSeaTemp != null || marineSST != null) && (
          <TemperatureSection score={score} mohidSeaTemp={score.waterTemp == null ? mohidSeaTemp : null} marineSST={marineSST} />
        )}
        {spot.tideStationId && !isSurf && <SpotTideSummary tideStationId={spot.tideStationId} nextOnly={simpleMode} />}

        {isSurf && spot.tideStationId && (
          <SpotTideSummary tideStationId={spot.tideStationId} tidePreference={spot.tidePreference} nextOnly={simpleMode} />
        )}
          <div className="gf-notes">
          {aqData && aqData.uvIndex >= 6 && (
            <Note icon="sun" tone={aqData.uvIndex >= 8 ? 'critico' : 'alto'}>
              UV {Math.round(aqData.uvIndex)}
              {aqData.uvIndex >= 11 ? ': extremo, protección total' : aqData.uvIndex >= 8 ? ': muy alto, crema SPF50+' : ': alto, protección recomendada'}
            </Note>
          )}
          {aqData && aqData.europeanAqi >= 60 && (
            <Note icon="alert-triangle" tone={aqData.europeanAqi >= 80 ? 'critico' : 'alto'}>
              Calidad del aire: {aqData.europeanAqi >= 80 ? 'muy mala' : 'mala'}
              {aqData.pm2_5 >= 35 ? ` (PM2,5 ${Math.round(aqData.pm2_5)} µg/m³)` : ''}
            </Note>
          )}

          {/* Daylight, only when it matters for the session: the last hour. The sunset time is always in the header. */}
          {(() => {
            const now = new Date();
            const { sunrise, sunset } = getSunTimes(now, spot.center);
            if (now < sunrise) {
              const toSunrise = Math.floor((sunrise.getTime() - now.getTime()) / 60_000);
              return toSunrise <= 60 ? <Note icon="sun">Amanece en {toSunrise} min ({formatTime(sunrise)})</Note> : null;
            }
            const toSunset = Math.floor((sunset.getTime() - now.getTime()) / 60_000);
            if (toSunset <= 0 || toSunset > 60) return null;
            const hours = Math.floor(toSunset / 60);
            const restMin = toSunset - hours * 60;
            const left = hours === 0 ? `${toSunset} min` : restMin > 0 ? `${hours} h ${restMin} min` : `${hours} h`;
            return (
              <Note icon="sun" tone={toSunset <= 20 ? 'critico' : toSunset <= 60 ? 'alto' : undefined}>
                Quedan {left} de luz: anochece a las {formatTime(sunset)}
              </Note>
            );
          })()}
          </div>
        </FichaGroup>

        {/* Simple mode (11-nov): the card is the verdict, what comes, the place and the cameras. The
            hour table repeats the chart above and the detailed forecast one tap away; windows, how it is
            worked out and the spot's history are for whoever asks for «Avanzado». */}
        {(!simpleMode || (spot.webcams != null && spot.webcams.length > 0)) && (
        <FichaGroup title={simpleMode ? 'En directo' : 'Más'} list>
          {!simpleMode && !isSurf && spotForecast.length > 0 && <ForecastMiniTimeline forecast={spotForecast} folded />}
        {!simpleMode && isSurf && (
          <FoldRow icon="beach" title="Qué le va a esta playa">
          <dl className="gf-data" style={{ borderTop: 0, paddingTop: 0 }}>
            {spot.beachOrientation != null && <Cell label="Playa" value={degreesToCardinal(spot.beachOrientation)} />}
            {spot.tidePreference && (
              <Cell
                label="Marea"
                value={
                  spot.tidePreference === 'all' ? 'Todas' :
                  spot.tidePreference === 'mid-high' ? 'Media-alta' :
                  spot.tidePreference === 'mid' ? 'Media' :
                  spot.tidePreference === 'low' ? 'Baja' : 'Alta'
                }
              />
            )}
            {spot.offshoreWindDir && <Cell label="Offshore" value={spot.offshoreWindDir.map((d) => degreesToCardinal(d)).join('/')} />}
            {spot.swellDirections && <Cell label="Swell" value={spot.swellDirections.map((d) => degreesToCardinal(d)).join('/')} />}
          </dl>
          </FoldRow>
        )}

          {!simpleMode && !isSurf && windowResult && <SailingWindowsSection result={windowResult} />}
          {spot.webcams && spot.webcams.length > 0 && <WebcamSection webcams={spot.webcams} title={simpleMode ? (spot.webcams.length === 1 ? 'Ver la cámara' : 'Ver las cámaras') : undefined} />}
          {!simpleMode && !isSurf && <SpotHistoryChart spotId={spot.id} />}
          {!simpleMode && score && !score.provisional && (
            <FoldRow icon="info" title="Cómo lo sabemos">
              {isSurf ? (
                <Note icon="waves">Las olas salen de un modelo: nadie las mide en la playa.</Note>
              ) : score.wind && (
                <Note icon="wind">
                  {windIsBoosted
                    ? `Las estaciones miden ${score.wind.avgSpeedKt.toFixed(0)} kt; aquí se estiman ${effectiveKt.toFixed(0)}.`
                    : 'Sale de las estaciones cercanas, sin ajuste.'}
                  {gustIsBoosted && score.gustKt != null && ` Racha medida: ${score.gustKt.toFixed(0)} kt.`}
                </Note>
              )}
              {!isSurf && score.wind?.matchedPattern && <Note icon="thermal-wind">Patrón del sitio: {score.wind.matchedPattern}</Note>}
              {spot.thermalDetection && score.regimeVeto?.vetoed && score.regimeVeto.reason && <Note icon="wind">{score.regimeVeto.reason}</Note>}
              {viracion && viracion.confidence !== 'high' && <Note icon="wind">{viracion.description}</Note>}
              {score.humiditySignal && <Note icon="droplets">{score.humiditySignal}</Note>}
              {/* Against the spot's own last 30 days. Sailing spots only. */}
              {!isSurf && score.wind != null && score.wind.avgSpeedKt > 0.5 && (
                <HistoricalBaselineBadge spot={spot} currentKt={score.wind.avgSpeedKt} verdict={verdict} />
              )}
              {isSurf && swanHs !== null && <Note icon="waves">SWAN {dec(swanHs, 2)} m (modelo de alta resolución del CESGA en este punto)</Note>}
              {/* The card says «Agua (modelo)»: which model goes here, for whoever wants it. */}
              {score.waterTemp == null && mohidSeaTemp != null && <Note icon="droplets">Temperatura del agua: modelo MOHID de MeteoGalicia, no una boya.</Note>}
            </FoldRow>
          )}
          {/* What the thermal alert rests on, with its signals: not for a first read, only for someone testing the app. */}
          {alphaMode && precursor && precursor.level !== 'none' && <ThermalPrecursorSection precursor={precursor} />}
        </FichaGroup>
        )}

        {/* What asks something of the reader goes last, and in view. The field report only on wind spots and never
            while provisional: there is no figure to compare yet. shownWindKt is the figure the head really shows. */}
        {!simpleMode && !isSurf && score && !score.provisional && (
          <FichaGroup title="¿Estás aquí ahora?">
            <SpotReportBox spotId={spot.id} shownWindKt={displayWindKt(score)} shownVerdict={renderedVerdict(score)} />
          </FichaGroup>
        )}
        {/* Per-spot opt-in for the lightning pushes, the only thing that ever pushes. Hides itself when the
            browser lacks Web Push (iOS Safari not installed). */}
        <SpotPushOptIn spot={spot} />

        <div className="gf-foot">
          {score && !score.provisional && (
            <ShareButton
              spot={spot}
              score={score}
              verdict={verdict}
              vs={vs}
              surf={isSurf
                ? { label: surfState === 'danger' ? vs.label : (surfInfo?.label ?? null), waveM: surfEntry?.waveHeight ?? null }
                : undefined}
            />
          )}
          {!simpleMode && <SupportLink />}
        </div>
        {/* What has to be there and says nothing on a first read: at the foot, subtle. */}
        {!simpleMode && (
        <p className="gf-credit">
          <span className="gf-tag">{isSurf ? 'surf beta' : 'beta'}</span>
          {[
            !isSurf && score?.wind && !score.provisional ? (score.wind.stationCount === 1 ? '1 estación' : `${score.wind.stationCount} estaciones`) : null,
            score?.computedAt && !staleAge ? timeAgoEs(score.computedAt) : null,
          ].filter(Boolean).join(' · ')}
        </p>
        )}
      </Ficha>
      {shareOpen && score && (
        <ShareSpotModal spot={spot} score={score} onClose={() => setShareOpen(false)} />
      )}
    </>
  );
});

// ── Sailing windows ─────────────────────────────

function SailingWindowsSection({ result }: { result: SpotWindowResult }) {
  const { windows, bestWindow } = result;
  if (windows.length === 0) return null;
  return (
    <FoldRow icon="clock" title="Mejores ventanas" note={`(${windows.length})`}>
      {windows.map((w, i) => (
        <WindowRow key={i} window={w} isBest={bestWindow === w} />
      ))}
    </FoldRow>
  );
}

function WindowRow({ window: w, isBest }: { window: SailingWindow; isBest: boolean }) {
  return (
    <Note icon={isBest ? 'check-circle' : 'clock'} tone={w.verdict === 'good' ? 'ok' : 'moderado'} title={`Puntuación ${w.avgScore}`}>
      <span className={isBest ? 'gf-strong' : undefined}>{w.summary}</span>
      {isBest && <small>La mejor ventana</small>}
    </Note>
  );
}

// ── Thermal precursor early warning ────────────────────────

function ThermalPrecursorSection({ precursor }: { precursor: ThermalPrecursorResult }) {
  const activeSignals = Object.entries(precursor.signals).filter(([, s]) => s.active);
  return (
    <FoldRow icon="thermal-wind" title="Alerta térmica temprana" note={`${precursor.probability} %`}>
      <p className="gf-say" style={{ fontSize: 14, fontWeight: 500 }}>
        {precursor.summary}
        {precursor.eta && ` Ventana: ${precursor.eta}.`}
      </p>
      <div className="gf-hint" style={{ marginBottom: 6 }}>
        Confianza {CONFIDENCE_WORD[precursor.confidence] ?? precursor.confidence}, {activeSignals.length} de {Object.keys(precursor.signals).length} señales
      </div>
      {Object.entries(precursor.signals).map(([key, signal]) => (
        <PrecursorSignalRow key={key} name={SIGNAL_NAMES[key] ?? key} signal={signal} />
      ))}
    </FoldRow>
  );
}

const SIGNAL_NAMES: Record<string, string> = {
  terral: 'Terral matutino',
  deltaTWaterAir: 'ΔT agua-aire',
  solarRamp: 'Radiación solar',
  humidityGradient: 'Gradiente humedad',
  windDivergence: 'Divergencia viento',
  forecastFavorable: 'Previsión favorable',
  skyStateClear: 'Cielo despejado',
};

const CONFIDENCE_WORD: Record<string, string> = { high: 'alta', medium: 'media', low: 'baja' };

function PrecursorSignalRow({ name, signal }: { name: string; signal: { active: boolean; score: number; value: string; weight: number } }) {
  return (
    <div className={`gf-signal${signal.active ? ' on' : ''}`}>
      <i />
      <span>{name}</span>
      <div className="gf-track"><span style={{ width: `${Math.min(100, signal.score)}%` }} /></div>
      <b title={signal.value}>{signal.value}</b>
    </div>
  );
}

// ── Wind trend + sparkline for spots ─────────────────────────


function SpotDrift({ spotId, trend, computedAt, ownLine = false }: { spotId: string; trend: WindTrend | null | undefined; computedAt?: Date | null; ownLine?: boolean }) {
  const history = useSpotStore((s) => s.windHistory.get(spotId));
  const now = useMinuteClock();
  const drift = useMemo(() => {
    const age = ageMinutes(computedAt, now);
    if (age == null || age > TREND_MAX_AGE_MIN) return null;
    return spotWindDrift(trend, (history ?? []).map((p) => ({ t: p.ts, kt: p.kt })), now);
  }, [trend, history, computedAt, now]);
  if (ownLine && drift) return <span className="gf-trendline">viento <TrendMark drift={drift} /></span>;
  return <TrendMark drift={drift} />;
}

// ── Thermal forecast early warning (BETA) ─────────────────────

function ThermalForecastBadge({ forecast }: { forecast: HourlyForecast[] }) {
  const aloft = useAloft();
  const signals = useMemo(() => detectThermalForecast(forecast, aloft), [forecast, aloft]);
  if (signals.length === 0) return null;

  return (
    <>
      {signals.map((s, i) => (
        <Note key={i} icon="sun" tone={s.confidence === 'alta' ? 'ok' : s.confidence === 'media' ? 'riesgo' : undefined}>
          {s.label}<span className="gf-tag">beta</span>
        </Note>
      ))}
    </>
  );
}

// ── Forecast: next 12 hours, one row every 3 ────────────────────

const peakOf = (values: (number | null | undefined)[]): number | null => {
  const known = values.filter((v): v is number => v != null);
  return known.length > 0 ? Math.max(...known) : null;
};

/** Rows of 3 hours, each with the most its stretch reaches: a peak between two rows has to show. */
export function forecastRows(forecast: HourlyForecast[], now: Date): HourlyForecast[] {
  const upcoming = forecast.filter((f) => f.time > now);
  const rows: HourlyForecast[] = [];
  for (let i = 0; i < Math.min(12, upcoming.length); i += 3) { // max 4: the whole forecast is one tap below
    const stretch = upcoming.slice(i, i + 3);
    const strongest = stretch.reduce((a, b) => ((b.windSpeed ?? -1) > (a.windSpeed ?? -1) ? b : a));
    rows.push({
      ...stretch[0],
      windSpeed: strongest.windSpeed,
      windDirection: strongest.windDirection,
      windGusts: peakOf(stretch.map((h) => h.windGusts)),
      precipProbability: peakOf(stretch.map((h) => h.precipProbability)),
    });
  }
  return rows;
}

function ForecastMiniTimeline({ forecast, note, folded = false }: { forecast: HourlyForecast[]; note?: string; folded?: boolean }) {
  const hours = useMemo(() => forecastRows(forecast, new Date()), [forecast]);

  if (hours.length === 0) return null;

  const toKt = (ms: number | null) => (ms == null ? null : Math.round(ms * 1.94384));
  const scale = Math.max(16, ...hours.map((h) => toKt(h.windSpeed) ?? 0));
  const anyRain = hours.some((h) => (h.precipProbability ?? 0) > 30);
  const anyGust = hours.some((h) => h.windGusts != null);

  return (
    <FoldRow icon="clock" title="Próximas horas" note="de 3 en 3 h" defaultOpen={!folded}>
      <table className="gf-table">
        <caption>Lo máximo de cada tramo, en nudos. Previsión.</caption>
        <thead>
          <tr>
            <th scope="col" style={{ width: 38 }}>Hora</th>
            <th scope="col">Viento</th>
            <th scope="col" className="gf-n" style={{ width: 28 }}>kt</th>
            {anyGust && <th scope="col" className="gf-n" style={{ width: 46 }}>Racha</th>}
            <th scope="col" style={{ width: 58, paddingLeft: 8 }}>Del</th>
            <th scope="col" className="gf-n" style={{ width: 30 }}>T</th>
            {anyRain && <th scope="col" className="gf-n" style={{ width: 42 }}>Lluvia</th>}
          </tr>
        </thead>
        <tbody>
          {hours.map((h, i) => {
            const kt = toKt(h.windSpeed);
            const gust = toKt(h.windGusts);
            const dir = h.windDirection;
            const rainPct = h.precipProbability ?? 0;
            return (
              <tr key={i}>
                <td>{h.time.getHours()} h</td>
                <td>{kt != null && kt >= 2 && <span className="gf-bar" style={{ width: `${(kt / scale) * 100}%` }} />}</td>
                <td className="gf-n"><b>{kt ?? '–'}</b></td>
                {anyGust && <td className="gf-n">{gust ?? '–'}</td>}
                <td style={{ paddingLeft: 8 }}>
                  {dir != null ? (
                    <span className="gf-dirs">
                      <span style={{ display: 'inline-block', transform: `rotate(${(dir + 180) % 360}deg)` }} aria-hidden="true">↑</span>
                      {degreesToCardinal(dir)}
                    </span>
                  ) : '–'}
                </td>
                <td className="gf-n">{h.temperature != null ? `${h.temperature.toFixed(0)}°` : '–'}</td>
                {anyRain && <td className="gf-n">{rainPct > 30 ? `${rainPct} %` : ''}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      {note && <div className="gf-hint" style={{ marginTop: 4 }}>{note}</div>}
    </FoldRow>
  );
}

// ── 24h wave forecast ───────────────────────────────────

/** Bars of the wave at the beach for the next 24 h, for surf spots.
 * Reads the hours useSurfMarineData already downloaded, the same entry the verdict comes from, so
 * «ahora» here is the figure printed beside the verdict, not a third download at another hour. Every
 * height is the wave AT THE BEACH (coastal factor × swell alignment, as the verdict) and a model value. */
function WaveForecastMini({ spot, entry }: { spot: SurfSpotShape; entry: SurfWaveEntry | undefined }) {
  if (!entry) {
    return <div className="gf-row gf-row--static">Cargando previsión de olas…</div>;
  }

  // The own API serves 48h: the strip shows from an hour ago to +24h.
  const now = new Date();
  const nowMs = now.getTime();
  const hours = entry.hours.filter((h) => {
    const dt = h.time.getTime() - nowMs;
    return dt >= -3_600_000 && dt <= 24 * 3_600_000 && (h.swellHeight ?? h.waveHeight) != null;
  });
  if (hours.length < 6) return null;

  const beach = hours.map((h) => beachWaveAt(spot, h));
  const maxWave = Math.max(...beach.map((b) => b.height), 0.5);

  // Peak of the coming hours at the beach: the hour «máx … a las» names.
  let peakIdx = -1;
  for (let i = 0; i < hours.length; i++) {
    if (hours[i].time.getTime() < nowMs) continue;
    if (peakIdx < 0 || beach[i].height > beach[peakIdx].height) peakIdx = i;
  }

  const currentWave = entry.waveHeight;
  const maxForecast = peakIdx >= 0 ? beach[peakIdx].height : null;
  const trend = currentWave == null || maxForecast == null
    ? null
    : maxForecast > currentWave + 0.3 ? 'subiendo' : maxForecast < currentWave - 0.3 ? 'bajando' : 'estables';
  const peakTime = peakIdx >= 0
    ? hours[peakIdx].time.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    : null;
  // The strip reaches +24 h, so the peak can be tomorrow's: «a las 08:00» read at 13:00 was tomorrow
  // morning and did not say so. And a peak that prints the same as now adds nothing.
  const peakPart = currentWave != null && maxForecast != null && peakTime
    && formatSurfWave(maxForecast) !== formatSurfWave(currentWave)
    ? ` → máx ${formatSurfWave(maxForecast)}${hours[peakIdx].time.toDateString() !== now.toDateString() ? ' mañana' : ''} a las ${peakTime}`
    : '';
  const avgPeriod = beach.reduce((sum, b) => sum + b.period, 0) / beach.length;
  const periodQuality = avgPeriod >= 10 ? 'largo (buena calidad)' : avgPeriod >= 7 ? 'medio' : 'corto (mar de viento)';

  return (
    <div className="gf-sec">
      <div className="gf-sectitle">
        <h4>Olas 24 h <small>(modelo)</small></h4>
        <small>Periodo {periodQuality}</small>
      </div>
      <div className="flex items-end" style={{ gap: 1, height: 34, marginBottom: 3 }} title="Altura de ola en la playa por hora (modelo)">
        {hours.map((h, i) => {
          const b = beach[i];
          const isPast = h.time < now;
          return (
            <div
              key={i}
              className="flex-1"
              style={{
                height: `${Math.max(4, (b.height / maxWave) * 100)}%`,
                background: isPast ? 'var(--g-hair)' : 'var(--g-surf)',
                outline: i === peakIdx ? '1px solid var(--g-ink)' : undefined,
              }}
              title={`${h.time.getHours()} h: ${formatSurfWave(b.height)} en la playa${b.period > 0 ? `, periodo ${b.period.toFixed(0)} s` : ''} (modelo)`}
            />
          );
        })}
      </div>
      <div className="flex justify-between gf-hint" style={{ marginBottom: 4 }}>
        {hours.filter((_, i) => i % 6 === 0).map((h, i) => (
          <span key={i}>{h.time.getHours()} h</span>
        ))}
      </div>
      {trend && currentWave != null && (
        <div style={{ fontSize: 13.5 }}>
          Olas {trend}: {formatSurfWave(currentWave)} ahora{peakPart}
        </div>
      )}
    </div>
  );
}

// ── Temperatures: the main ones visible, the rest under «Más datos» ──

function TemperatureSection({ score, mohidSeaTemp, marineSST }: { score: SpotScore; mohidSeaTemp?: number | null; marineSST?: number | null }) {
  const [showMore, setShowMore] = useState(false);
  const simpleMode = useUIStore((s) => s.simpleMode);
  const hasSecondary = !simpleMode && (score.humidity != null || score.dewPoint != null || score.windChill != null || score.heatIndex != null);
  const waterTemp = score.waterTemp ?? mohidSeaTemp ?? marineSST;
  const waterLabel = score.waterTemp != null ? 'Agua' : 'Agua (modelo)';

  return (
    <>
      <dl className="gf-data">
        {score.airTemp != null && <Cell label="Aire" value={`${dec(score.airTemp)} °C`} />}
        {waterTemp != null && (
          <Cell label={waterLabel}>
            {dec(waterTemp)} °C <small>{waterTempLabel(waterTemp)}</small>
          </Cell>
        )}
        {showMore && hasSecondary && score.humidity != null && <Cell label="Humedad" value={`${score.humidity.toFixed(0)} %`} />}
        {showMore && hasSecondary && score.dewPoint != null && <Cell label="Punto de rocío" value={`${dec(score.dewPoint)} °C`} />}
        {showMore && hasSecondary && score.windChill != null && <Cell label="Sensación térmica" value={`${dec(score.windChill)} °C`} />}
        {/* Heat above 32 is a warning, in either mode; below that it is one more figure */}
        {score.heatIndex != null && (score.heatIndex > 32 || (showMore && hasSecondary)) && <Cell label="Índice de calor" value={`${dec(score.heatIndex)} °C`} warn={score.heatIndex > 32} />}
      </dl>
      {hasSecondary && (
        <button type="button" className="gf-more" onClick={() => setShowMore((o) => !o)} aria-expanded={showMore}>
          {showMore ? 'Menos datos' : 'Más datos'}
        </button>
      )}
    </>
  );
}

// ── Share button: Web Share API with clipboard fallback ──────────

function ShareButton({ spot, score, verdict: _verdict, vs, surf }: {
  spot: SailingSpot;
  score?: SpotScore;
  verdict: SpotVerdict;
  vs: typeof VERDICT_STYLE[SpotVerdict];
  /** Surf spots: the text says what the card says, the surf verdict (null = not ready, no verdict stated)
   *  and the MODEL wave at the beach, never the wind verdict with a tide gauge's «olas 0.0m». */
  surf?: { label: string | null; waveM: number | null };
}) {
  const [copied, setCopied] = useState(false);
  const sectorId = useSectorStore((s) => s.activeSector.id);

  const isSurf = surf !== undefined;
  const surfLabel = surf?.label ?? null;
  const surfWaveM = surf?.waveM ?? null;
  const shareText = useMemo(() => {
    // Closed by the sea, the text says what the card heads with, the sea; not the wind verdict with its
    // knots (the «FUERTE · 8 kt» already fixed on the marker, review 18-nov).
    const sea = isSurf ? null : gateWaveText(score);
    const parts = [isSurf ? (surfLabel ? `${spot.name}: ${surfLabel}` : spot.name) : sea ? `${spot.name}: Oleaje · ${sea}` : `${spot.name}: ${vs.label}`];
    if (score?.wind && !sea) {
      parts.push(`${(score.effectiveWindKt ?? score.wind.avgSpeedKt).toFixed(0)} kt ${displayWindDir(score)?.label ?? ''}`.trim());
    }
    if (score?.airTemp != null) {
      parts.push(`${score.airTemp.toFixed(0)}°C`);
    }
    if (isSurf) {
      if (surfWaveM != null) parts.push(`olas ${formatSurfWave(surfWaveM)} (modelo)`);
    } else if (score?.waves?.waveHeight != null) {
      parts.push(`olas ${score.waves.waveHeight.toFixed(1).replace('.', ',')} m`);
    }
    parts.push('— MeteoMapGal');
    return parts.join(' | ');
  }, [spot.name, vs.label, score, isSurf, surfLabel, surfWaveM]);

  // A demo link (?simstrike, ?simorange...) must not leave the app as a real report.
  if (isSimulationActive()) return null;

  const handleShare = async () => {
    // Deep-link: useDeepLink reabre este spot en este sector al recibir el enlace
    const shareData = {
      title: `${spot.name} — MeteoMapGal`,
      text: shareText,
      url: buildShareUrl({ sectorId: sectorId === 'rias' ? 'rias' : 'embalse', spotId: spot.id }),
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {
        // User cancelled: not an error
      }
    } else {
      // Fallback: copy to clipboard
      try {
        await navigator.clipboard.writeText(`${shareText}\n${shareData.url}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Clipboard failed silently
      }
    }
  };

  return (
    <button type="button" onClick={handleShare} className="gc-btn gc-btn--plain" title="Compartir condiciones">
      <WeatherIcon id="navigation" size={14} />
      <span role="status">{copied ? 'Copiado' : 'Compartir'}</span>
    </button>
  );
}

/**
 * «Hoy frente a la media»: current wind against the 30-day baseline of the spot's reference station.
 * Skips when the spot has no preferred station, the baseline has <24 h of samples, or the wind is
 * within ±25 % of average. Data cached process-wide for 1 h.
 */
function HistoricalBaselineBadge({ spot, currentKt, verdict }: { spot: SailingSpot; currentKt: number; verdict: SpotVerdict }) {
  // The first preferred station is the stable anchor (`spots.ts` config), not subject to discovery churn.
  const refStation = spot.preferredStations[0];
  const { baseline } = useHistoricalBaseline(refStation, 'wind', 30);

  if (!baseline) return null;

  const insight = describeVsBaseline(currentKt, baseline, 'kt', 'últimos 30 días');
  if (!insight) return null;

  // Don't celebrate an above-average wind next to a poor verdict: at low-wind spots (Liméns, media 4 kt)
  // a 7 kt day is «top 10 %» yet still FLOJO, which reads contradictory. Only when the wind is usable;
  // the one exception is the below-average case, which coheres with FLOJO.
  const windUsable = verdict === 'sailing' || verdict === 'good' || verdict === 'strong';
  if (!windUsable && insight.severity !== 'low') return null;

  return (
    <Note
      icon="info"
      tone={insight.severity === 'rare' || insight.severity === 'high' ? 'ok' : insight.severity === 'low' ? 'riesgo' : undefined}
      title={`Referencia: ${refStation} · p75 ${baseline.p75} kt · p90 ${baseline.p90} kt · ${baseline.hoursSampled} h muestreadas`}
    >
      {insight.phrase}
    </Note>
  );
}
