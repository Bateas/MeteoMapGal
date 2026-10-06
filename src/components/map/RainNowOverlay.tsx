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
import { Source, Layer, type SourceProps } from 'react-map-gl/maplibre';
import { useWeatherStore } from '../../store/weatherStore';
import { useWeatherLayerStore } from '../../store/weatherLayerStore';
import { useSectorStore } from '../../store/sectorStore';
import { useRainNowStore, type RainNowDebug } from '../../store/rainNowStore';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';
import { fetchRadarFrames, FRAMES_WANTED } from '../../api/radarTiles';
import { getSpotsForSector } from '../../config/spots';
import { mosaicCorners, type RadarMosaic } from '../../services/radarDecode';
import { estimateMotion, type RadarMotion } from '../../services/radarMotion';
import { pixelsByLabel, trackCells, type CellTrack } from '../../services/radarTracking';
import {
  announcingTracks, approachingCells, classifyGauges, drawableCells, echoWorthFollowing, findRainCells, gaugeIntensity, groundTruth,
  rainArrivalAt, renderRain, ARRIVAL_MAX_MIN, type GaugeRain, type RainApproach,
} from '../../services/rainNowService';
import { updateArrivalChecks } from '../../services/rainArrivalChecks';
import { simGauges, simRainFrames, simRainMode } from '../../services/rainSim';

const POLL_MS = 5 * 60_000;
const TONE_COLOR = { debil: '#60a5fa', moderada: '#2563eb', fuerte: '#7c3aed' } as const;
/** Arrows drawn at most (the soonest coming), so the map does not fill with them. */
const MAX_ARROWS = 3;

