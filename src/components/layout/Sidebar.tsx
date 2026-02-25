import { useState } from 'react';
import { StationTable } from '../dashboard/StationTable';
import { TimeSeriesChart } from '../charts/TimeSeriesChart';
import { ErrorBanner } from '../common/ErrorBanner';

type Tab = 'stations' | 'chart';

export function Sidebar() {
  const [activeTab, setActiveTab] = useState<Tab>('stations');

  return (
    <aside className="w-80 bg-slate-900 border-r border-slate-700 flex flex-col overflow-hidden">
      {/* Tab header */}
      <div className="flex border-b border-slate-700">
        <button
          onClick={() => setActiveTab('stations')}
          className={`flex-1 text-xs font-semibold py-2.5 uppercase tracking-wider transition-colors ${
            activeTab === 'stations'
              ? 'text-white border-b-2 border-blue-500 bg-slate-800/50'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          Estaciones
        </button>
        <button
          onClick={() => setActiveTab('chart')}
          className={`flex-1 text-xs font-semibold py-2.5 uppercase tracking-wider transition-colors ${
            activeTab === 'chart'
              ? 'text-white border-b-2 border-blue-500 bg-slate-800/50'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          Gráfica
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <ErrorBanner />
        {activeTab === 'stations' ? <StationTable /> : <TimeSeriesChart />}
      </div>
    </aside>
  );
}
