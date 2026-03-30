/**
 * Best days search UI — search AEMET history with configurable criteria.
 */

import { useState, useMemo, useCallback } from 'react';
import type { DaySearchCriteria, DaySearchResult } from '../../types/campo';
import type { ParsedDay } from '../../services/aemetHistoryParser';
import { searchBestDays } from '../../services/bestDaysSearch';
import { degreesToCardinal, msToKnots } from '../../services/windUtils';

interface BestDaysSearchProps {
  records: ParsedDay[];
}

const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const WIND_DIRS = [
  { label: 'N', from: 337.5, to: 22.5 },
  { label: 'NE', from: 22.5, to: 67.5 },
  { label: 'E', from: 67.5, to: 112.5 },
  { label: 'SE', from: 112.5, to: 157.5 },
  { label: 'S', from: 157.5, to: 202.5 },
  { label: 'SW', from: 202.5, to: 247.5 },
  { label: 'W', from: 247.5, to: 292.5 },
  { label: 'NW', from: 292.5, to: 337.5 },
];

export function BestDaysSearch({ records }: BestDaysSearchProps) {
  const [minTemp, setMinTemp] = useState<number | undefined>(25);
  const [maxTemp, setMaxTemp] = useState<number | undefined>(undefined);
  const [selectedDir, setSelectedDir] = useState<string>('SW');
  const [maxPrecip, setMaxPrecip] = useState<number | undefined>(0);
  const [months, setMonths] = useState<number[]>([6, 7, 8, 9]);
  const [results, setResults] = useState<DaySearchResult[]>([]);
  const [searched, setSearched] = useState(false);

  const criteria = useMemo((): DaySearchCriteria => {
    const dirConfig = WIND_DIRS.find((d) => d.label === selectedDir);
    return {
      minTemp,
      maxTemp,
      windDirFrom: dirConfig?.from,
      windDirTo: dirConfig?.to,
      maxPrecip,
      months: months.length > 0 ? months : undefined,
    };
  }, [minTemp, maxTemp, selectedDir, maxPrecip, months]);

  const doSearch = useCallback(() => {
    const res = searchBestDays(records, criteria);
    setResults(res);
    setSearched(true);
  }, [records, criteria]);

  const toggleMonth = (m: number) => {
    setMonths((prev) => prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]);
  };

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
        Buscar Mejores Días
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[11px] text-slate-500">Temp min °C</label>
          <input
            type="number"
            value={minTemp ?? ''}
            onChange={(e) => setMinTemp(e.target.value ? Number(e.target.value) : undefined)}
            className="w-full bg-slate-800 text-slate-300 text-[11px] px-1.5 py-0.5 rounded border border-slate-700"
          />
        </div>
        <div>
          <label className="text-[11px] text-slate-500">Temp max °C</label>
          <input
            type="number"
            value={maxTemp ?? ''}
            onChange={(e) => setMaxTemp(e.target.value ? Number(e.target.value) : undefined)}
            className="w-full bg-slate-800 text-slate-300 text-[11px] px-1.5 py-0.5 rounded border border-slate-700"
          />
        </div>
      </div>

      {/* Wind direction */}
      <div>
        <label className="text-[11px] text-slate-500">Dirección viento</label>
        <div className="flex gap-1 flex-wrap mt-0.5">
          {WIND_DIRS.map((d) => (
            <button
              key={d.label}
              onClick={() => setSelectedDir(d.label)}
              className={`text-[11px] px-1.5 py-0.5 rounded transition-colors ${
                selectedDir === d.label
                  ? 'bg-amber-600 text-white'
                  : 'bg-slate-800 text-slate-500 hover:bg-slate-750'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {/* Max precipitation */}
      <div>
        <label className="text-[11px] text-slate-500">Precip max (mm)</label>
        <input
          type="number"
          value={maxPrecip ?? ''}
          onChange={(e) => setMaxPrecip(e.target.value ? Number(e.target.value) : undefined)}
          className="w-full bg-slate-800 text-slate-300 text-[11px] px-1.5 py-0.5 rounded border border-slate-700"
        />
      </div>

      {/* Months */}
      <div>
        <label className="text-[11px] text-slate-500">Meses</label>
        <div className="flex gap-0.5 flex-wrap mt-0.5">
          {MONTH_NAMES.map((name, i) => (
            <button
              key={i}
              onClick={() => toggleMonth(i + 1)}
              className={`text-[11px] px-1 py-0.5 rounded transition-colors ${
                months.includes(i + 1)
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-600 hover:bg-slate-750'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      {/* Search button */}
      <button
        onClick={doSearch}
        className="w-full bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-semibold py-1.5 rounded transition-colors"
      >
        Buscar ({records.length} registros)
      </button>

      {/* Results */}
      {searched && (
        <div className="space-y-1">
          <div className="text-[11px] text-slate-500">
            {results.length} resultado{results.length !== 1 ? 's' : ''}
          </div>
          {results.length > 0 && (
            <div className="max-h-48 overflow-y-auto scrollbar-thin">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-slate-500">
                    <th className="text-left py-0.5 px-1">Fecha</th>
                    <th className="text-right px-1">Tmax</th>
                    <th className="text-right px-1">Viento</th>
                    <th className="text-right px-1">Dir</th>
                    <th className="text-right px-1">Precip</th>
                    <th className="text-right px-1">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.fecha} className="hover:bg-slate-800/50 border-t border-slate-800/50">
                      <td className="py-0.5 px-1 text-slate-300 font-mono">{r.fecha}</td>
                      <td className="text-right px-1 text-orange-400">{r.temp.toFixed(0)}°</td>
                      <td className="text-right px-1 text-slate-300">{msToKnots(r.wind).toFixed(0)} kt</td>
                      <td className="text-right px-1 text-slate-400">{r.dir > 0 ? degreesToCardinal(r.dir) : '-'}</td>
                      <td className="text-right px-1 text-blue-400">{r.precip > 0 ? r.precip.toFixed(1) : '-'}</td>
                      <td className="text-right px-1 font-bold" style={{
                        color: r.score >= 80 ? '#22c55e' : r.score >= 60 ? '#f59e0b' : '#64748b',
                      }}>
                        {r.score}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
