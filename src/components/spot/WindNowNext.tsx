/**
 * The predictive part of a spot's card: measured wind, the mark of now, and what the model gives, on one axis.
 * Measured is a solid line, the model a dotted one, a gap stays a gap; the words go beside them, because a
 * line style alone says nothing to someone who has not been told.
 */
import { useEffect, useMemo, useState } from 'react';
import { buildWindAxis, windHeadline, modelGapWords, NEXT_H, PAST_H, type AxisPoint } from './windAxis';
import { WindPlot, type PlotStop } from './WindPlot';
import type { HourlyForecast } from '../../types/forecast';

/** Two stored scores further apart than this are a gap in the line, not a straight stretch of wind. */
const MEASURED_GAP_MS = 45 * 60_000;
/** The model comes by the hour, and sometimes by the three hours further out. */
const MODEL_GAP_MS = 4 * 3_600_000;
const CACHE_MS = 5 * 60_000;

const cache = new Map<string, { at: number; request: Promise<AxisPoint[]> }>();

/** The spot's stored figures for the hours drawn. One request per spot and five minutes, however often it opens. */
function measuredWind(spotId: string): Promise<AxisPoint[]> {
  const hit = cache.get(spotId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.request;
  const request = fetch(`/api/v1/spots/scores?spot_id=${encodeURIComponent(spotId)}&days=1&hours=${PAST_H}`)
    .then((r) => (r.ok ? r.json() : { scores: [] }))
    .then((d: { scores?: { time: string; wind_kt: number | null }[] }) =>
      (d.scores ?? [])
        .filter((s) => s.wind_kt != null)
        .map((s) => ({ t: new Date(s.time).getTime(), kt: s.wind_kt as number })),
    )
    .catch(() => {
      cache.delete(spotId);
      return [] as AxisPoint[];
    });
  cache.set(spotId, { at: Date.now(), request });
  return request;
}

export function __clearWindNowNextCacheForTests() {
  cache.clear();
}

export function WindNowNext({ spotId, forecast, nowKt }: { spotId: string; forecast: HourlyForecast[]; nowKt: number }) {
  const [past, setPast] = useState<AxisPoint[]>([]);
  useEffect(() => {
    let stale = false;
    void measuredWind(spotId).then((points) => { if (!stale) setPast(points); });
    return () => { stale = true; };
  }, [spotId]);

  const axis = useMemo(() => buildWindAxis(past, forecast, nowKt, Date.now()), [past, forecast, nowKt]);
  if (axis.model.length < 2) return null;

  const mark = axis.measured[axis.measured.length - 1].t;
  const markPct = ((mark - axis.from) / (axis.to - axis.from)) * 100;
  const hhmm = (t: number) => new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const stops: PlotStop[] = [
    ...axis.measured.map((p) => ({
      t: p.t,
      kt: p.kt,
      value: `${Math.round(p.kt)} kt`,
      note: p.t === mark ? 'ahora, medido' : `${hhmm(p.t)}, medido`,
    })),
    ...axis.model.filter((p) => p.t > mark).map((p) => ({
      t: p.t,
      kt: p.kt,
      value: `${Math.round(p.kt)} kt`,
      note: `${hhmm(p.t)}, modelo`,
    })),
  ];
  const headline = windHeadline(axis, nowKt, Date.now());
  const outlook = headline.text;
  // Said in the sentence above when it is big enough to silence the model: once is enough.
  const gapWords = headline.gapSaid ? '' : modelGapWords(nowKt, axis.modelNowKt);

  return (
    <div className="gf-sec">
      <p className="gf-axisay">{outlook}</p>
      <WindPlot
        from={axis.from}
        to={axis.to}
        mark={mark}
        series={[
          { points: axis.model, kind: 'dotted', gapMs: MODEL_GAP_MS },
          { points: axis.measured, kind: 'main', gapMs: MEASURED_GAP_MS },
        ]}
        stops={stops}
        label={`Viento medido y previsto. ${outlook}`}
        foot={(
          <>
            <span>−{PAST_H} h</span>
            <span style={{ position: 'absolute', left: `${markPct}%`, transform: 'translateX(-50%)' }}>ahora</span>
            <span>+{NEXT_H} h</span>
          </>
        )}
      />
      <div className="gf-hint gf-axislegend">
        <span><i className="gf-swatch" /> medido</span>
        <span><i className="gf-swatch gf-swatch--model" /> modelo</span>
        {gapWords && <span>{gapWords}</span>}
      </div>
    </div>
  );
}
