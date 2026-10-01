/**
 * «Lloviendo ahora»: radar rain the gauges did not deny, the gauges that measured it, and an arrow
 * with where it is heading. Reactive: it wakes only when a gauge of the sector measures rain (no
 * radar is downloaded on a dry day) and the user can hide it for the day from the toolbar chip.
 * The rules, and the numbers behind them, are in services/rainNowService.ts.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { useWeatherStore } from '../../store/weatherStore';
import { useSectorStore } from '../../store/sectorStore';
import { useRainNowStore } from '../../store/rainNowStore';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';
import { fetchRadarFrames } from '../../api/radarTiles';
import { getSpotsForSector } from '../../config/spots';
import { mosaicCorners, type RadarMosaic } from '../../services/radarDecode';
import { estimateMotion, type RadarMotion } from '../../services/radarMotion';
import {
  classifyGauges, drawableCells, findRainCells, gaugeIntensity, groundTruth, rainArrivalAt, renderRain,
  ETA_MAX_MIN, type GaugeRain,
} from '../../services/rainNowService';
import { isSimRain, simGauges, simRainFrames } from '../../services/rainSim';

const POLL_MS = 5 * 60_000;
const TONE_COLOR = { debil: '#60a5fa', moderada: '#2563eb', fuerte: '#7c3aed' } as const;

interface Picture { url: string; corners: [[number, number], [number, number], [number, number], [number, number]] }

export const RainNowOverlay = memo(function RainNowOverlay() {
  const sector = useSectorStore((s) => s.activeSector);
  const stations = useWeatherStore((s) => s.stations);
  const readingsEpoch = useWeatherStore((s) => s.readingsEpoch);
  const historyEpoch = useWeatherStore((s) => s.historyEpoch);
  const dismissed = useRainNowStore((s) => s.dismissedToday);
  const setSummary = useRainNowStore((s) => s.setSummary);
  const sim = useMemo(isSimRain, []);

  // 1. Gauges alone, cheap and offline: do they give a reason to look at the radar?
  const gaugesNoRadar = useMemo(() => {
    const { currentReadings, readingHistory } = useWeatherStore.getState();
    return classifyGauges({ stations, readings: currentReadings, history: readingHistory, nowMs: Date.now() });
    // epochs stand for the readings and the history, read through getState above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stations, readingsEpoch, historyEpoch]);
  const wanted = sim || (!dismissed && gaugesNoRadar.some((g) => g.verdict === 'rain' || (g.official && g.verdict === 'alone')));

  // 2. Radar, only while wanted.
  const [radar, setRadar] = useState<{ frames: RadarMosaic[]; newestAgeMin: number } | null>(null);
  useVisibilityPolling(async () => {
    try {
      const r = await fetchRadarFrames();
      setRadar(r);
    } catch {
      setRadar(null);
    }
  }, POLL_MS, wanted && !sim);
  useEffect(() => { if (!wanted) setRadar(null); }, [wanted]);

  const frames = useMemo(() => {
    if (sim) return simRainFrames({ lon: sector.center[0], lat: sector.center[1] }, Math.floor(Date.now() / 1000));
    return radar?.frames ?? null;
  }, [sim, radar, sector.center]);

  // 3. Motion: once per newest frame (block matching, ~0.2 s).
  const motionRef = useRef<{ t: number; motion: RadarMotion | null }>({ t: -1, motion: null });
  const newest = frames?.[frames.length - 1] ?? null;
  if (newest && motionRef.current.t !== newest.t) {
    motionRef.current = { t: newest.t, motion: frames && frames.length >= 4 ? estimateMotion(frames) : null };
  }
  const motion = newest ? motionRef.current.motion : null;

  // 4. Everything that depends on the newest frame and the gauges.
  const view = useMemo(() => {
    if (!wanted) return null;
    let gauges: GaugeRain[];
    if (sim && newest) gauges = simGauges(stations, newest);
    else {
      const { currentReadings, readingHistory } = useWeatherStore.getState();
      gauges = classifyGauges({ stations, readings: currentReadings, history: readingHistory, nowMs: Date.now(), radar: frames });
    }
    const raining = gauges.filter((g) => g.verdict === 'rain').sort((a, b) => b.mm - a.mm);
    if (raining.length === 0 && !sim) return null;           // the layer needs rain on the ground

    let picture: Picture | null = null;
    let arrivals: { spotId: string; spotName: string; etaMin: number; distanceKm: number }[] = [];
    let cellsShown = 0;
    let arrow: GeoJSON.FeatureCollection | null = null;
    if (newest) {
      const { cells, labels } = findRainCells(newest);
      const judged = groundTruth(cells, labels, newest, gauges);
      const draw = drawableCells(judged, { lon: sector.center[0], lat: sector.center[1] });
      cellsShown = draw.size;
      const rgba = renderRain(newest, labels, draw);
      const canvas = document.createElement('canvas');
      canvas.width = newest.w; canvas.height = newest.h;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.putImageData(new ImageData(rgba, newest.w, newest.h), 0, 0);
        picture = { url: canvas.toDataURL('image/png'), corners: mosaicCorners(newest) };
      }
      for (const spot of getSpotsForSector(sector.id)) {
        const a = rainArrivalAt({ lon: spot.center[0], lat: spot.center[1] }, newest, labels, draw, motion);
        if (a && a.etaMin <= ETA_MAX_MIN) arrivals.push({ spotId: spot.id, spotName: spot.shortName, etaMin: a.etaMin, distanceKm: a.distanceKm });
      }
      arrivals = arrivals.sort((p, q) => p.etaMin - q.etaMin);
      if (motion?.stable) {
        const biggest = judged.filter((c) => draw.has(c.id)).sort((p, q) => q.pixels - p.pixels)[0];
        if (biggest) arrow = arrowGeo(biggest.lon, biggest.lat, motion.toDeg, motion.kmh * 0.5);
      }
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
      picture, gaugeGeo, arrow, cellsShown, arrivals,
      gauges: raining.map((g) => ({ id: g.id, name: g.name, mm: g.mm })),
    };
    // newest/frames/motion change together with the frame set
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, sim, newest, stations, readingsEpoch, historyEpoch, sector.id, motion]);

  useEffect(() => {
    if (!view) { setSummary(null); return; }
    setSummary({
      gauges: view.gauges,
      arrivals: view.arrivals,
      motion: motion?.stable ? { kmh: motion.kmh, toDeg: motion.toDeg } : null,
      radarAgeMin: sim ? 5 : radar?.newestAgeMin ?? null,
      cells: view.cellsShown,
      sim,
    });
  }, [view, motion, radar, sim, setSummary]);
  useEffect(() => () => setSummary(null), [setSummary]);

  if (!view) return null;
  return (
    <>
      {view.picture && (
        <Source id="rain-now-radar" type="image" url={view.picture.url} coordinates={view.picture.corners}>
          <Layer id="rain-now-radar" type="raster" paint={{ 'raster-opacity': 1, 'raster-resampling': 'linear', 'raster-fade-duration': 0 }} />
        </Source>
      )}
      {view.arrow && (
        <Source id="rain-now-arrow" type="geojson" data={view.arrow}>
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
