/**
 * Popup for marine buoy stations (Puertos del Estado).
 * Shows summarized buoy data when a marker is clicked.
 * Desktop: MapLibre native popup. Mobile: bottom sheet with swipe-to-dismiss.
 *
 * Cyan marine theme to match BuoyMarker.
 */
import { memo } from 'react';
import { Popup } from 'react-map-gl/maplibre';
import type { BuoyReading } from '../../api/buoyClient';
import { RIAS_BUOY_STATIONS } from '../../api/buoyClient';
import { useBuoyStore } from '../../store/buoyStore';
import { useUIStore } from '../../store/uiStore';
import { useWeatherSelectionStore } from '../../store/weatherSelectionStore';
import { msToKnots, degreesToCardinal, windSpeedColor, temperatureColor } from '../../services/windUtils';
import { waveHeightColor, waterTempColor, currentSpeedColor, seaStateLabel } from '../../services/buoyUtils';
import { useSwipeToDismiss } from '../../hooks/useSwipeToDismiss';

/** Lightweight relative-time in Spanish (avoids date-fns locale bundle) */
function timeAgoEs(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'Actualizado ahora';
  if (mins < 60) return `Actualizado hace ${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `Actualizado hace ${hrs}h`;
  return `Actualizado hace ${Math.round(hrs / 24)}d`;
}

// ── Type badge colors ──────────────────────────────────────
const TYPE_COLORS: Record<string, string> = {
  REDEXT:      '#06b6d4',
  CETMAR:      '#0891b2',
  REMPOR:      '#0d9488',
  REDMAR:      '#0ea5e9',
  OBSCOSTEIRO: '#14b8a6',
};

interface BuoyPopupProps {
  reading: BuoyReading;
}

function getBuoyInfo(stationId: number) {
  return RIAS_BUOY_STATIONS.find((s) => s.id === stationId) ?? null;
}

function formatWaveDir(dir: number | null): string {
  if (dir == null) return '--';
  return `${degreesToCardinal(dir)} ${Math.round(dir)}°`;
}

/** Reusable data cell */
function DataCell({ label, value, color, large }: {
  label: string;
  value: string;
  color?: string;
  large?: boolean;
}) {
  return (
    <div>
      <div className="text-slate-400 text-[11px] mb-0.5">{label}</div>
      <div
        className={`${large ? 'font-bold text-sm' : 'font-semibold text-xs'}`}
        style={color ? { color } : undefined}
      >
        {value}
      </div>
    </div>
  );
}

export const BuoyPopup = memo(function BuoyPopup({ reading }: BuoyPopupProps) {
  const selectBuoy = useBuoyStore((s) => s.selectBuoy);
  const isMobile = useUIStore((s) => s.isMobile);
  const chartStations = useWeatherSelectionStore((s) => s.chartSelectedStations);
  const info = getBuoyInfo(reading.stationId);
  const dismiss = () => selectBuoy(null);
  const { sheetRef, onTouchStart, onTouchMove, onTouchEnd } = useSwipeToDismiss(dismiss);
  const buoyChartId = `buoy_${reading.stationId}`;
  const isInChart = chartStations.includes(buoyChartId);

  if (!info) return null;

  const typeColor = TYPE_COLORS[info.type] ?? '#06b6d4';
  const hasWaves = reading.waveHeight != null;
  const hasWind = reading.windSpeed != null;
  const hasTemp = reading.waterTemp != null || reading.airTemp != null;
  const hasCurrent = reading.currentSpeed != null;

  const popupContent = (
    <div className="min-w-[220px] font-sans">
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-2.5">
        <span className="text-[11px] font-bold px-1.5 py-px rounded text-white" style={{ background: typeColor }}>
          {info.type}
        </span>
        <strong className="text-[13px] text-slate-200">{reading.stationName}</strong>
      </div>

      <div className="grid grid-cols-2 gap-x-3.5 gap-y-2 text-xs">
        {/* Waves */}
        {hasWaves && (
          <>
            <DataCell label={`Oleaje — ${seaStateLabel(reading.waveHeight)}`} value={`${reading.waveHeight!.toFixed(1)} m`} color={waveHeightColor(reading.waveHeight)} large />
            {reading.waveHeightMax != null && <DataCell label="Ola máx (Hmax)" value={`${reading.waveHeightMax.toFixed(1)} m`} color={waveHeightColor(reading.waveHeightMax)} />}
            {reading.wavePeriod != null && <DataCell label="Periodo pico (Tp)" value={`${reading.wavePeriod.toFixed(1)} s`} />}
            {reading.wavePeriodMean != null && <DataCell label="Periodo medio" value={`${reading.wavePeriodMean.toFixed(1)} s`} />}
            {reading.waveDir != null && <DataCell label="Dir. oleaje" value={formatWaveDir(reading.waveDir)} />}
          </>
        )}

        {/* Wind */}
        {hasWind && (
          <>
            <DataCell label="Viento" value={`${msToKnots(reading.windSpeed!).toFixed(1)} kt`} color={windSpeedColor(reading.windSpeed)} large />
            {reading.windDir != null && <DataCell label="Dir. viento" value={`${degreesToCardinal(reading.windDir)} ${Math.round(reading.windDir)}°`} />}
            {reading.windGust != null && <DataCell label="Racha" value={`${msToKnots(reading.windGust).toFixed(1)} kt`} color={windSpeedColor(reading.windGust)} />}
          </>
        )}

        {/* Temperature */}
        {hasTemp && (
          <>
            {reading.waterTemp != null && <DataCell label="T agua" value={`${reading.waterTemp.toFixed(1)}°C`} color={waterTempColor(reading.waterTemp)} large />}
            {reading.airTemp != null && <DataCell label="T aire" value={`${reading.airTemp.toFixed(1)}°C`} color={temperatureColor(reading.airTemp)} />}
          </>
        )}

        {reading.airPressure != null && <DataCell label="Presión" value={`${reading.airPressure.toFixed(1)} hPa`} />}

        {/* Currents */}
        {hasCurrent && (
          <>
            <DataCell label="Corriente" value={`${(reading.currentSpeed! * 100).toFixed(0)} cm/s`} color={currentSpeedColor(reading.currentSpeed)} large />
            {reading.currentDir != null && <DataCell label="Dir. corriente" value={`→ ${degreesToCardinal(reading.currentDir)} ${Math.round(reading.currentDir)}°`} color={currentSpeedColor(reading.currentSpeed)} />}
          </>
        )}

        {reading.salinity != null && <DataCell label="Salinidad" value={`${reading.salinity.toFixed(1)} PSU`} />}
        {reading.seaLevel != null && <DataCell label="Nivel del mar" value={`${reading.seaLevel.toFixed(0)} cm`} />}
        {reading.humidity != null && <DataCell label="Humedad" value={`${reading.humidity.toFixed(0)}%`} color={reading.humidity > 85 ? '#93c5fd' : undefined} />}
        {reading.dewPoint != null && <DataCell label="Punto de rocío" value={`${reading.dewPoint.toFixed(1)}°C`} />}
      </div>

      {/* Timestamp */}
      <div className="text-[11px] text-slate-400 mt-2 pt-1.5 border-t border-slate-700">
        {reading.timestamp ? timeAgoEs(reading.timestamp) : 'Hora desconocida'}
      </div>

      {/* Action buttons */}
      <div className="mt-2 flex flex-col gap-1">
        <button
          onClick={() => {
            const store = useWeatherSelectionStore.getState();
            const wasInChart = store.chartSelectedStations.includes(buoyChartId);
            store.toggleChartStation(buoyChartId);
            if (!wasInChart) useUIStore.getState().setRequestedTab('chart');
          }}
          className={`w-full text-xs py-1.5 rounded border ${
            isInChart
              ? 'border-amber-600 bg-amber-900/30 text-amber-400 hover:bg-amber-900/50'
              : 'border-slate-600 bg-slate-800 hover:bg-slate-700 text-slate-300'
          }`}
        >
          {isInChart ? 'Quitar de gráfica' : 'Añadir a gráfica'}
        </button>
        <button
          onClick={() => {
            useWeatherSelectionStore.getState().openHistory(buoyChartId);
            useUIStore.getState().setRequestedTab('history');
          }}
          className="w-full text-xs py-1.5 rounded border border-cyan-700 bg-slate-800 hover:bg-cyan-900/30 text-cyan-400"
        >
          Ver historial
        </button>
      </div>
    </div>
  );

  // ── Mobile: bottom sheet with swipe-to-dismiss ──────────
  if (isMobile) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-50 animate-slide-up">
        <div ref={sheetRef} className="bg-slate-900 border-t border-cyan-800/50 rounded-t-2xl shadow-2xl max-h-[60dvh] overflow-y-auto p-4"
             style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom, 0px))' }}>
          <div className="flex justify-center mb-3" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
            <div className="w-10 h-1 rounded-full bg-cyan-700/50" />
          </div>
          <button onClick={dismiss} className="absolute top-3 right-3 p-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white min-w-[44px] min-h-[44px] flex items-center justify-center" aria-label="Cerrar">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
          {popupContent}
        </div>
      </div>
    );
  }

  // ── Desktop: MapLibre popup ───────────────────────────
  return (
    <Popup longitude={info.lon} latitude={info.lat} anchor="bottom" offset={[0, -30]} closeOnClick={false} onClose={dismiss} className="buoy-popup" maxWidth="380px">
      {popupContent}
    </Popup>
  );
});
