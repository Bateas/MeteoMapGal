import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import type { NormalizedStation, NormalizedReading } from '../../types/station';
import type { BuoyReading } from '../../api/buoyClient';
import { isWindBlacklisted } from '../../services/spotScoringEngine';
import {
  speedToLevel,
  buildWindFieldGeoJSON,
  SPEED_LEVELS,
  WIND_ARROW_ICON_SIZE_REGULAR,
  WIND_ARROW_ICON_SIZE_COMPACT,
  registerWindArrowIcons,
} from './WindFieldOverlay';
import { MUTED_ARROW_SCALE, MUTED_ARROW_OPACITY, arrowSize, arrowOpacity } from './windArrowStyle';
import { WIND_TONES_ON_DARK, WIND_TONES_ON_LIGHT } from '../../services/windUtils';
import { useMapStyleStore } from '../../store/mapStyleStore';
import { useThemeStore } from '../../store/themeStore';

function mockStation(id: string, lon = -8.7, lat = 42.2, over: Partial<NormalizedStation> = {}): NormalizedStation {
  return {
    id,
    name: `Station ${id}`,
    source: 'meteogalicia',
    lat,
    lon,
    altitude: 100,
    ...over,
  };
}

function mockReading(stationId: string, speed: number | null, dir: number | null, ageMin = 5): NormalizedReading {
  return {
    stationId,
    timestamp: new Date(Date.now() - ageMin * 60_000),
    temperature: 18.5,
    humidity: 75,
    pressure: 1015,
    windSpeed: speed,
    windGust: speed ? speed * 1.3 : null,
    windDirection: dir,
    precipitation: 0,
    solarRadiation: null,
    dewPoint: null,
  };
}

describe('buildWindFieldGeoJSON, buoys', () => {
  const buoy = (stationId: number, ageMin = 10, windSpeed: number | null = 5): BuoyReading => ({
    stationId,
    stationName: 'x',
    windSpeed,
    windDir: 90,
    timestamp: new Date(Date.now() - ageMin * 60_000).toISOString(),
  } as BuoyReading);

  it('draws a live buoy', () => {
    expect(buildWindFieldGeoJSON([], new Map(), [buoy(1250)]).features).toHaveLength(6);
  });

  it('has the same age ceiling as the stations: a buoy that stopped publishing goes', () => {
    expect(buildWindFieldGeoJSON([], new Map(), [buoy(1250, 89)]).features).toHaveLength(6);
    expect(buildWindFieldGeoJSON([], new Map(), [buoy(1250, 91)]).features).toHaveLength(0);
  });

  it('fades an old reading like a station does', () => {
    const [fresh] = buildWindFieldGeoJSON([], new Map(), [buoy(1250, 10)]).features;
    const [old] = buildWindFieldGeoJSON([], new Map(), [buoy(1250, 60)]).features;
    expect(old.properties?.opacity).toBeLessThan(fresh.properties?.opacity);
  });

  it('a land station set aside for bad wind does not come back as a buoy (Lourizán)', () => {
    expect(isWindBlacklisted('mg_10064')).toBe(true);
    expect(buildWindFieldGeoJSON([], new Map(), [buoy(4271, 10, 0)]).features).toHaveLength(0);
  });

  it('the copy of a land anemometer draws no second set of arrows (Ons, Cabo Udra)', () => {
    expect(buildWindFieldGeoJSON([], new Map(), [buoy(4272), buoy(4273)]).features).toHaveLength(0);
  });
});

