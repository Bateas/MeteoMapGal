/**
 * FireOverlay — NASA FIRMS wildfire detections on the map, grouped into FIRES.
 *
 * One marker per fire, never one per satellite pixel: a single wildfire shows
 * up in the feed many times over (two satellites x several passes x several
 * 375m pixels), and drawing every row painted one fire as a dozen medium
 * circles — inflating the count while UNDER-representing its intensity.
 * Halo and core now scale with the FRP of the whole fire front.
 *
 * Fires older than the freshness window are drawn dimmed rather than hidden:
 * something did burn there today, but nothing we have says it is burning now.
 * The popup always states how long ago the satellite actually saw it.
 *
 * Auto-renders when there are fires. No toggle. Lazy-loaded behind <Suspense>.
 */

import { memo, useMemo, useState, useEffect, useCallback } from 'react';
import { Source, Layer, Popup, useMap } from 'react-map-gl/maplibre';
import type { MapLayerMouseEvent } from 'react-map-gl/maplibre';
import type { FeatureCollection } from 'geojson';
import { useFireStore } from '../../store/fireStore';
import { useSectorStore } from '../../store/sectorStore';
import { fireAttributionKey } from '../../api/firmsClient';
import { selectFireClusters, isFireActive, type FireCluster } from '../../services/fireClustering';
import { fireProximity, formatFireAge } from '../../services/fireService';
import { describeFireLocation, fireDisclaimer } from '../../services/fireRegion';
import { formatBurntArea } from '../../api/fireEventsClient';
import { WeatherIcon } from '../icons/WeatherIcons';

const SOURCE_ID = 'firms-fires';
const EVENTS_SOURCE_ID = 'effis-events';
const EVENTS_LAYER_ID = 'effis-events-ring';
const CORE_LAYER_ID = 'firms-core';

/** Age gates are hours wide, but nothing re-renders this between 30min polls. */
const AGE_TICK_MS = 60_000;

/** Attribution is keyed per hotspot — a fire counts as lit by lightning if any
 *  of its detections is. */
function lightningFor(cluster: FireCluster, attribution: Map<string, { hoursAfterStrike: number | null }>) {
  for (const h of cluster.hotspots) {
    const lit = attribution.get(fireAttributionKey(h.lat, h.lon));
    if (lit) return lit;
  }
  return null;
}

