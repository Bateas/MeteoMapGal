/**
 * `?simrain`: synthetic rain for checking the rain layer on a dry day. Debug only, same idea as
 * `?simstrike=` and `?simfog=`: it never runs without the parameter.
 *  - `?simrain=1`: a band ~40 km long crossing towards the north-east at ~30 km/h, its leading
 *    edge a little short of the sector centre; gauges under >= 25 dBZ read rain.
 *  - `?simrain=lejos`: the same kind of band still ~60 km out, coming at ~35 km/h with no gauge
 *    under it yet (the case the radar must announce on its own), plus a fixed echo that never
 *    moves, which must be neither drawn nor announced.
 * Ten frames 10 min apart in both.
 */

import { assembleMosaic, kmPerPx, lonLatToPx, maxDbzNear, type RadarMosaic } from './radarDecode';
import type { GaugeRain } from './rainNowService';
import { isOfficialGauge } from './rainNowService';
import type { NormalizedStation } from '../types/station';

const BLOCK = { x0: 60, y0: 46, nx: 2, ny: 2 };

export type SimRainMode = 'cerca' | 'lejos';

export function simRainMode(): SimRainMode | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = new URLSearchParams(window.location.search).get('simrain');
    if (v === null) return null;
    return v === 'lejos' ? 'lejos' : 'cerca';
  } catch { return null; }
}

export function isSimRain(): boolean {
  return simRainMode() !== null;
}

/** Ten frames ending ~5 min before `nowSec`. */
export function simRainFrames(center: { lon: number; lat: number }, nowSec: number, mode: SimRainMode = 'cerca'): RadarMosaic[] {
  const probe = assembleMosaic([], BLOCK, 0);
  const kpp = kmPerPx(probe, center.lat);
  const [cx, cy] = lonLatToPx(probe, center.lon, center.lat);
  const far = mode === 'lejos';
  const toRad = ((far ? 70 : 45) * Math.PI) / 180;
  const ux = Math.sin(toRad), uy = -Math.cos(toRad);       // motion unit vector, pixels (y south)
  const kmh = far ? 35 : 30;
  const stepPx = (kmh / 6) / kpp;                           // per 10 min
  const behindKm = far ? 60 : 18;                           // band centre behind the sector centre at the newest frame
  const frames: RadarMosaic[] = [];
  for (let i = 0; i < 10; i++) {
    const back = 9 - i;
    const t = nowSec - 300 - back * 600;
    const m = assembleMosaic([], BLOCK, t);
    const bx = cx - ux * ((behindKm / kpp) + back * stepPx);
    const by = cy - uy * ((behindKm / kpp) + back * stepPx);
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
    if (far) {
      // A fixed echo 25 km south-east of the centre, the same in every frame (~60 px, 24 dBZ).
      const fx = Math.round(cx + (18 / kpp)), fy = Math.round(cy + (18 / kpp));
      for (let y = fy - 4; y <= fy + 4; y++) for (let x = fx - 4; x <= fx + 4; x++) {
        if ((x - fx) ** 2 + (y - fy) ** 2 <= 18) m.dbz[y * m.w + x] = 24;
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
