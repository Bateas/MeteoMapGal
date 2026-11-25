/**
 * Historial: mirar atrás en una estación o una boya. The sentence first and the chart under it; then the
 * magnitudes that station or buoy really sent, each with its range, and tapping one draws it. What it does
 * not measure is not offered.
 */

import { memo, useState, useEffect, useMemo, useRef } from 'react';
import {
  fetchHistoryStations,
  fetchReadings,
  fetchCompare,
  fetchBuoyStations,
  fetchBuoyReadings,
  type HistoryStation,
} from '../../api/historyClient';
import { RIAS_BUOY_STATIONS } from '../../api/buoyClient';
import { isCoastalSector } from '../../config/sectors';
import { HistoryChart } from '../charts/HistoryChart';
import {
  availableMetrics, BUOY_METRICS, GAUGE_METRICS, historySentence, parseDbTime, rangeWords, seriesOf, STATION_METRICS,
  type HistoryMetric, type HistoryRow,
} from '../../services/historySeries';
import { useWeatherStore } from '../../store/weatherStore';
import { useWeatherSelectionStore } from '../../store/weatherSelectionStore';
import { useBuoyStore } from '../../store/buoyStore';
import { useSectorStore } from '../../store/sectorStore';
import { useUIStore } from '../../store/uiStore';

type TimeRange = '24h' | '7d' | '30d' | 'custom';

const TIME_RANGES: { key: TimeRange; label: string; hours: number; words: string }[] = [
  { key: '24h', label: '24 h', hours: 24, words: 'En 24 h' },
  { key: '7d', label: '7 días', hours: 168, words: 'En 7 días' },
  { key: '30d', label: '30 días', hours: 720, words: 'En 30 días' },
];
const CUSTOM_WORDS = 'En esas fechas';
/** Up to two days the readings go one by one; further, the hourly aggregates */
const RAW_MAX_MS = 2 * 86_400_000;
/** The aggregates of the buoys keep no salinity: asked in full, the list fits within this */
const BUOY_RAW_LIMIT = 10_000;
/** A tide gauge reads every minute: over a day it would not fit, and it has no salinity to lose */
const MINUTE_BUOY_TYPES = new Set(['REDMAR']);

interface Option {
  id: string;
  name: string;
}

const isBuoyId = (id: string) => id.startsWith('buoy_');
const buoyNumber = (id: string) => parseInt(id.replace('buoy_', ''), 10);
const isGauge = (id: string) => MINUTE_BUOY_TYPES.has(RIAS_BUOY_STATIONS.find((b) => b.id === buoyNumber(id))?.type ?? '');