function FireOverlayInner() {
  const fires = useFireStore((s) => s.fires);
  const events = useFireStore((s) => s.events);
  const attribution = useFireStore((s) => s.attribution);
  const activeSector = useSectorStore((s) => s.activeSector);
  const { current: mapRef } = useMap();
  const [selected, setSelected] = useState<FireCluster | null>(null);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => {
      if (document.hidden) return;
      setNow(Date.now());
    }, AGE_TICK_MS);
    return () => clearInterval(iv);
  }, []);

  // THE shared cluster list — the ticker and the smoke layer read the same one.
  const clusters = selectFireClusters(fires);

  const geojson = useMemo<FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: clusters.map((c) => {
      const lit = lightningFor(c, attribution);
      return {
        type: 'Feature',
        id: c.id,
        properties: {
          clusterId: c.id,
          // Intensity of the whole front, not of one pixel
          frpMw: c.frpMw,
          hotspotCount: c.hotspotCount,
          confidence: c.maxConfidence,
          // MapLibre filter expressions can't compare strings to bool, encode rank
          confRank: c.maxConfidence === 'high' ? 2 : c.maxConfidence === 'nominal' ? 1 : 0,
          // 1 while we can honestly call it active; 0 = today's history, dimmed
          fresh: isFireActive(c, now) ? 1 : 0,
          // Lightning origin, when our own strike history accounts for it.
          // 0 = no known cause; never means "not checked".
          litByLightning: lit ? 1 : 0,
          lightningLabel: lit?.hoursAfterStrike != null
            ? `rayo ${Math.round(lit.hoursAfterStrike)}h`
            : '',
        },
        geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
      };
    }),
  }), [clusters, attribution, now]);

  // Only events with a name earn a label — an unnamed ring is just clutter.
  const eventsGeojson = useMemo<FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: events.map((e) => {
      const area = formatBurntArea(e.areaHa);
      return {
        type: 'Feature',
        id: e.id,
        properties: {
          eventId: e.id,
          areaHa: e.areaHa ?? 0,
          label: e.commune ? (area ? `${e.commune} · ${area}` : e.commune) : '',
        },
        geometry: { type: 'Point', coordinates: [e.lon, e.lat] },
      };
    }),
  }), [events]);

  const handleClick = useCallback((e: MapLayerMouseEvent) => {
    const id = e.features?.[0]?.properties?.clusterId;
    const hit = clusters.find((c) => c.id === id);
    if (hit) setSelected(hit);
  }, [clusters]);

  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;
    // Named handlers so cleanup removes the SAME functions.
    const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { map.getCanvas().style.cursor = ''; };
    map.on('click', CORE_LAYER_ID, handleClick);
    map.on('mouseenter', CORE_LAYER_ID, onEnter);
    map.on('mouseleave', CORE_LAYER_ID, onLeave);
    return () => {
      map.off('click', CORE_LAYER_ID, handleClick);
      map.off('mouseenter', CORE_LAYER_ID, onEnter);
      map.off('mouseleave', CORE_LAYER_ID, onLeave);
    };
  }, [mapRef, handleClick]);

  // A selected fire that ages out of the list must not keep a popup open.
  useEffect(() => {
    if (selected && !clusters.some((c) => c.id === selected.id)) setSelected(null);
  }, [clusters, selected]);

  // Named events outlive their own hotspots by days, so the overlay must not
  // bail out just because no pixel is hot right now — that is exactly when a
  // named fire is the only thing left to show.
  if (clusters.length === 0 && events.length === 0) return null;

  const near = selected ? fireProximity(selected, activeSector.center) : null;

  return (
    <>
      <Source id={SOURCE_ID} type="geojson" data={geojson}>
        {/* Soft halo — sized by the intensity of the whole fire */}
        <Layer
          id="firms-halo"
          type="circle"
          source={SOURCE_ID}
          paint={{
            // 12px @ 1MW → 34px @ ≥300MW. Fire fronts sum several pixels, so
            // the scale runs further than it did per-pixel.
            'circle-radius': [
              'interpolate', ['linear'], ['get', 'frpMw'],
              1, 12,
              10, 16,
              50, 22,
              100, 28,
              300, 34,
            ],
            'circle-color': '#ef4444',
            'circle-opacity': ['case', ['==', ['get', 'fresh'], 1], 0.15, 0.05],
            'circle-blur': 0.6,
          }}
        />
        {/* Solid core */}
        <Layer
          id={CORE_LAYER_ID}
          type="circle"
          source={SOURCE_ID}
          paint={{
            'circle-radius': [
              'interpolate', ['linear'], ['get', 'frpMw'],
              1, 4,
              10, 6,
              50, 9,
              100, 12,
              300, 16,
            ],
            // Tint by confidence: nominal = orange, high = bright red
            'circle-color': [
              'match', ['get', 'confidence'],
              'high', '#dc2626',
              'nominal', '#f97316',
              '#fbbf24', // low (already filtered out, defensive default)
            ],
            // Purple ring when a strike lit it — the same purple lightning wears
            // everywhere else on the map, so the link reads without a legend.
            'circle-stroke-color': [
              'case', ['==', ['get', 'litByLightning'], 1], '#a855f7', '#ffffff',
            ],
            'circle-stroke-width': [
              'case', ['==', ['get', 'litByLightning'], 1], 2.2, 1.2,
            ],
            'circle-stroke-opacity': ['case', ['==', ['get', 'fresh'], 1], 0.9, 0.35],
            'circle-opacity': ['case', ['==', ['get', 'fresh'], 1], 0.9, 0.35],
          }}
        />
        {/* How long the strike smouldered before the satellite saw it */}
        <Layer
          id="firms-lightning-label"
          type="symbol"
          source={SOURCE_ID}
          filter={['all', ['==', ['get', 'litByLightning'], 1], ['==', ['get', 'fresh'], 1]]}
          minzoom={8}
          layout={{
            'text-field': ['get', 'lightningLabel'],
            // Explicit font: the default stack 404s on the protomaps CDN
            'text-font': ['Noto Sans Regular'],
            'text-size': 10,
            'text-offset': [0, 1.6],
            'text-anchor': 'top',
            'text-allow-overlap': false,
            'text-optional': true,
          }}
          paint={{
            'text-color': '#c084fc',
            'text-halo-color': '#0f172a',
            'text-halo-width': 1.2,
          }}
        />
      </Source>

      {/* Named events, from EFFIS. Deliberately a different visual language
          from the hotspot dots: these are not "a hot pixel right now" but
          "a fire that has a municipality and a measured burnt area", and the
          label is the whole point — a reader gets Pazos de Borbén instead of
          a red dot 15km away. Drawn as an outlined ring so a named event and
          its own hotspots can sit on top of each other and still be told
          apart. */}
      {eventsGeojson.features.length > 0 && (
        <Source id={EVENTS_SOURCE_ID} type="geojson" data={eventsGeojson}>
          <Layer
            id={EVENTS_LAYER_ID}
            type="circle"
            source={EVENTS_SOURCE_ID}
            paint={{
              // Size by burnt area, not by radiative power: this figure is
              // cumulative ground truth, so it grows and never flickers.
              'circle-radius': [
                'interpolate', ['linear'], ['get', 'areaHa'],
                0, 7,
                10, 10,
                100, 15,
                1000, 22,
              ],
              'circle-color': 'transparent',
              'circle-stroke-color': '#f97316',
              'circle-stroke-width': 2,
              'circle-stroke-opacity': 0.85,
            }}
          />
          <Layer
            id="effis-events-label"
            type="symbol"
            source={EVENTS_SOURCE_ID}
            minzoom={7}
            layout={{
              'text-field': ['get', 'label'],
              'text-font': ['Noto Sans Bold'],
              'text-size': 11,
              'text-offset': [0, 1.4],
              'text-anchor': 'top',
              'text-allow-overlap': false,
              'text-optional': true,
            }}
            paint={{
              'text-color': '#fdba74',
              'text-halo-color': '#0f172a',
              'text-halo-width': 1.4,
            }}
          />
        </Source>
      )}

      {selected && near && (
        <Popup
          longitude={selected.lon}
          latitude={selected.lat}
          closeOnClick={false}
          onClose={() => setSelected(null)}
          maxWidth="380px"
          anchor="bottom"
          className="fire-popup"
        >
          <div className="p-2 text-sm text-slate-200 min-w-[210px]">
            <div className="flex items-center gap-1.5 font-semibold text-white mb-1">
              <span className="text-orange-400 flex"><WeatherIcon id="flame" size={15} /></span>
              Detección de incendio
            </div>

            <div className="space-y-0.5 text-xs text-slate-400">
              {/* Place first, distance second. Measuring a Portuguese fire
                  from a Galician reservoir was true and unhelpful. */}
              <div className="text-slate-200">
                {describeFireLocation(selected.lat, selected.lon, near.distanceKm, near.bearing)}
              </div>
              <div>
                Última detección:{' '}
                <span className={isFireActive(selected, now) ? 'text-slate-200' : 'text-amber-400'}>
                  {formatFireAge(selected.latestAt, now)}
                </span>
              </div>
              {selected.frpMw > 0 && (
                <div>
                  Intensidad:{' '}
                  <span className="text-slate-200">{Math.round(selected.frpMw)} MW</span>
                  <span className="text-slate-500"> (última pasada)</span>
                </div>
              )}
              <div>
                {selected.hotspotCount === 1
                  ? '1 detección'
                  : `${selected.hotspotCount} detecciones`}
                {' · '}
                {selected.satellites.length === 1
                  ? '1 satélite'
                  : `${selected.satellites.length} satélites`}
              </div>
              {!isFireActive(selected, now) && (
                <div className="text-amber-400/90">
                  Sin pasada reciente del satélite: no podemos decir que siga activo.
                </div>
              )}
            </div>

            {/* Honest about what a satellite hotspot is. In Galicia many of
                them are authorised agricultural burns — but only while the
                radiative power makes that physically possible, so the wording
                follows the number instead of contradicting it. */}
            <div className="mt-2 pt-1.5 border-t border-slate-700/60 text-[11px] leading-snug text-slate-500">
              {fireDisclaimer(selected.frpMw)}
            </div>
          </div>
        </Popup>
      )}
    </>
  );
}

export const FireOverlay = memo(FireOverlayInner);