describe('registerWindArrowIcons: a change of map goes by style diff, and the images survive it', () => {
  type Painted = { fills: string[] };
  let painted: Painted;
  const fakeMap = () => {
    const images = new Set<string>();
    return {
      hasImage: (id: string) => images.has(id),
      addImage: vi.fn((id: string) => { images.add(id); }),
      updateImage: vi.fn(),
    };
  };

  beforeEach(() => {
    painted = { fills: [] };
    const ctx = new Proxy({}, {
      get: () => vi.fn(),
      set: (_t, key, value) => { if (key === 'fillStyle') painted.fills.push(String(value)); return true; },
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,');
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null;
      set src(_: string) { queueMicrotask(() => this.onload?.()); }
    });
    useMapStyleStore.setState({ activeStyleId: 'auto' } as never);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    useThemeStore.setState({ theme: 'dark' } as never);
  });

  it('paints the tones of the dark map once, and does nothing while they hold', async () => {
    useThemeStore.setState({ theme: 'dark' } as never);
    const map = fakeMap();
    await registerWindArrowIcons(map as never);
    expect(map.addImage).toHaveBeenCalledTimes(WIND_TONES_ON_DARK.length);
    for (const tone of WIND_TONES_ON_DARK) expect(painted.fills).toContain(tone);
    painted.fills.length = 0;
    await registerWindArrowIcons(map as never);
    expect(map.updateImage).not.toHaveBeenCalled();
    expect(painted.fills).toHaveLength(0);
  });

  it('repaints them when the map under them changes: no arrow keeps the palette of the map before', async () => {
    useThemeStore.setState({ theme: 'dark' } as never);
    const map = fakeMap();
    await registerWindArrowIcons(map as never);
    painted.fills.length = 0;
    useThemeStore.setState({ theme: 'light' } as never);
    await registerWindArrowIcons(map as never);
    expect(map.updateImage).toHaveBeenCalledTimes(WIND_TONES_ON_LIGHT.length);
    for (const tone of WIND_TONES_ON_LIGHT) expect(painted.fills).toContain(tone);
  });
});

describe('speedToLevel', () => {
  const kt = (k: number) => k / 1.94384;
  it('follows the map scale, the same cuts as a spot', () => {
    expect(speedToLevel(0)).toBe(0);
    expect(speedToLevel(kt(5))).toBe(0);
    expect(speedToLevel(kt(6))).toBe(1);
    expect(speedToLevel(kt(8))).toBe(2);
    expect(speedToLevel(kt(12))).toBe(3);
    expect(speedToLevel(kt(18))).toBe(4);
    // Past the verdict, two more (18-nov): 22 kt and 34 kt
    expect(speedToLevel(kt(22))).toBe(5);
    expect(speedToLevel(kt(40))).toBe(6);
  });

  it('one icon per step', () => {
    expect(SPEED_LEVELS.length).toBe(9);
    expect(SPEED_LEVELS[0].id).toBe('wind-arrow-0');
  });
});

