/**
 * «Lloviendo ahora»: radar rain the gauges did not deny, the gauges that measured it, and where
 * each patch of rain is heading. Reactive:
 *  - on a dry day it only looks at the newest radar frame (a few KB every 5 min, with the tab
 *    visible; the radar itself changes every 10);
 *  - when a gauge of the sector measures rain, or the radar shows echo within reach, it fetches
 *    the last hour and a half and follows every patch on its own (services/radarTracking.ts):
 *    rain that MOVES steadily towards the sector is shown before it arrives, with its arrow;
 *    echo that stays put (fixed echoes) is neither drawn nor announced;
 *  - every «llega a X» is checked against the gauges near X (services/rainArrivalChecks.ts).
 * The user can hide it for the day from the toolbar chip. The rules, and the numbers behind them,
 * are in services/rainNowService.ts.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Source, Layer, useMap, type SourceProps } from 'react-map-gl/maplibre';
import { useWeatherStore } from '../../store/weatherStore';
import { useWeatherLayerStore } from '../../store/weatherLayerStore';
import { useSectorStore } from '../../store/sectorStore';
import { resolveStyleId, useMapStyleStore } from '../../store/mapStyleStore';
import { useThemeStore } from '../../store/themeStore';
import { useUIStore } from '../../store/uiStore';
import { useRainNowStore, type RainNowDebug } from '../../store/rainNowStore';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';
import { fetchRadarFrames, FRAMES_WANTED } from '../../api/radarTiles';
import { getSpotsForSector } from '../../config/spots';
import { kmPerPx, mosaicCorners, type RadarMosaic } from '../../services/radarDecode';
import { estimateMotion, type RadarMotion } from '../../services/radarMotion';
import { pixelsByLabel, trackCells, type CellTrack } from '../../services/radarTracking';
import {
  announcingTracks, approachingCells, classifyGauges, drawableCells, echoWorthFollowing, findRainCells, gaugeIntensity, gaugeWetNow, groundTruth, leadingEdge,
  rainArrivalAt, rainTrajectories, renderPastRain, renderRain, ARRIVAL_MAX_MIN, type GaugeRain, type RainApproach,
} from '../../services/rainNowService';
import { updateArrivalChecks } from '../../services/rainArrivalChecks';
import { simGauges, simRainFrames, simRainMode } from '../../services/rainSim';
import { precipSamplesFromHistory, withServerPrecip } from '../../services/precipSemantics';
import { fetchRecentPrecip } from '../../api/recentPrecipClient';
import type { NormalizedReading } from '../../types/station';

/** RainViewer adds a frame every ~10 min; asking every 3 shows it within a few minutes of it existing.
 *  A look with no new frame costs one small JSON (the decoded frames are kept). */
const POLL_MS = 3 * 60_000;
const TONE_COLOR = { debil: '#60a5fa', moderada: '#2563eb', fuerte: '#7c3aed' } as const;
/** Arrows of rain coming to the sector drawn at most (the soonest), so the map does not fill with them. */
const MAX_ARROWS = 3;

/**
 * The radar picture goes to MapLibre as a CANVAS source, never as an image URL. MapLibre fetches an
 * image source's URL, and the production policy has no data: (nor blob:) in connect-src, so the
 * data: URL this used was blocked and the rain never drew in production (6-oct; dev has no policy,
 * so it looked fine). A canvas source reads the pixels directly: no request at all.
 */
/** How many canvas pixels each radar cell gets at most (see the blur where the picture is made). */
const RADAR_UPSCALE = 4;

/**
 * The loop of the last minutes: the two frames before the newest, then the newest held. Three
 * pictures to start with (20 min); desktop only until it is measured on a phone.
 */
const LOOP_PAST_FRAMES = 2;
const LOOP_STEP_MS = 700;
const LOOP_HOLD_NOW_MS = 3200;
/** The past frames are context, not the reading: half the pixels of the newest picture. */
const LOOP_UPSCALE = 2;
/** How far a patch may have come from between two frames when the radar gave no speed, km/h. */
const LOOP_DEFAULT_KMH = 50;
/**
 * The loop says where the rain goes in a few turns; past them, to someone who stays looking, it only
 * moves, and watched for long it gets tiresome (18-nov). It rests on the newest picture
 * and starts again when the map is moved or a new radar picture arrives.
 */
