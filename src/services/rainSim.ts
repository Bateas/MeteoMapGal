/**
 * `?simrain=1`: a synthetic band of rain for checking the rain layer on a dry day. A band ~40 km
 * long crossing towards the north-east at ~30 km/h, ten frames 10 min apart, its leading edge a
 * little short of the sector centre at the newest frame; gauges under >= 25 dBZ read rain. Debug
 * only, same idea as `?simstrike=` and `?simfog=`: it never runs without the parameter.
 */

import { assembleMosaic, kmPerPx, lonLatToPx, maxDbzNear, type RadarMosaic } from './radarDecode';
import type { GaugeRain } from './rainNowService';
import { isOfficialGauge } from './rainNowService';
import type { NormalizedStation } from '../types/station';

const BLOCK = { x0: 60, y0: 46, nx: 2, ny: 2 };

export function isSimRain(): boolean {
  if (typeof window === 'undefined') return false;
  try { return new URLSearchParams(window.location.search).has('simrain'); } catch { return false; }
}

/** Ten frames ending ~5 min before `nowSec`, the band moving towards 45° at 30 km/h. */
export function simRainFrames(center: { lon: number; lat: number }, nowSec: number): RadarMosaic[] {
  const probe = assembleMosaic([], BLOCK, 0);
  const kpp = kmPerPx(probe, center.lat);
  const [cx, cy] = lonLatToPx(probe, center.lon, center.lat);
  const toRad = (45 * Math.PI) / 180;
  const ux = Math.sin(toRad), uy = -Math.cos(toRad);       // motion unit vector, pixels (y south)
  const stepPx = (30 / 6) / kpp;                            // 5 km per 10 min
  const frames: RadarMosaic[] = [];
  for (let i = 0; i < 10; i++) {
    const back = 9 - i;
    const t = nowSec - 300 - back * 600;
    const m = assembleMosaic([], BLOCK, t);
    // band centre: 18 km behind the sector centre at the newest frame, minus the travel since
    const bx = cx - ux * ((18 / kpp) + back * stepPx);
    const by = cy - uy * ((18 / kpp) + back * stepPx);
    const halfLen = 20 / kpp, halfWid = 6 / kpp;
    for (let y = Math.floor(by - halfLen - 2); y <= by + halfLen + 2; y++) {
      for (let x = Math.floor(bx - halfLen - 2); x <= bx + halfLen + 2; x++) {
        if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
        const dx = x - bx, dy = y - by;
        const along = dx * ux + dy * uy;                     // across the band's width (it moves along its normal)
        const across = -dx * uy + dy * ux;                   // along the band
        const d = (along / halfWid) ** 2 + (across / halfLen) ** 2;
        if (d < 1) m.dbz[y * m.w + x] = Math.round(44 - 24 * d);
      }
    }
    frames.push(m);
  }
  return frames;
}

/** Gauges as the synthetic radar would wet them. */
export function simGauges(stations: NormalizedStation[], newest: RadarMosaic): GaugeRain[] {
  return stations.map((s) => {
    const dbz = maxDbzNear(newest, s.lon, s.lat, 1);
    const wet = dbz >= 25;
    return {
      id: s.id, name: s.name, lon: s.lon, lat: s.lat, official: isOfficialGauge(s.id),
      mm: wet ? Math.round((dbz - 20) / 4) / 2 : 0, verdict: wet ? 'rain' : 'dry', radarDbz: dbz,
    };
  });
}