/**
 * The radar picture goes to MapLibre as a CANVAS source, never as an image URL. MapLibre fetches an
 * image source's URL, and the production policy has no data: (nor blob:) in connect-src, so the
 * data: URL this used was blocked and the rain never drew in production (6-oct; dev has no policy,
 * so it looked fine). A canvas source reads the pixels directly: no request at all.
 */
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

  // 1. Gauges alone, cheap and offline.
  const gaugesNoRadar = useMemo(() => {
    const { currentReadings, readingHistory } = useWeatherStore.getState();
    return classifyGauges({ stations, readings: currentReadings, history: readingHistory, nowMs: Date.now() });
    // epochs stand for the readings and the history, read through getState above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stations, readingsEpoch, historyEpoch]);
  const gaugeRain = gaugesNoRadar.some((g) => g.verdict === 'rain' || (g.official && g.verdict === 'alone'));
  const gaugeRainRef = useRef(gaugeRain);
  gaugeRainRef.current = gaugeRain;

  // 2. Radar: the newest frame always; the history only with something to follow.
  const [radar, setRadar] = useState<{ frames: RadarMosaic[]; newestAgeMin: number } | null>(null);
  const look = async () => {
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
  const analysisRef = useRef<{ key: string; motion: RadarMotion | null; cells: ReturnType<typeof findRainCells>; tracks: Map<number, CellTrack> | null } | null>(null);
  const analysis = useMemo(() => {
    if (!frames || !newest) return null;
    const key = `${newest.t}:${frames.length}:${simMode ?? ''}`;
    if (analysisRef.current?.key === key) return analysisRef.current;
    const found = findRainCells(newest);
    const history = frames.length >= 4;
    const motion = history ? estimateMotion(frames) : null;
    const byLabel = history ? pixelsByLabel(found.labels) : null;
    const tracks = byLabel ? trackCells(frames, found.cells.map((c) => c.id), (id) => byLabel.get(id) ?? [], motion) : null;
    analysisRef.current = { key, motion, cells: found, tracks };
    return analysisRef.current;
  }, [frames, newest, simMode]);
  const motion = analysis?.motion ?? null;

  // 4. Everything that depends on the newest frame and the gauges.
  const view = useMemo(() => {
    if (dismissed && !sim) return null;
    let gauges: GaugeRain[];
    if (sim && newest) gauges = simGauges(stations, newest);
    else {
      const { currentReadings, readingHistory } = useWeatherStore.getState();
      gauges = classifyGauges({ stations, readings: currentReadings, history: readingHistory, nowMs: Date.now(), radar: frames });
    }
    const raining = gauges.filter((g) => g.verdict === 'rain').sort((a, b) => b.mm - a.mm);

    let picture: Picture | null = null;
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
      const rgba = renderRain(newest, labels, draw);
      const canvas = document.createElement('canvas');
      canvas.width = newest.w; canvas.height = newest.h;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.putImageData(new ImageData(rgba, newest.w, newest.h), 0, 0);
        picture = { canvas, corners: mosaicCorners(newest), id: ++pictureSeq };
      }
      // Arrows only for the rain coming to the sector: an arrow means «this is heading your way».
      // 6-oct: the fallback (biggest steady patch) drew one over the sea, going nowhere near a spot.
      const arrowCells = approach.slice(0, MAX_ARROWS).map((a) => ({ lon: a.lon, lat: a.lat, toDeg: a.toDeg, kmh: a.kmh }));
      arrows = arrowCells.flatMap((c) => arrowGeo(c.lon, c.lat, c.toDeg, c.kmh * 0.5).features);
    } else if (raining.length === 0 && !sim) {
      return { off: true as const, gauges, arrivals, debug };
    }
    const gaugeGeo: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: raining.map((g) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [g.lon, g.lat] },
        properties: { color: TONE_COLOR[gaugeIntensity(g.mm)], label: g.mm.toFixed(1).replace('.', ',') },
      })),
    };
    return {
      off: false as const, gauges, picture, gaugeGeo, cellsShown, arrivals, approach, debug,
      arrowGeo: arrows.length ? ({ type: 'FeatureCollection', features: arrows } as GeoJSON.FeatureCollection) : null,
      raining: raining.map((g) => ({ id: g.id, name: g.name, mm: g.mm })),
    };
    // newest/frames/analysis change together with the frame set
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismissed, sim, analysis, stations, readingsEpoch, historyEpoch, sector.id, sector.radiusKm, centre]);

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

  if (!view || view.off) return null;
  return (
    <>
      {view.picture && !rawRadarOn && (
        // A new canvas is a new source (key): MapLibre has no setter for a canvas source.
        <Source key={view.picture.id} id="rain-now-radar" {...canvasSource(view.picture)}>
          <Layer id="rain-now-radar" type="raster" paint={{ 'raster-opacity': 1, 'raster-resampling': 'linear', 'raster-fade-duration': 0 }} />
        </Source>
      )}
      {view.arrowGeo && (
        <Source id="rain-now-arrow" type="geojson" data={view.arrowGeo}>
          <Layer id="rain-now-arrow-line" type="line" filter={['==', ['get', 'part'], 'shaft']}
            paint={{ 'line-color': '#1d4ed8', 'line-width': 2.5, 'line-dasharray': [2, 1.5], 'line-opacity': 0.85 }} />
          <Layer id="rain-now-arrow-head" type="line" filter={['==', ['get', 'part'], 'head']}
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': '#1d4ed8', 'line-width': 3, 'line-opacity': 0.9 }} />
        </Source>
      )}
      <Source id="rain-now-gauges" type="geojson" data={view.gaugeGeo}>
        <Layer id="rain-now-gauges" type="circle"
          paint={{ 'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5, 'circle-opacity': 0.95 }} />
        <Layer id="rain-now-gauges-label" type="symbol" minzoom={9}
          layout={{ 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-allow-overlap': false }}
          paint={{ 'text-color': '#1e3a8a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 }} />
      </Source>
    </>
  );
});

/** A dashed shaft from (lon, lat) `km` towards `toDeg`, and an open chevron at its end (two short
 *  strokes, so it does not cover a spot marker when zoomed in). */
function arrowGeo(lon: number, lat: number, toDeg: number, km: number): GeoJSON.FeatureCollection {
  const kmLat = 111.32, kmLon = 111.32 * Math.cos((lat * Math.PI) / 180);
  const from = (p: [number, number], d: number, deg: number): [number, number] => {
    const r = (deg * Math.PI) / 180;
    return [p[0] + (Math.sin(r) * d) / kmLon, p[1] + (Math.cos(r) * d) / kmLat];
  };
  const tip = from([lon, lat], km, toDeg);
  const barb = Math.max(0.6, km * 0.06);
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { part: 'shaft' }, geometry: { type: 'LineString', coordinates: [[lon, lat], tip] } },
      { type: 'Feature', properties: { part: 'head' }, geometry: { type: 'LineString', coordinates: [from(tip, barb, toDeg + 150), tip, from(tip, barb, toDeg - 150)] } },
    ],
  };
}
