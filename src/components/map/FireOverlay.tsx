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
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import { Ficha, Note } from './Ficha';
import { Cell } from '../spot/Cell';
import type { MapLayerMouseEvent } from 'react-map-gl/maplibre';
import type { FeatureCollection } from 'geojson';
import { useFireStore } from '../../store/fireStore';
import { useSectorStore } from '../../store/sectorStore';
import { fireAttributionKey } from '../../api/firmsClient';
import { selectFireClusters, isFireActive, clusterFires, fireDisplayRadiusKm, type FireCluster } from '../../services/fireClustering';
import { fireProximity, formatFireAge } from '../../services/fireService';
import { describeFireLocation, fireDisclaimer } from '../../services/fireRegion';
import { formatBurntArea, fireEventName, type FireEvent } from '../../api/fireEventsClient';
import { useMapInk } from '../../hooks/useMapInk';

const SOURCE_ID = 'firms-fires';
const EVENTS_SOURCE_ID = 'effis-events';
const EVENTS_LAYER_ID = 'effis-events-ring';
const CORE_LAYER_ID = 'firms-core';
/** Invisible and wider than the dot: a click had to land exactly on a dot of 8 px, and a finger does not */
const HIT_LAYER_ID = 'firms-hit';

/** Age gates are hours wide, but nothing re-renders this between 30min polls. */
const AGE_TICK_MS = 60_000;

/** Named events on the map only up to this old: a week of them drowned the live hotspots in orange names. */
export const EVENT_MAX_DAYS = 3;

