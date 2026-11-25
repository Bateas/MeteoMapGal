/**
 * The fire card only opens when a satellite sees a fire, so nothing looks at it by accident. What matters most on it
 * is what it does NOT claim: an old detection is not «a fire now».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import type { FeatureCollection } from 'geojson';

const h = vi.hoisted(() => ({
  data: null as unknown,
  handlers: new Map<string, (e: unknown) => void>(),
  zoom: 12,
}));

vi.mock('react-map-gl/maplibre', () => {
  const map = {
    getZoom: () => h.zoom,
    on: (ev: string, layer: unknown, fn?: (e: unknown) => void) => {
      if (fn) h.handlers.set(`${ev}:${String(layer)}`, fn);
      else if (typeof layer === 'function') h.handlers.set(ev, layer as (e: unknown) => void);
    },
    off: () => {},
    getCanvas: () => ({ style: {} }),
    getContainer: () => document.body,
    project: () => ({ x: 400, y: 400 }),
    easeTo: () => {},
    isMoving: () => false,
    once: () => {},
    panBy: () => {},
  };
  return {
    Source: ({ id, data, children }: { id: string; data: unknown; children?: unknown }) => {
      if (id === 'firms-fires' || (data as FeatureCollection)?.features?.some((f) => f.properties?.clusterId)) h.data = data;
      return children;
    },
    Layer: () => null,
    Marker: () => null,
    useMap: () => ({ current: Object.assign(map, { getMap: () => map }) }),
  };
});

import { FireOverlay } from './FireOverlay';
import { useFireStore } from '../../store/fireStore';
import { useSectorStore } from '../../store/sectorStore';
import { SECTORS } from '../../config/sectors';
import type { ActiveFire } from '../../types/fire';

const HOUR = 3_600_000;
const fire = (hoursAgo: number, satellite = 'N'): ActiveFire => ({
  id: `x${hoursAgo}${satellite}`, lat: 42.3, lon: -8.55, brightness: 345, frp: 40, acquiredAt: new Date(Date.now() - hoursAgo * HOUR),
  satellite, confidence: 'high', daynight: 'D',
});

function openCard(fires: ActiveFire[]) {
  useFireStore.setState({ fires, events: [], attribution: new Map() } as never);
  render(<FireOverlay />);
  const clusterId = (h.data as FeatureCollection).features[0].properties!.clusterId;
  act(() => h.handlers.get('click:firms-hit')!({ features: [{ properties: { clusterId } }] }));
  return document.querySelector('.gf-name')!.closest('.gf-head')!.parentElement!;
}

beforeEach(() => {
  h.zoom = 12;
  h.data = null;
  h.handlers.clear();
  useSectorStore.setState({ activeSectorId: 'rias', activeSector: SECTORS.find((s) => s.id === 'rias')! } as never);
});
afterEach(() => {
  cleanup();
  useFireStore.setState({ fires: [], events: [], attribution: new Map() } as never);
});

describe('the fire card', () => {
  it('an old detection says it cannot claim the fire is still burning', () => {
    expect(openCard([fire(12)]).textContent).toContain('Sin pasada reciente del satélite: no podemos decir que siga activo.');
  });

  it('a recent one does not say that', () => {
    expect(openCard([fire(1)]).textContent).not.toContain('Sin pasada reciente');
  });

  it('it always says it may be an authorised burn or not, according to its power', () => {
    expect(openCard([fire(1)]).textContent).toMatch(/quema autorizada|incendio/i);
  });

  it('at the foot, who saw it, in words', () => {
    const one = openCard([fire(1)]);
    expect(one.querySelector('.gf-credit')!.textContent).toBe('Lo vio 1 satélite de la NASA (FIRMS).');
    cleanup();
    const two = openCard([fire(1, 'N'), fire(1.5, 'N20')]);
    expect(two.querySelector('.gf-credit')!.textContent).toBe('Lo vieron 2 satélites de la NASA (FIRMS).');
  });

  it('the legend of the marker is not on the card: it is in the guide', () => {
    expect(openCard([fire(1)]).textContent).not.toContain('En el mapa:');
  });
});

describe('the card of a named fire', () => {
  const event = (id: string, commune: string) => ({
    id, fireDate: new Date(Date.now() - 20 * HOUR), lastUpdate: new Date(Date.now() - 2 * HOUR), country: 'ES', province: 'Ourense',
    commune, areaHa: 42, lat: 42.3, lon: -8.1, galicia: true,
  });
  const click = (eventId: string) => act(() => h.handlers.get('click:effis-events-ring')!({ features: [{ properties: { eventId } }] }));
  const title = () => document.querySelector('#gf-fire-event-title')?.textContent ?? null;

  it('opens on its ring and stays open while the fire is still in the list', () => {
    useFireStore.setState({ fires: [], events: [event('e1', 'Cenlle'), event('e2', 'Avión')], attribution: new Map() } as never);
    render(<FireOverlay />);
    click('e1');
    expect(title()).toBe('Incendio en Cenlle (Ourense)');
    expect(document.body.textContent).toContain('42 ha');
  });

  it('and closes by itself when the fire drops out of the list', () => {
    useFireStore.setState({ fires: [], events: [event('e1', 'Cenlle'), event('e2', 'Avión')], attribution: new Map() } as never);
    render(<FireOverlay />);
    click('e1');
    act(() => useFireStore.setState({ events: [event('e2', 'Avión')] } as never));
    expect(title()).toBeNull();
  });
});

describe('random breaks of 13-nov', () => {
  it('a fire with no measured intensity shows no intensity row', () => {
    expect(openCard([{ ...fire(1), frp: 0 }]).textContent).not.toContain('Intensidad');
  });

  it('and with one it does', () => {
    expect(openCard([fire(1)]).textContent).toContain('Intensidad, última pasada');
  });
});

describe('the fire card and the zoom (P3 review, 19-nov)', () => {
  it('zooming out regroups the fires under another id, and the card stays open', () => {
    const near = { ...fire(1), id: 'near', lat: 42.345 };
    openCard([fire(1), near]);
    expect(document.querySelector('.gf-name')).not.toBeNull();
    h.zoom = 7;
    act(() => h.handlers.get('zoom')!({}));
    expect(document.querySelector('.gf-name')).not.toBeNull();
  });

  it('a fire that leaves the list closes its card', () => {
    openCard([fire(1)]);
    act(() => { useFireStore.setState({ fires: [] } as never); });
    expect(document.querySelector('.gf-name')).toBeNull();
  });
});