describe('buildWindFieldGeoJSON', () => {
  it('emits 6 arrow features for a calm station (speed 0, dir null)', () => {
    const station = mockStation('st1');
    const reading = mockReading('st1', 0, null);
    const stations = [station];
    const readings = new Map([['st1', reading]]);

    const fc = buildWindFieldGeoJSON(stations, readings, undefined, false, 11);
    expect(fc.features.length).toBe(6);

    // All 6 should be level 0 (calm) and have finite coordinates and radial rotations
    for (const f of fc.features) {
      expect(f.properties?.speedLevel).toBe(0);
      expect(f.properties?.speed).toBe(0);
      const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates;
      expect(Number.isFinite(lon)).toBe(true);
      expect(Number.isFinite(lat)).toBe(true);
      expect(Number.isFinite(f.properties?.rotation)).toBe(true);
    }
  });

  it('emits no arrows for a station with wind but no vane (a star would invent a direction)', () => {
    const station = mockStation('barro');
    const reading = mockReading('barro', 0.57, null); // 1.1 kt, Netatmo without vane
    const fc = buildWindFieldGeoJSON([station], new Map([['barro', reading]]), undefined, false, 11);
    expect(fc.features.length).toBe(0);
  });

  it('emits 6 arrow features for a normal wind reading rotated meteorological + 180', () => {
    const station = mockStation('st2', -8.5, 42.4);
    const reading = mockReading('st2', 6.0, 90); // 90° East wind
    const stations = [station];
    const readings = new Map([['st2', reading]]);

    const fc = buildWindFieldGeoJSON(stations, readings, undefined, false, 11);
    expect(fc.features.length).toBe(6);

    for (const f of fc.features) {
      expect(f.properties?.speed).toBe(6.0);
      expect(f.properties?.speedLevel).toBe(3); // 6.0 m/s -> level 3 (lime-500)
      // Rotation: (90 + 180) % 360 = 270 (pointing West, towards where wind blows)
      expect(f.properties?.rotation).toBe(270);
    }
  });

  it('scales geographic offset inversely with zoom to maintain constant pixel distance', () => {
    const station = mockStation('st3', -8.0, 42.0);
    const reading = mockReading('st3', 5.0, 0);
    const stations = [station];
    const readings = new Map([['st3', reading]]);

    const fcZoom11 = buildWindFieldGeoJSON(stations, readings, undefined, false, 11);
    const fcZoom14 = buildWindFieldGeoJSON(stations, readings, undefined, false, 14);
    const fcZoom9 = buildWindFieldGeoJSON(stations, readings, undefined, false, 9);

    // Arrow 0 (offset [0, 1] North)
    const lat11 = (fcZoom11.features[0].geometry as GeoJSON.Point).coordinates[1];
    const lat14 = (fcZoom14.features[0].geometry as GeoJSON.Point).coordinates[1];
    const lat9 = (fcZoom9.features[0].geometry as GeoJSON.Point).coordinates[1];

    const dLat11 = lat11 - 42.0;
    const dLat14 = lat14 - 42.0;
    const dLat9 = lat9 - 42.0;

    // Zoom 14 has scale 2^(11-14) = 1/8 of zoom 11
    expect(dLat14).toBeCloseTo(dLat11 * 0.125, 6);
    // Zoom 9 has scale 2^(11-9) = 4x of zoom 11
    expect(dLat9).toBeCloseTo(dLat11 * 4.0, 6);
  });

  it('preserves hourly stations (50 min old) instead of dropping them at 30 min', () => {
    const station = mockStation('st_hourly');
    const reading = mockReading('st_hourly', 4.0, 180, 50); // 50 min old
    const stations = [station];
    const readings = new Map([['st_hourly', reading]]);

    const fc = buildWindFieldGeoJSON(stations, readings, undefined, false, 11);
    expect(fc.features.length).toBe(6);
    // Freshness alpha is decayed (0.65)
    expect(fc.features[0].properties?.opacity).toBeCloseTo(0.75 * 0.65, 2);
  });

  it('discards genuinely stale stations (>90 min old)', () => {
    const station = mockStation('st_stale');
    const reading = mockReading('st_stale', 4.0, 180, 100); // 100 min old
    const stations = [station];
    const readings = new Map([['st_stale', reading]]);

    const fc = buildWindFieldGeoJSON(stations, readings, undefined, false, 11);
    expect(fc.features.length).toBe(0);
  });

  it('skips tempOnly and blacklisted stations', () => {
    const stationTempOnly = mockStation('st_temp', -8.7, 42.2, { tempOnly: true });
    const readingTemp = mockReading('st_temp', 5.0, 180);

    const stationBlacklisted = mockStation('wu_IVIGO48', -8.7, 42.2); // Known blacklisted
    const readingBlacklisted = mockReading('wu_IVIGO48', 5.0, 180);

    const stations = [stationTempOnly, stationBlacklisted];
    const readings = new Map([
      ['st_temp', readingTemp],
      ['wu_IVIGO48', readingBlacklisted],
    ]);

    const fc = buildWindFieldGeoJSON(stations, readings, undefined, false, 11);
    expect(fc.features.length).toBe(0);
  });

  it('suppresses wind arrows for stations grouped into clusters below zoom 9.5', () => {
    // Two stations very close to each other (<1km)
    const stA = mockStation('st_close_a', -8.70, 42.20);
    const stB = mockStation('st_close_b', -8.705, 42.205);
    const stations = [stA, stB];
    const readings = new Map([
      ['st_close_a', mockReading('st_close_a', 5.0, 180)],
      ['st_close_b', mockReading('st_close_b', 6.0, 190)],
    ]);

    // At zoom 11 (above 9.5 threshold): NO clustering, both stations emit 6 arrows each = 12
    const fcZoom11 = buildWindFieldGeoJSON(stations, readings, undefined, false, 11);
    expect(fcZoom11.features.length).toBe(12);

    // At zoom 9.0 (below 9.5 threshold): clustered together, so 0 standalone arrows emitted
    const fcZoom9 = buildWindFieldGeoJSON(stations, readings, undefined, false, 9.0);
    expect(fcZoom9.features.length).toBe(0);
  });

  it('emits wind arrows for isolated standalone stations even at zoom 9', () => {
    // Single isolated station (no neighbors within cluster radius)
    const st = mockStation('st_isolated', -8.70, 42.20);
    const stations = [st];
    const readings = new Map([['st_isolated', mockReading('st_isolated', 3.5, 90)]]);

    const fcZoom9 = buildWindFieldGeoJSON(stations, readings, undefined, false, 9.0);
    expect(fcZoom9.features.length).toBe(6);
  });
});