const LOOP_MAX_TURNS = 4;
/** The rain one notch under full: at 1 it weighed more than the map under it (18-nov). */
const RAIN_OPACITY = 0.85;
const PULSE_EVERY_MS = 2200;
/** The ring of a gauge measuring rain now while nothing moves (reduced motion, or between beats). */
const PULSE_REST_RADIUS = 9;
const PULSE_REST_OPACITY = 0.5;

/** The rain picture on a canvas `up` times larger, through a soft blur (see where the newest is made). */
function softCanvas(rgba: Uint8ClampedArray<ArrayBuffer>, w: number, h: number, up: number): HTMLCanvasElement | null {
  const small = document.createElement('canvas');
  small.width = w; small.height = h;
  const smallCtx = small.getContext('2d');
  const canvas = document.createElement('canvas');
  canvas.width = w * up; canvas.height = h * up;
  const ctx = canvas.getContext('2d');
  if (!ctx || !smallCtx) return null;
  smallCtx.putImageData(new ImageData(rgba, w, h), 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.filter = `blur(${up * 0.6}px)`;
  ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Nobody is looking: hidden tab, or the idle pause (idleAnimations.ts). */
function pageAtRest(): boolean {
  return typeof document !== 'undefined' && (document.hidden || document.documentElement.hasAttribute('data-idle'));
}

interface Picture { canvas: HTMLCanvasElement; corners: [[number, number], [number, number], [number, number], [number, number]]; id: number }
let pictureSeq = 0;

function canvasSource(p: Picture): SourceProps {
  // Runtime-only source type: not in the style spec union that SourceProps is built from.
  return { type: 'canvas', canvas: p.canvas, coordinates: p.corners, animate: false } as unknown as SourceProps;
}

export const RainNowOverlay = memo(function RainNowOverlay() {
  // One radar picture at a time: with the raw radar layer on (drawn on top, 75 %), ours sat under it
  // and looked gone (6-oct). Gauges, arrows and the chip stay.
  const rawRadarOn = useWeatherLayerStore((s) => s.activeLayer === 'radar');
  const sector = useSectorStore((s) => s.activeSector);
  // The arrows are part of the rain layer, so they take the rain's own blue: the near-white one of before
  // stood out of the map more than the rain it explains (18-nov). On the dark canvas the old dark
  // blue all but disappeared, hence a light blue there.
  const styleChoice = useMapStyleStore((s) => s.activeStyleId);
  const theme = useThemeStore((s) => s.theme);
  const mapDark = resolveStyleId(styleChoice, theme) === 'dark';
  const arrowColor = mapDark ? '#93bdf2' : '#1e4fa8';
  const arrowHalo = mapDark ? '#0b1220' : '#ffffff';
  const stations = useWeatherStore((s) => s.stations);
  const readingsEpoch = useWeatherStore((s) => s.readingsEpoch);
  const historyEpoch = useWeatherStore((s) => s.historyEpoch);
  const dismissed = useRainNowStore((s) => s.dismissedToday);
  const setSummary = useRainNowStore((s) => s.setSummary);
  const setChecks = useRainNowStore((s) => s.setChecks);
  const setDebug = useRainNowStore((s) => s.setDebug);
  const simMode = useMemo(simRainMode, []);
  const sim = simMode !== null;
  const centre = useMemo(() => ({ lon: sector.center[0], lat: sector.center[1] }), [sector.center]);
  const centreRef = useRef(centre);
  centreRef.current = centre;

  // 0. The server's last 75 min of precipitation, so a page that just opened judges the gauges like
  //    one open for an hour (20-oct: 1 wet gauge against ~20, and more weak echo drawn for lack of
  //    dry gauges to veto it). Refreshed with every radar look.
  const [serverPrecip, setServerPrecip] = useState<Map<string, NormalizedReading[]>>(() => new Map());
  const loadServerPrecip = async () => {
    const m = await fetchRecentPrecip();
    if (m.size > 0) setServerPrecip(m);
  };
  const gaugeHistory = () => withServerPrecip(useWeatherStore.getState().readingHistory, serverPrecip);

  // 1. Gauges alone, cheap and offline.
  const gaugesNoRadar = useMemo(() => {
    const { currentReadings } = useWeatherStore.getState();
    return classifyGauges({ stations, readings: currentReadings, history: gaugeHistory(), nowMs: Date.now() });
    // epochs stand for the readings and the history, read through getState above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stations, readingsEpoch, historyEpoch, serverPrecip]);
  const gaugeRain = gaugesNoRadar.some((g) => g.verdict === 'rain' || (g.official && g.verdict === 'alone'));
  const gaugeRainRef = useRef(gaugeRain);
  gaugeRainRef.current = gaugeRain;

  // 2. Radar: the newest frame always; the history only with something to follow.
  const [radar, setRadar] = useState<{ frames: RadarMosaic[]; newestAgeMin: number } | null>(null);
  const look = async () => {
    if (!sim) void loadServerPrecip();
    try {
      const newest = await fetchRadarFrames(undefined, 1);
      if (!newest) { setRadar(null); return; }
      const follow = gaugeRainRef.current || echoWorthFollowing(newest.frames[0], centreRef.current);
      setRadar(follow ? (await fetchRadarFrames(undefined, FRAMES_WANTED)) ?? newest : newest);
    } catch {
      setRadar(null);
    }
  };
  useVisibilityPolling(look, POLL_MS, !dismissed && !sim);
  // A gauge that starts measuring rain between two looks fetches the history now, not in 5 min.
  useEffect(() => {
    if (gaugeRain && !dismissed && !sim && (radar?.frames.length ?? 0) < 2) void look();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gaugeRain]);
  useEffect(() => { if (dismissed) setRadar(null); }, [dismissed]);

  const frames = useMemo(() => {
    if (simMode) return simRainFrames(centre, Math.floor(Date.now() / 1000), simMode);
    return radar?.frames ?? null;
  }, [simMode, radar, centre]);
  const newest = frames?.[frames.length - 1] ?? null;

  // 3. Cells, the motion of the whole picture and each cell's own track: once per frame set.
  const analysisRef = useRef<{ key: string; motion: RadarMotion | null; cells: ReturnType<typeof findRainCells>; tracks: Map<number, CellTrack> | null; byLabel: Map<number, number[]> | null } | null>(null);
  // The last radar picture and what it was drawn from. A new canvas is a new source, and MapLibre does not
  // free the texture of the source it drops: rebuild it only when the frame or the drawn cells change, not
  // on every batch of readings (15-oct, memory audit).
  const pictureRef = useRef<{ key: string; picture: Picture } | null>(null);
  const analysis = useMemo(() => {
    if (!frames || !newest) return null;
    const key = `${newest.t}:${frames.length}:${simMode ?? ''}`;
    if (analysisRef.current?.key === key) return analysisRef.current;
    const found = findRainCells(newest);
    const history = frames.length >= 4;
    const motion = history ? estimateMotion(frames) : null;
    const byLabel = history ? pixelsByLabel(found.labels) : null;
    const tracks = byLabel ? trackCells(frames, found.cells.map((c) => c.id), (id) => byLabel.get(id) ?? [], motion) : null;
    analysisRef.current = { key, motion, cells: found, tracks, byLabel };
    return analysisRef.current;
  }, [frames, newest, simMode]);
  const motion = analysis?.motion ?? null;

  // 4. Everything that depends on the newest frame and the gauges.
  const view = useMemo(() => {
    if (dismissed && !sim) return null;
    let gauges: GaugeRain[];
    if (sim && newest) gauges = simGauges(stations, newest);
    else {
      const { currentReadings } = useWeatherStore.getState();
      gauges = classifyGauges({ stations, readings: currentReadings, history: gaugeHistory(), nowMs: Date.now(), radar: frames });
    }
    const raining = gauges.filter((g) => g.verdict === 'rain').sort((a, b) => b.mmPerHour - a.mmPerHour);

    let picture: Picture | null = null;
    let past: { key: string; labels: Int32Array; draw: Set<number> } | null = null;
    let arrivals: { spotId: string; spotName: string; etaMin: number; distanceKm: number }[] = [];
    let approach: RainApproach[] = [];
    let cellsShown = 0;
    let arrows: GeoJSON.Feature[] = [];
    let debug: RainNowDebug | null = null;
    if (newest && analysis) {
      const { cells, labels } = analysis.cells;
      const judged = groundTruth(cells, labels, newest, gauges);
      approach = approachingCells(judged, analysis.tracks, newest, centre, sector.radiusKm);
      const draw = drawableCells(judged, centre, { coming: new Set(approach.map((a) => a.cellId)), tracks: analysis.tracks });
      approach = approach.filter((a) => draw.has(a.cellId));
      cellsShown = draw.size;
      const announcing = announcingTracks(judged, analysis.tracks);
      for (const spot of getSpotsForSector(sector.id)) {
        const a = rainArrivalAt({ lon: spot.center[0], lat: spot.center[1] }, newest, labels, draw, announcing);
        if (a && a.etaMin <= ARRIVAL_MAX_MIN) arrivals.push({ spotId: spot.id, spotName: spot.shortName, etaMin: a.etaMin, distanceKm: a.distanceKm });
      }
      arrivals = arrivals.sort((p, q) => p.etaMin - q.etaMin);
      debug = {
        at: new Date(newest.t * 1000).toISOString(),
        frames: frames?.length ?? 0,
        motion: motion ? { kmh: Math.round(motion.kmh), toDeg: Math.round(motion.toDeg), stable: motion.stable } : null,
        cells: judged.filter((c) => c.pixels >= 15).map((c) => {
          const t = analysis.tracks?.get(c.id);
          return {
            lat: +c.lat.toFixed(3), lon: +c.lon.toFixed(3), px: c.pixels, dbz: c.maxDbz, ground: c.ground,
            kind: t?.kind ?? 'none', kmh: Math.round(t?.kmh ?? 0), toDeg: Math.round(t?.toDeg ?? 0), steady: !!t?.steady,
            growth: t?.growthDbz ?? null, drawn: draw.has(c.id),
          };
        }),
      };
      // Nothing measured on the ground, nothing over a spot and nothing coming: the layer stays off.
      if (raining.length === 0 && approach.length === 0 && arrivals.length === 0 && !sim) {
        return { off: true as const, gauges, arrivals, debug };
      }
      const pictureKey = `${newest.t}:${newest.w}x${newest.h}:${[...draw].sort((p, q) => p - q).join(',')}`;
      if (pictureRef.current?.key === pictureKey) {
        picture = pictureRef.current.picture;
      } else {
        const rgba = renderRain(newest, labels, draw);
        // The radar cell is about 1 km: drawn as it comes, the map filled with square blocks. The
        // picture goes to a canvas four times larger through a soft blur, so a patch of rain has
        // a rounded edge and one intensity melts into the next. Less than a cell is added around.
        const up = Math.max(1, Math.min(RADAR_UPSCALE, Math.floor(4096 / Math.max(newest.w, newest.h))));
        const canvas = softCanvas(rgba, newest.w, newest.h, up);
        if (canvas) {
          picture = { canvas, corners: mosaicCorners(newest), id: ++pictureSeq };
          pictureRef.current = { key: pictureKey, picture };
        }
      }
      past = { key: pictureKey, labels, draw };
      // Every arrow sits on the front of its patch: it starts a few km inside the rain and sticks out a
      // little ahead (18-nov: from the front to where the front would be in half an hour, the
      // arrows lay whole over dry ground and read as stray lines). Not from the centre either: the centre of
      // a 150 km band put the arrow across the map (9-nov). The strongest one is rain coming to the
      // sector; the others say where each big patch is going, see rainTrajectories.
      const arrowOf = (a: { cellId: number; lon: number; lat: number; toDeg: number; kmh: number }, kind: ArrowKind, label?: string) => {
        const edge = leadingEdge(newest, analysis.byLabel?.get(a.cellId) ?? [], a.lon, a.lat, a.toDeg);
        return arrowGeo(edge, Math.min(ARROW_INSIDE_KM, kmBetween(edge, a)), arrowOverhangKm(a.kmh), a.toDeg, kind, label).features;
      };
      const coming = approach.slice(0, MAX_ARROWS);
      arrows = [
        // Only rain with a computed arrival at the sector carries its hour; a patch that just moves does not.
        ...coming.flatMap((a) => arrowOf(a, 'coming', arrivalClock(Date.now(), a.etaMin))),
        ...rainTrajectories(judged, analysis.tracks, draw, motion, centre, new Set(coming.map((a) => a.cellId)))
          .flatMap((t) => arrowOf(t, t.own ? 'own' : 'flow')),
      ];
    } else if (raining.length === 0 && !sim) {
      return { off: true as const, gauges, arrivals, debug };
    }
    // A gauge whose last reading carries rain is measuring it now; the others had it within the half hour.
    const wetNow = (g: GaugeRain): boolean => {
      if (sim) return true;
      const { currentReadings } = useWeatherStore.getState();
      return gaugeWetNow(g.id, precipSamplesFromHistory(gaugeHistory().get(g.id), currentReadings.get(g.id)), Date.now());
    };
    const gaugeGeo: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: raining.map((g) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [g.lon, g.lat] },
        properties: { color: TONE_COLOR[gaugeIntensity(g.mmPerHour)], label: g.mmPerHour.toFixed(1).replace('.', ','), fresh: wetNow(g) ? 1 : 0 },
      })),
    };
    return {
      off: false as const, gauges, picture, past, gaugeGeo, cellsShown, arrivals, approach, debug,
      anyFresh: gaugeGeo.features.some((f) => f.properties?.fresh === 1),
      arrowGeo: arrows.length ? ({ type: 'FeatureCollection', features: arrows } as GeoJSON.FeatureCollection) : null,
      raining: raining.map((g) => ({ id: g.id, name: g.name, mm: g.mm, mmPerHour: g.mmPerHour, radarDbz: g.radarDbz })),
    };
    // newest/frames/analysis change together with the frame set
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismissed, sim, analysis, stations, readingsEpoch, historyEpoch, serverPrecip, sector.id, sector.radiusKm, centre]);

  // 5. The summary for the chip, and the check of what was announced.
  useEffect(() => {
    if (!view) { setSummary(null); return; }
    const spots = getSpotsForSector(sector.id).map((s) => ({ id: s.id, lon: s.center[0], lat: s.center[1] }));
    const prev = useRainNowStore.getState().checks;
    setChecks(updateArrivalChecks(prev, { nowMs: Date.now(), arrivals: view.arrivals, gauges: view.gauges, spots }));
    setDebug(view.debug);
    if (view.off) { setSummary(null); return; }
    setSummary({
      gauges: view.raining,
      arrivals: view.arrivals,
      approaching: view.approach.map((a) => ({ fromDeg: a.fromDeg, distanceKm: a.distanceKm, kmh: a.kmh, toDeg: a.toDeg, etaMin: a.etaMin })),
      motion: motion?.stable ? { kmh: motion.kmh, toDeg: motion.toDeg } : null,
      radarAgeMin: sim ? 5 : radar?.newestAgeMin ?? null,
      cells: view.cellsShown,
      sim,
    });
  }, [view, motion, radar, sim, sector.id, setSummary, setChecks, setDebug]);
  useEffect(() => () => setSummary(null), [setSummary]);

  // 6. The loop of the last minutes and the beat of the gauges: both through the map's own paint
  //    properties from a slow timer, never through React state.
  const { current: mapRef } = useMap();
  const isMobile = useUIStore((s) => s.isMobile);
  const [stillAsked, setStillAsked] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : undefined;
    if (!mq?.addEventListener) return;
    const onChange = () => setStillAsked(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const shown = view && !view.off ? view : null;
  const picture = shown?.picture ?? null;
  const pastInput = shown?.past ?? null;
  const loopOn = !!picture && !!pastInput && !rawRadarOn && !isMobile && !stillAsked && !!newest && (frames?.length ?? 0) > LOOP_PAST_FRAMES;
  // One canvas for the whole loop, redrawn and uploaded again at each step: a new canvas source per
  // frame would leave a texture behind every time (see pictureRef).
  const loop = useMemo(() => {
    if (!loopOn || !newest) return null;
    const canvas = document.createElement('canvas');
    canvas.width = newest.w * LOOP_UPSCALE; canvas.height = newest.h * LOOP_UPSCALE;
    if (!canvas.getContext('2d')) return null;
    const id = `rain-now-loop-${newest.x0}-${newest.y0}-${newest.w}x${newest.h}`;
    return { canvas, id, corners: mosaicCorners(newest) };
    // the block of tiles is what the canvas depends on, not the frame
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopOn, newest?.w, newest?.h, newest?.x0, newest?.y0]);
  const pastRef = useRef<{ key: string; pics: HTMLCanvasElement[] } | null>(null);

  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map || !loop || !picture || !pastInput || !frames || !newest) return;
    const nowLayer = `rain-now-radar-${picture.id}`;
    const earlier = frames.slice(-1 - LOOP_PAST_FRAMES, -1);
    const pastKey = `${pastInput.key}|${earlier.map((f) => f.t).join(',')}`;
    if (pastRef.current?.key !== pastKey) {
      const kmh = Math.min(90, Math.max(30, motion?.kmh ?? LOOP_DEFAULT_KMH));
      const kmPx = kmPerPx(newest, centre.lat);
      const made: HTMLCanvasElement[] = [];
      for (const f of earlier) {
        const reach = Math.ceil((kmh * ((newest.t - f.t) / 3600)) / kmPx) + 3;
        const c = softCanvas(renderPastRain(f, newest, pastInput.labels, pastInput.draw, reach), newest.w, newest.h, LOOP_UPSCALE);
        if (c) made.push(c);
      }
      pastRef.current = { key: pastKey, pics: made };
    }
    const pics = pastRef.current.pics;
    if (pics.length === 0) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let uploadTimer: ReturnType<typeof setTimeout> | undefined;
    let dragging = false;
    let step = pics.length; // starts on the newest picture
    const setOpacity = (layer: string, value: number) => {
      try { if (map.getLayer(layer)) map.setPaintProperty(layer, 'raster-opacity', value); } catch { /* style reloading */ }
    };
    const showNow = () => { setOpacity(loop.id, 0); setOpacity(nowLayer, RAIN_OPACITY); };
    let turns = 0;
    let resting = false;
    const tick = () => {
      if (pageAtRest() || dragging || !map.getLayer(loop.id) || !map.getLayer(nowLayer)) {
        showNow();
        step = pics.length;
        timer = setTimeout(tick, 1500);
        return;
      }
      if (step === pics.length && turns >= LOOP_MAX_TURNS) {
        // Enough turns: hold the newest picture until the map moves
        showNow();
        resting = true;
        return;
      }
      step = (step + 1) % (pics.length + 1);
      if (step < pics.length) {
        const ctx = loop.canvas.getContext('2d');
        const source = map.getSource(loop.id) as unknown as { play?: () => void; pause?: () => void } | undefined;
        if (ctx && source?.play && source.pause) {
          ctx.clearRect(0, 0, loop.canvas.width, loop.canvas.height);
          ctx.drawImage(pics[step], 0, 0);
          // A canvas source uploads its pixels only while it «plays»: a moment is enough.
          source.play();
          clearTimeout(uploadTimer);
          uploadTimer = setTimeout(() => source.pause?.(), 250);
          setOpacity(loop.id, RAIN_OPACITY);
          setOpacity(nowLayer, 0);
        }
        timer = setTimeout(tick, LOOP_STEP_MS);
      } else {
        turns++;
        showNow();
        timer = setTimeout(tick, LOOP_HOLD_NOW_MS);
      }
    };
    const onMoveStart = () => { dragging = true; showNow(); };
    const onMoveEnd = () => {
      dragging = false;
      // Looking somewhere else: the loop has something new to show there
      if (resting) {
        resting = false;
        turns = 0;
        step = pics.length;
        clearTimeout(timer);
        timer = setTimeout(tick, LOOP_HOLD_NOW_MS);
      }
    };
    map.on('movestart', onMoveStart);
    map.on('moveend', onMoveEnd);
    timer = setTimeout(tick, LOOP_HOLD_NOW_MS);
    return () => {
      clearTimeout(timer);
      clearTimeout(uploadTimer);
      map.off('movestart', onMoveStart);
      map.off('moveend', onMoveEnd);
      try { (map.getSource(loop.id) as unknown as { pause?: () => void } | undefined)?.pause?.(); } catch { /* map gone */ }
      showNow();
    };
    // frames, newest, motion and centre come with the picture
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRef, loop, picture, pastInput]);

  const anyFresh = !!shown?.anyFresh;
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map || !anyFresh || stillAsked) return;
    const LAYER = 'rain-now-gauges-pulse';
    let timer: ReturnType<typeof setTimeout> | undefined;
    let grow: ReturnType<typeof setTimeout> | undefined;
    const set = (duration: number, radius: number, opacity: number) => {
      try {
        if (!map.getLayer(LAYER)) return;
        map.setPaintProperty(LAYER, 'circle-radius-transition', { duration, delay: 0 });
        map.setPaintProperty(LAYER, 'circle-stroke-opacity-transition', { duration, delay: 0 });
        map.setPaintProperty(LAYER, 'circle-radius', radius);
        map.setPaintProperty(LAYER, 'circle-stroke-opacity', opacity);
      } catch { /* style reloading */ }
    };
    const beat = () => {
      if (!pageAtRest()) {
        set(0, 6, 0.75);
        grow = setTimeout(() => set(1500, 17, 0), 60);
      }
      timer = setTimeout(beat, PULSE_EVERY_MS);
    };
    timer = setTimeout(beat, 400);
    return () => {
      clearTimeout(timer);
      clearTimeout(grow);
      set(0, PULSE_REST_RADIUS, PULSE_REST_OPACITY);
    };
  }, [mapRef, anyFresh, stillAsked]);

  if (!view || view.off) return null;
  const under = view.arrowGeo ? 'rain-now-arrow-halo' : 'rain-now-gauges-pulse';
  return (
    <>
      {view.arrowGeo && (
        <Source id="rain-now-arrow" type="geojson" data={view.arrowGeo}>
          {/* A soft edge of the opposite tone under shaft and head: over the blue of the rain the arrow was lost. */}
          <Layer id="rain-now-arrow-halo" type="line" filter={['!=', ['get', 'part'], 'eta']} layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': arrowHalo, 'line-width': ['match', ['get', 'kind'], 'coming', 4.5, 'own', 4, 3.4], 'line-opacity': 0.3, 'line-blur': 1 }} />
          <Layer id="rain-now-arrow-line" type="line" filter={['==', ['get', 'part'], 'shaft']}
            layout={{ 'line-cap': 'round' }}
            paint={{ 'line-color': arrowColor, 'line-width': ['match', ['get', 'kind'], 'coming', 2.2, 'own', 1.8, 1.5], 'line-opacity': ['match', ['get', 'kind'], 'coming', 0.9, 'own', 0.8, 0.7] }} />
          <Layer id="rain-now-arrow-head" type="line" filter={['==', ['get', 'part'], 'head']}
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': arrowColor, 'line-width': ['match', ['get', 'kind'], 'coming', 2.6, 'own', 2.2, 1.8], 'line-opacity': ['match', ['get', 'kind'], 'coming', 0.9, 'own', 0.8, 0.7] }} />
          {/* When the rain coming to the sector gets there, at the tip of its arrow. */}
          <Layer id="rain-now-arrow-eta" type="symbol" filter={['==', ['get', 'part'], 'eta']}
            layout={{ 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-anchor': 'bottom', 'text-offset': [0, -0.7], 'text-allow-overlap': true, 'text-ignore-placement': true }}
            paint={{ 'text-color': arrowColor, 'text-halo-color': arrowHalo, 'text-halo-width': 1.4 }} />
        </Source>
      )}
      <Source id="rain-now-gauges" type="geojson" data={view.gaugeGeo}>
        {/* A ring that beats around the gauges measuring rain right now (animated from the effect above). */}
        <Layer id="rain-now-gauges-pulse" type="circle" filter={['==', ['get', 'fresh'], 1]}
          paint={{ 'circle-radius': PULSE_REST_RADIUS, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2, 'circle-stroke-opacity': PULSE_REST_OPACITY }} />
        <Layer id="rain-now-gauges" type="circle"
          paint={{ 'circle-radius': ['case', ['==', ['get', 'fresh'], 1], 6, 5], 'circle-color': ['get', 'color'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5, 'circle-opacity': ['case', ['==', ['get', 'fresh'], 1], 0.95, 0.6], 'circle-stroke-opacity': ['case', ['==', ['get', 'fresh'], 1], 1, 0.7] }} />
        <Layer id="rain-now-gauges-label" type="symbol" minzoom={9}
          layout={{ 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-allow-overlap': false }}
          paint={{ 'text-color': '#1e3a8a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 }} />
      </Source>
      {/* The radar pictures come last in this list and say which layer they go under: arrows and gauges are
          already in the map by then. Added first, a new picture landed on top of them and hid the arrows. */}
      {view.picture && !rawRadarOn && (
        // A new canvas is a new source: MapLibre has no setter for a canvas source. The id changes with it.
        // With one fixed id (until 20-oct) the new <Source> found the old one still in the map, reused it
        // and drew nothing new: the picture only moved on a page reload.
        <Source key={view.picture.id} id={`rain-now-radar-${view.picture.id}`} {...canvasSource(view.picture)}>
          <Layer id={`rain-now-radar-${view.picture.id}`} type="raster" beforeId={under} paint={{ 'raster-opacity': RAIN_OPACITY, 'raster-resampling': 'linear', 'raster-fade-duration': 0 }} />
        </Source>
      )}
      {loop && view.picture && !rawRadarOn && (
        <Source key={loop.id} id={loop.id} {...canvasSource({ canvas: loop.canvas, corners: loop.corners, id: 0 })}>
          <Layer id={loop.id} type="raster" beforeId={under} paint={{ 'raster-opacity': 0, 'raster-resampling': 'linear', 'raster-fade-duration': 0 }} />
        </Source>
      )}
    </>
  );
});

type ArrowKind = 'coming' | 'own' | 'flow';

/** «~18:10»: the clock time `etaMin` from now, to the nearest 5 minutes, in Madrid time. */
export function arrivalClock(nowMs: number, etaMin: number): string {
  const step = 5 * 60_000;
  const at = new Date(Math.round((nowMs + etaMin * 60_000) / step) * step);
  return `~${new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at)}`;
}

/** How far inside the rain an arrow starts, behind the front. */
export const ARROW_INSIDE_KM = 7;
/** How far an arrow sticks out ahead of the front: a little, more for faster rain, never its half hour. */
export function arrowOverhangKm(kmh: number): number {
  return Math.min(5, Math.max(2, kmh * 0.1));
}

function kmBetween(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const kmLon = 111.32 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot((a.lon - b.lon) * kmLon, (a.lat - b.lat) * 111.32);
}

/** A solid shaft through the front of a patch, from `inside` km behind it to `ahead` km past it towards
 *  `toDeg`, and an open chevron at its tip (two short strokes, so it does not cover a spot marker). */
export function arrowGeo(edge: { lon: number; lat: number }, inside: number, ahead: number, toDeg: number, kind: ArrowKind, label?: string): GeoJSON.FeatureCollection {
  const kmLat = 111.32, kmLon = 111.32 * Math.cos((edge.lat * Math.PI) / 180);
  const from = (p: [number, number], d: number, deg: number): [number, number] => {
    const r = (deg * Math.PI) / 180;
    return [p[0] + (Math.sin(r) * d) / kmLon, p[1] + (Math.cos(r) * d) / kmLat];
  };
  const start = from([edge.lon, edge.lat], inside, toDeg + 180);
  const tip = from([edge.lon, edge.lat], ahead, toDeg);
  const km = inside + ahead;
  const barb = Math.max(0.9, km * 0.09);
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { part: 'shaft', kind }, geometry: { type: 'LineString', coordinates: [start, tip] } },
      { type: 'Feature', properties: { part: 'head', kind }, geometry: { type: 'LineString', coordinates: [from(tip, barb, toDeg + 150), tip, from(tip, barb, toDeg - 150)] } },
      ...(label ? [{ type: 'Feature' as const, properties: { part: 'eta', kind, label }, geometry: { type: 'Point' as const, coordinates: tip } }] : []),
    ],
  };
}