const dateOf = (t: number) => new Date(t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
const timeOf = (t: number) => new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const formatAxis = (t: number, withDay: boolean) => (withDay ? `${dateOf(t)}, ${timeOf(t)}` : timeOf(t));
const formatAxisDay = (t: number, withDay: boolean) => (withDay ? dateOf(t) : timeOf(t));

export const HistoryDashboard = memo(function HistoryDashboard() {
  // External selection (popup «Ver historial» or a click on the map)
  const historyStationId = useWeatherSelectionStore((s) => s.historyStationId);
  const mapStationId = useWeatherSelectionStore((s) => s.selectedStationId);
  const selectStation = useWeatherSelectionStore((s) => s.selectStation);
  const selectBuoy = useBuoyStore((s) => s.selectBuoy);
  const liveStations = useWeatherStore((s) => s.stations);
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const coastal = isCoastalSector(sectorId);

  const [dbStations, setDbStations] = useState<HistoryStation[]>([]);
  const [buoys, setBuoys] = useState<HistoryStation[]>([]);
  const [buoyNames, setBuoyNames] = useState<Map<string, string>>(new Map());
  const [selected, setSelected] = useState('');
  const [metricKey, setMetricKey] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [compareRows, setCompareRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareId, setCompareId] = useState('');

  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 3);
    return d.toISOString().slice(0, 10);
  });
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10));
  /** The range drawn: fixed when the data is asked for, so the axis and the data agree */
  const [span, setSpan] = useState<{ from: number; to: number }>({ from: 0, to: 0 });

  // The stations of the sector by name, and the buoys once each: the list has a row per buoy and SOURCE.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchHistoryStations(),
      fetchBuoyStations().catch(() => []),
    ]).then(([stationList, buoyList]) => {
      if (cancelled) return;
      setDbStations(stationList);
      const merged = new Map<number, HistoryStation>();
      const names = new Map<string, string>();
      for (const b of buoyList) {
        const id = `buoy_${b.station_id}`;
        names.set(id, b.station_name || `Boya ${b.station_id}`);
        const prev = merged.get(b.station_id);
        const lastReading = !prev?.last_reading || (b.last_reading ?? '') > prev.last_reading ? b.last_reading : prev.last_reading;
        merged.set(b.station_id, { station_id: id, source: b.source, last_reading: lastReading, reading_count: (prev?.reading_count ?? 0) + b.reading_count });
      }
      setBuoys([...merged.values()]);
      setBuoyNames(names);
    }).catch((err) => {
      if (!cancelled) setError((err as Error).message);
    });
    return () => { cancelled = true; };
  }, []);

  const stationOptions = useMemo<Option[]>(() => {
    const inDb = new Set(dbStations.map((s) => s.station_id));
    return liveStations
      .filter((s) => inDb.has(s.id))
      .map((s) => ({ id: s.id, name: s.name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [dbStations, liveStations]);

  const buoyOptions = useMemo<Option[]>(() => (
    coastal
      ? buoys
          .map((b) => ({ id: b.station_id, name: buoyNames.get(b.station_id) ?? b.station_id }))
          .sort((a, b) => a.name.localeCompare(b.name, 'es'))
      : []
  ), [buoys, buoyNames, coastal]);

  const nameOf = (id: string) => (
    stationOptions.find((o) => o.id === id)?.name
    ?? buoyNames.get(id)
    ?? liveStations.find((s) => s.id === id)?.name
    ?? id
  );

  // An external request wins. Otherwise the station chosen on the map, or the first of the sector.
  useEffect(() => {
    if (!historyStationId) return;
    setSelected(historyStationId);
    useWeatherSelectionStore.getState().openHistory('');
  }, [historyStationId]);

  useEffect(() => {
    const known = (id: string) => stationOptions.some((o) => o.id === id) || buoyOptions.some((o) => o.id === id);
    if (selected && (known(selected) || stationOptions.length === 0)) return;
    if (historyStationId) return;
    const pick = mapStationId && known(mapStationId) ? mapStationId : stationOptions[0]?.id ?? buoyOptions[0]?.id;
    // Only if nobody chose meanwhile: this effect can run right after a choice, still holding the old value
    if (pick) setSelected((current) => (current === selected ? pick : current));
  }, [selected, stationOptions, buoyOptions, mapStationId, historyStationId]);

  const isBuoy = isBuoyId(selected);
  const table = isBuoy ? (isGauge(selected) ? GAUGE_METRICS : BUOY_METRICS) : STATION_METRICS;
  const compareActive = compareOpen && !isBuoy && !!compareId && compareId !== selected;

  // Ask for the data. A slower answer to an older question does not overwrite a newer one.
  const requestRef = useRef(0);
  useEffect(() => {
    if (!selected) return;
    const request = ++requestRef.current;
    const range = TIME_RANGES.find((r) => r.key === timeRange);
    const to = range ? Date.now() : new Date(`${customTo}T23:59:59`).getTime();
    const from = range ? to - range.hours * 3_600_000 : new Date(`${customFrom}T00:00:00`).getTime();
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
      setRows([]);
      setError('Revisa las fechas: la primera tiene que ser anterior a la segunda.');
      // The request this one replaces will not clear it (it is no longer the current one): without this the panel
      // stayed on «Cargando…» and the reason never showed.
      setLoading(false);
      return;
    }
    const fromIso = new Date(from).toISOString();
    const toIso = new Date(to).toISOString();
    const interval = to - from <= RAW_MAX_MS ? 'raw' as const : 'hourly' as const;

    let main: Promise<HistoryRow[]>;
    if (isBuoyId(selected)) {
      const hourly = isGauge(selected) && interval === 'hourly';
      main = fetchBuoyReadings(buoyNumber(selected), fromIso, toIso, hourly ? { interval } : { limit: BUOY_RAW_LIMIT });
    } else {
      main = fetchReadings(selected, fromIso, toIso, interval);
    }
    const second: Promise<HistoryRow[]> = compareActive
      ? fetchCompare([selected, compareId], fromIso, toIso, interval)
          .then((all) => (all as { station_id: string }[]).filter((r) => r.station_id === compareId))
          .catch(() => [])
      : Promise.resolve([]);

    setLoading(true);
    setError(null);
    Promise.all([main, second]).then(([data, other]) => {
      if (request !== requestRef.current) return;
      setRows(data);
      setCompareRows(other);
      setSpan({ from, to });
    }).catch((err) => {
      if (request !== requestRef.current) return;
      setRows([]);
      setCompareRows([]);
      setSpan({ from, to });
      setError((err as Error).message);
    }).finally(() => {
      if (request === requestRef.current) setLoading(false);
    });
  }, [selected, timeRange, customFrom, customTo, compareActive, compareId]);

  const metrics = useMemo(() => availableMetrics(rows, table), [rows, table]);
  // The magnitude asked for if this station has it. Otherwise the first it has: wind, or the sea on a buoy.
  const metric: HistoryMetric | null = metrics.find((m) => m.key === metricKey) ?? metrics[0] ?? null;
  const series = useMemo(() => (metric ? seriesOf(rows, metric) : []), [rows, metric]);
  const compareSeries = useMemo(() => (metric ? seriesOf(compareRows, metric) : []), [compareRows, metric]);

  const periodWords = TIME_RANGES.find((r) => r.key === timeRange)?.words ?? CUSTOM_WORDS;
  const sentence = metric ? historySentence(series, metric, periodWords, Date.now()) : null;
  const sentenceWithName = metric && sentence ? `${metric.label}. ${sentence}` : null;
  const multiDay = span.to - span.from > 26 * 3_600_000;

  const lastReading = (isBuoy ? buoys : dbStations).find((s) => s.station_id === selected)?.last_reading;

  const onChoose = (id: string) => {
    setSelected(id);
    // On a phone the map is under this panel, and selecting a station closes the panel (AppShell): the
    // person was choosing what to read here.
    if (useUIStore.getState().isMobile) return;
    if (isBuoyId(id)) selectBuoy(buoyNumber(id));
    else selectStation(id);
  };

  return (
    <div className="gc-hist">
      <select
        value={selected}
        onChange={(e) => onChoose(e.target.value)}
        className="gc-select"
        aria-label="Estación o boya"
      >
        {selected && !stationOptions.some((o) => o.id === selected) && !buoyOptions.some((o) => o.id === selected) && (
          <option value={selected}>{nameOf(selected)}</option>
        )}
        {stationOptions.length > 0 && (
          <optgroup label="Estaciones">
            {stationOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </optgroup>
        )}
        {buoyOptions.length > 0 && (
          <optgroup label="Boyas">
            {buoyOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </optgroup>
        )}
      </select>

      <div className="gc-seg gc-seg--fill" role="group" aria-label="Periodo">
        {TIME_RANGES.map((r) => (
          <button key={r.key} type="button" aria-pressed={timeRange === r.key} onClick={() => setTimeRange(r.key)}>{r.label}</button>
        ))}
        <button type="button" aria-pressed={timeRange === 'custom'} onClick={() => setTimeRange('custom')}>Fechas</button>
      </div>

      {timeRange === 'custom' && (
        <div className="gc-histdates">
          <label>Desde<input type="date" className="gc-field" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} /></label>
          <label>Hasta<input type="date" className="gc-field" value={customTo} onChange={(e) => setCustomTo(e.target.value)} /></label>
        </div>
      )}

      <div className="gc-histbody" aria-busy={loading}>
        {loading && rows.length === 0 && <p className="gc-small" role="status">Cargando…</p>}

        {!loading && error && <p className="gc-histline" role="alert" title={error}>No se pudo cargar el historial. Prueba en un rato.</p>}

        {!loading && !error && selected && rows.length > 0 && metrics.length === 0 && (
          <p className="gc-histline">{nameOf(selected)} no ha enviado ningún dato útil en este periodo.</p>
        )}

        {!loading && !error && selected && rows.length === 0 && (
          <div className="gc-histempty">
            <p className="gc-histline">{nameOf(selected)} no ha enviado datos en este periodo.</p>
            <p className="gc-small">
              {lastReading
                ? `Su última lectura es del ${dateOf(parseDbTime(lastReading))}, a las ${timeOf(parseDbTime(lastReading))}.`
                : 'No consta ninguna lectura suya en los últimos 7 días.'}
            </p>
          </div>
        )}

        {metric && sentence && (
          <>
            <p className="gc-histline"><b>{metric.label}.</b> {sentence}</p>
            <HistoryChart
              series={series}
              compare={compareActive ? compareSeries : []}
              metric={metric}
              fromMs={span.from}
              toMs={span.to}
              label={sentenceWithName ?? metric.label}
              formatTime={multiDay ? formatAxisDay : formatAxis}
            />
            {compareActive && (
              <p className="gc-small">Línea de puntos: {nameOf(compareId)}{compareSeries.length === 0 ? ', sin este dato en el periodo' : ''}.</p>
            )}
          </>
        )}

        {metrics.length > 0 && (
          <ul className="gc-list" aria-label="Lo que mide">
            {metrics.map((m) => {
              const words = rangeWords(seriesOf(rows, m), m);
              return (
                <li key={m.key} className="gc-listrow" data-current={m.key === metric?.key ? '' : undefined}>
                  <button type="button" className="gc-rowbtn gc-rowbtn--metric" aria-pressed={m.key === metric?.key} onClick={() => setMetricKey(m.key)}>
                    <span className="gc-rowname">{m.label}</span>
                    <span className="gc-rowval">{words}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* The rarer question, at the end. Only stations: the service compares those. */}
      {!isBuoy && selected && (
        <div className="gc-histcompare">
          <button
            type="button"
            className="gc-btn gc-btn--plain"
            aria-expanded={compareOpen}
            onClick={() => { setCompareOpen((v) => !v); setCompareId(''); }}
          >
            {compareOpen ? 'Quitar la comparación' : 'Comparar con otra estación'}
          </button>
          {compareOpen && (
            <select value={compareId} onChange={(e) => setCompareId(e.target.value)} className="gc-select" aria-label="Segunda estación">
              <option value="">Elige la segunda estación</option>
              {stationOptions.filter((o) => o.id !== selected).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
        </div>
      )}
    </div>
  );
});