describe('simple mode: smaller and fainter arrows, with their colour', () => {
  it('only fades them: the colour of the speed stays', () => {
    const muted = arrowOpacity(true) as unknown[];
    expect(muted[0]).toBe('*');
    expect(muted[1]).toBe(MUTED_ARROW_OPACITY);
    expect(muted[2]).toEqual(arrowOpacity(false));
    expect(MUTED_ARROW_OPACITY).toBeLessThan(1);
  });

  it('scales every stop of the zoom curve, and leaves the curve outermost', () => {
    const muted = arrowSize(WIND_ARROW_ICON_SIZE_REGULAR, true) as unknown[];
    const base = WIND_ARROW_ICON_SIZE_REGULAR as unknown[];
    expect(muted.slice(0, 3)).toEqual(base.slice(0, 3));
    for (let i = 3; i < base.length; i += 2) {
      expect(muted[i]).toBe(base[i]);
      expect(muted[i + 1]).toEqual(['*', MUTED_ARROW_SCALE, base[i + 1]]);
    }
    expect(arrowSize(WIND_ARROW_ICON_SIZE_REGULAR, false)).toBe(WIND_ARROW_ICON_SIZE_REGULAR);
  });

  it('is a valid style in both modes and both densities', () => {
    for (const muted of [false, true]) {
      for (const base of [WIND_ARROW_ICON_SIZE_REGULAR, WIND_ARROW_ICON_SIZE_COMPACT]) {
        const errors = validateStyleMin({
          version: 8,
          sources: { 'wind-field': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
          layers: [{
            id: 'wind-field-arrows',
            type: 'symbol',
            source: 'wind-field',
            minzoom: 8,
            layout: {
              'icon-image': ['concat', 'wind-arrow-', ['to-string', ['get', 'speedLevel']]],
              'icon-rotate': ['get', 'rotation'],
              'icon-size': arrowSize(base, muted),
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
              'icon-rotation-alignment': 'map',
            },
            paint: { 'icon-opacity': arrowOpacity(muted) },
          }],
        } as never);
        expect(errors.map((e) => e.message)).toEqual([]);
      }
    }
  });
});

describe('WindFieldOverlay MapLibre style spec validation', () => {
  it('validates regular and compact icon-size expressions against style-spec without errors', () => {
    for (const [name, iconSize] of [
      ['regular', WIND_ARROW_ICON_SIZE_REGULAR],
      ['compact', WIND_ARROW_ICON_SIZE_COMPACT],
    ] as const) {
      const dummyStyle = {
        version: 8,
        sources: {
          'wind-field': {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          },
        },
        layers: [
          {
            id: `wind-field-arrows-${name}`,
            type: 'symbol',
            source: 'wind-field',
            minzoom: 8,
            layout: {
              'icon-image': ['concat', 'wind-arrow-', ['to-string', ['get', 'speedLevel']]],
              'icon-rotate': ['get', 'rotation'],
              'icon-size': iconSize,
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
              'icon-rotation-alignment': 'map',
            },
            paint: {
              'icon-opacity': [
                'interpolate', ['linear'], ['get', 'speed'],
                0, 0.45,
                2, 0.6,
                5, 0.75,
                10, 0.9,
              ],
            },
          },
        ],
      };

      const errors = validateStyleMin(dummyStyle);
      expect(errors, `Style spec validation failed for ${name}: ${errors.map(e => e.message).join('; ')}`).toHaveLength(0);
    }
  });
});