/** Days since the fire started, or since its last revision when EFFIS gives no date. Null: nothing says how old. */
export function fireEventAgeDays(e: Pick<FireEvent, 'fireDate' | 'lastUpdate'>, now: number): number | null {
  const t = e.fireDate ?? e.lastUpdate;
  return t ? Math.max(0, (now - t.getTime()) / 86_400_000) : null;
}

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
  const allEvents = useFireStore((s) => s.events);
  const attribution = useFireStore((s) => s.attribution);
  const activeSector = useSectorStore((s) => s.activeSector);
  const { current: mapRef } = useMap();
  const ink = useMapInk();
  const [selected, setSelected] = useState<FireCluster | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<FireEvent | null>(null);
  const closeHotspot = useCallback(() => setSelected(null), []);
  const closeEvent = useCallback(() => setSelectedEvent(null), []);
  // Zoom drives how wide markers group for drawing — see fireDisplayRadiusKm.
  const [zoom, setZoom] = useState(() => mapRef?.getMap()?.getZoom() ?? 10);

  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;
    const onZoom = () => setZoom(map.getZoom());
    onZoom();
    map.on('zoom', onZoom);
    return () => { map.off('zoom', onZoom); };
  }, [mapRef]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => {
      if (document.hidden) return;
      setNow(Date.now());
    }, AGE_TICK_MS);
    return () => clearInterval(iv);
  }, []);

  const events = useMemo(() => allEvents.filter((e) => {
    const age = fireEventAgeDays(e, now);
    return age !== null && age <= EVENT_MAX_DAYS;
  }), [allEvents, now]);

  // THE shared 2km list — the ticker reads this one too, so the
  // fire COUNT never moves with the zoom.
  const physical = selectFireClusters(fires);
  // What gets drawn: same fires, grouped wider when zoomed out so 27 markers
  // do not smear into each other. At close zoom this IS the physical list.
  const clusters = useMemo(() => {
    const r = fireDisplayRadiusKm(zoom);
    return r <= 2 ? physical : clusterFires(fires, r);
  }, [fires, physical, zoom]);

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
            ? `rayo ${Math.round(lit.hoursAfterStrike)} h`
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
      // EFFIS is a BURNT-AREA product, not a live feed: an event stays on the
      // map for days after it stopped burning. Carrying its age lets the ring
      // fade instead of shouting at the same volume as one from this morning —
      // in a bad week a dozen of them pile up and drown the live hotspots,
      // which are the ones that change what you do today.
      const ageDays = fireEventAgeDays(e, now) ?? EVENT_MAX_DAYS;
      return {
        type: 'Feature',
        id: e.id,
        properties: {
          eventId: e.id,
          areaHa: e.areaHa ?? 0,
          ageDays,
          label: e.commune ? (area ? `${e.commune} · ${area}` : e.commune) : '',
        },
        geometry: { type: 'Point', coordinates: [e.lon, e.lat] },
      };
    }),
  }), [events, now]);

  const handleClick = useCallback((e: MapLayerMouseEvent) => {
    const id = e.features?.[0]?.properties?.clusterId;
    const hit = clusters.find((c) => c.id === id);
    if (hit) setSelected(hit);
  }, [clusters]);

  // The ring carried a name and a size and did nothing when tapped — the whole
  // point of a named event is that you can ask it who it is.
  const handleEventClick = useCallback((e: MapLayerMouseEvent) => {
    const id = e.features?.[0]?.properties?.eventId;
    const hit = events.find((ev) => ev.id === id);
    if (hit) { setSelectedEvent(hit); setSelected(null); }
  }, [events]);

  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;
    // Named handlers so cleanup removes the SAME functions.
    const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { map.getCanvas().style.cursor = ''; };
    map.on('click', HIT_LAYER_ID, handleClick);
    map.on('mouseenter', HIT_LAYER_ID, onEnter);
    map.on('mouseleave', HIT_LAYER_ID, onLeave);
    map.on('click', EVENTS_LAYER_ID, handleEventClick);
    map.on('mouseenter', EVENTS_LAYER_ID, onEnter);
    map.on('mouseleave', EVENTS_LAYER_ID, onLeave);
    return () => {
      map.off('click', HIT_LAYER_ID, handleClick);
      map.off('mouseenter', HIT_LAYER_ID, onEnter);
      map.off('mouseleave', HIT_LAYER_ID, onLeave);
      map.off('click', EVENTS_LAYER_ID, handleEventClick);
      map.off('mouseenter', EVENTS_LAYER_ID, onEnter);
      map.off('mouseleave', EVENTS_LAYER_ID, onLeave);
    };
  }, [mapRef, handleClick, handleEventClick]);

  // An event that drops out of the feed must not keep its popup open.
  useEffect(() => {
    if (selectedEvent && !events.some((e) => e.id === selectedEvent.id)) setSelectedEvent(null);
  }, [events, selectedEvent]);

  // A selected fire that ages out of the list must not keep a popup open. Asked by its detections, not by
  // the group id: zooming out regroups the same fires under new ids and the card closed (P3 review, 19-nov).
  useEffect(() => {
    if (!selected) return;
    const live = new Set(fires.map((f) => f.id));
    if (!selected.hotspots.some((h) => live.has(h.id))) setSelected(null);
  }, [fires, selected]);

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
        <Layer id={HIT_LAYER_ID} type="circle" source={SOURCE_ID} paint={{ 'circle-radius': 20, 'circle-opacity': 0 }} />
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
            'text-size': 12,
            'text-offset': [0, 1.6],
            'text-anchor': 'top',
            'text-allow-overlap': false,
            'text-optional': true,
          }}
          paint={{
            'text-color': ink.text,
            'text-halo-color': ink.halo,
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
              // Thin, and thinner still once it is history.
              'circle-stroke-width': ['interpolate', ['linear'], ['get', 'ageDays'], 0, 1.6, 3, 1],
              // Was a flat 0.85 for every ring, however old. Past fires are
              // context, not signal: they recede so the live hotspots read
              // first. Never to zero — a burnt hillside still matters for what
              // the wind picks up and for reading yesterday.
              'circle-stroke-opacity': [
                'interpolate', ['linear'], ['get', 'ageDays'],
                0, 0.5,
                EVENT_MAX_DAYS, 0.2,
              ],
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
              'text-size': 12,
              'text-offset': [0, 1.4],
              'text-anchor': 'top',
              'text-allow-overlap': false,
              'text-optional': true,
            }}
            paint={{
              'text-color': ink.text,
              'text-halo-color': ink.halo,
              'text-halo-width': 1.4,
              // The name is what makes an EFFIS event worth drawing, so it
              // fades far less than its ring — but it does fade, so an old one gives way to a new one.
              'text-opacity': ['interpolate', ['linear'], ['get', 'ageDays'], 0, 0.95, EVENT_MAX_DAYS, 0.7],
            }}
          />
        </Source>
      )}

      {selected && near && (
        <Ficha longitude={selected.lon} latitude={selected.lat} onClose={closeHotspot} titleId="gf-fire-title" mapClickKey={String(selected.id)}>
          <div className="gf-head">
            <div className="gf-titles">
              <h2 id="gf-fire-title" className="gf-name">Detección de incendio</h2>
              {/* Place first, distance second. Measuring a Portuguese fire from a Galician reservoir was
                  true and unhelpful. */}
              <div className="gf-sub" style={{ whiteSpace: 'normal' }}>
                {describeFireLocation(selected.lat, selected.lon, near.distanceKm, near.bearing)}
              </div>
            </div>
          </div>
          <dl className="gf-data">
            <Cell label="Última detección" value={formatFireAge(selected.latestAt, now)} warn={!isFireActive(selected, now)} />
            {selected.frpMw > 0 && (
              <Cell label="Intensidad, última pasada" value={`${Math.round(selected.frpMw)} MW`} />
            )}
          </dl>
          <div className="gf-notes">
            {!isFireActive(selected, now) && (
              <Note icon="alert-triangle" tone="alto">Sin pasada reciente del satélite: no podemos decir que siga activo.</Note>
            )}
            {/* Decodes the purple ring drawn around this marker */}
            {lightningFor(selected, attribution) && (
              <Note icon="zap" tone="riesgo">
                Origen: rayo caído
                {(() => {
                  const h = lightningFor(selected, attribution)?.hoursAfterStrike;
                  return h != null ? ` hace ${Math.round(h)} h` : ' en las horas previas';
                })()}
              </Note>
            )}
            {/* Honest about what a satellite hotspot is. In Galicia many are authorised agricultural
                burns, but only while the radiative power makes that physically possible, so the wording
                follows the number instead of contradicting it. */}
            <Note icon="info">{fireDisclaimer(selected.frpMw)}</Note>
          </div>
          <p className="gf-credit" title={selected.hotspotCount === 1 ? '1 detección' : `${selected.hotspotCount} detecciones`}>
            {selected.satellites.length === 1 ? 'Lo vio 1 satélite' : `Lo vieron ${selected.satellites.length} satélites`} de la NASA (FIRMS).
          </p>
        </Ficha>
      )}

      {/* The named event. A different card from the hotspot one because it answers a different question:
          not "is something hot right now" but "what burned here, where, and how much". No caveat about
          authorised burns: this one has been delineated and measured, not inferred from a warm pixel. */}
      {selectedEvent && (
        <Ficha longitude={selectedEvent.lon} latitude={selectedEvent.lat} onClose={closeEvent} titleId="gf-fire-event-title" mapClickKey={String(selectedEvent.id)}>
          <div className="gf-head">
            <div className="gf-titles">
              <h2 id="gf-fire-event-title" className="gf-name">Incendio en {fireEventName(selectedEvent)}</h2>
            </div>
          </div>
          <dl className="gf-data">
            {formatBurntArea(selectedEvent.areaHa) && (
              <Cell label="Superficie quemada" value={formatBurntArea(selectedEvent.areaHa) ?? ''} />
            )}
            {selectedEvent.fireDate && (
              <Cell label="Inicio" value={selectedEvent.fireDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} />
            )}
            {selectedEvent.lastUpdate && (
              <Cell label="Última revisión" value={formatFireAge(selectedEvent.lastUpdate, now)} />
            )}
          </dl>
          <p className="gf-credit">Superficie delimitada por EFFIS (Copernicus, Unión Europea). Se revisa mientras el incendio avanza.</p>
        </Ficha>
      )}
    </>
  );
}

export const FireOverlay = memo(FireOverlayInner);
