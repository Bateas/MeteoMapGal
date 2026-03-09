/**
 * Popup for marine buoy stations (Puertos del Estado).
 * Shows summarized buoy data when a marker is clicked.
 * Desktop: MapLibre native popup. Mobile: bottom sheet.
 *
 * Cyan marine theme to match BuoyMarker.
 */
import { memo } from 'react';
import { Popup } from 'react-map-gl/maplibre';
import type { BuoyReading } from '../../api/buoyClient';
import { RIAS_BUOY_STATIONS } from '../../api/buoyClient';
import { useBuoyStore } from '../../store/buoyStore';
import { useUIStore } from '../../store/uiStore';
import { msToKnots, degreesToCardinal, windSpeedColor } from '../../services/windUtils';
import { waveHeightColor, waterTempColor } from '../../services/buoyUtils';

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
  REDEXT:  '#06b6d4', // cyan — deep-water buoy
  CETMAR:  '#0891b2', // cyan-600 — coastal buoy
  REMPOR:  '#0d9488', // teal-600 — port met station
  REDMAR:  '#0ea5e9', // sky-500 — tide gauge
};

interface BuoyPopupProps {
  reading: BuoyReading;
}

/** Get lat/lon + type from the predefined station list */
function getBuoyInfo(stationId: number) {
  return RIAS_BUOY_STATIONS.find((s) => s.id === stationId) ?? null;
}

/** Format wave direction as arrow + cardinal */
function formatWaveDir(dir: number | null): string {
  if (dir == null) return '--';
  return `${degreesToCardinal(dir)} ${Math.round(dir)}°`;
}

export const BuoyPopup = memo(function BuoyPopup({ reading }: BuoyPopupProps) {
  const selectBuoy = useBuoyStore((s) => s.selectBuoy);
  const isMobile = useUIStore((s) => s.isMobile);
  const info = getBuoyInfo(reading.stationId);
  if (!info) return null;

  const typeColor = TYPE_COLORS[info.type] ?? '#06b6d4';
  const hasWaves = reading.waveHeight != null;
  const hasWind = reading.windSpeed != null;
  const hasTemp = reading.waterTemp != null || reading.airTemp != null;
  const hasCurrent = reading.currentSpeed != null;

  // ── Shared popup content ──────────────────────────────
  const popupContent = (
    <div style={{ minWidth: 220, fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            padding: '1px 5px',
            borderRadius: 3,
            background: typeColor,
            color: 'white',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          {info.type}
        </span>
        <strong style={{ fontSize: 13, color: '#e2e8f0' }}>{reading.stationName}</strong>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px', fontSize: 12 }}>
        {/* ── Waves ─────────────────────────────── */}
        {hasWaves && (
          <>
            <DataCell
              label="Oleaje (Hm0)"
              value={`${reading.waveHeight!.toFixed(1)} m`}
              color={waveHeightColor(reading.waveHeight)}
              large
            />
            {reading.waveHeightMax != null && (
              <DataCell
                label="Ola máx (Hmax)"
                value={`${reading.waveHeightMax.toFixed(1)} m`}
                color={waveHeightColor(reading.waveHeightMax)}
              />
            )}
            {reading.wavePeriod != null && (
              <DataCell
                label="Periodo pico (Tp)"
                value={`${reading.wavePeriod.toFixed(1)} s`}
              />
            )}
            {reading.wavePeriodMean != null && (
              <DataCell
                label="Periodo medio"
                value={`${reading.wavePeriodMean.toFixed(1)} s`}
              />
            )}
            {reading.waveDir != null && (
              <DataCell
                label="Dir. oleaje"
                value={formatWaveDir(reading.waveDir)}
              />
            )}
          </>
        )}

        {/* ── Wind ──────────────────────────────── */}
        {hasWind && (
          <>
            <DataCell
              label="Viento"
              value={`${msToKnots(reading.windSpeed!).toFixed(1)} kt`}
              color={windSpeedColor(reading.windSpeed)}
              large
            />
            {reading.windDir != null && (
              <DataCell
                label="Dir. viento"
                value={`${degreesToCardinal(reading.windDir)} ${Math.round(reading.windDir)}°`}
              />
            )}
            {reading.windGust != null && (
              <DataCell
                label="Racha"
                value={`${msToKnots(reading.windGust).toFixed(1)} kt`}
                color={windSpeedColor(reading.windGust)}
              />
            )}
          </>
        )}

        {/* ── Temperature ───────────────────────── */}
        {hasTemp && (
          <>
            {reading.waterTemp != null && (
              <DataCell
                label="T agua"
                value={`${reading.waterTemp.toFixed(1)}°C`}
                color={waterTempColor(reading.waterTemp)}
                large
              />
            )}
            {reading.airTemp != null && (
              <DataCell
                label="T aire"
                value={`${reading.airTemp.toFixed(1)}°C`}
              />
            )}
          </>
        )}

        {/* ── Pressure ──────────────────────────── */}
        {reading.airPressure != null && (
          <DataCell
            label="Presión"
            value={`${reading.airPressure.toFixed(1)} hPa`}
          />
        )}

        {/* ── Currents ──────────────────────────── */}
        {hasCurrent && (
          <>
            <DataCell
              label="Corriente"
              value={`${(reading.currentSpeed! * 100).toFixed(0)} cm/s`}
            />
            {reading.currentDir != null && (
              <DataCell
                label="Dir. corriente"
                value={`${degreesToCardinal(reading.currentDir)} ${Math.round(reading.currentDir)}°`}
              />
            )}
          </>
        )}

        {/* ── Salinity ──────────────────────────── */}
        {reading.salinity != null && (
          <DataCell
            label="Salinidad"
            value={`${reading.salinity.toFixed(1)} PSU`}
          />
        )}

        {/* ── Sea level ─────────────────────────── */}
        {reading.seaLevel != null && (
          <DataCell
            label="Nivel del mar"
            value={`${reading.seaLevel.toFixed(0)} cm`}
          />
        )}
      </div>

      {/* Timestamp */}
      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 8, borderTop: '1px solid #334155', paddingTop: 6 }}>
        {reading.timestamp ? timeAgoEs(reading.timestamp) : 'Hora desconocida'}
      </div>
    </div>
  );

  // ── Mobile: bottom sheet ──────────────────────────────
  if (isMobile) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-40 animate-slide-up">
        <div
          className="bg-slate-900 border-t border-cyan-800/50 rounded-t-2xl shadow-2xl max-h-[55dvh] overflow-y-auto p-4"
          style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
        >
          {/* Drag handle */}
          <div className="flex justify-center mb-3">
            <div className="w-10 h-1 rounded-full bg-cyan-700/50" />
          </div>
          {/* Close button */}
          <button
            onClick={() => selectBuoy(null)}
            className="absolute top-3 right-3 p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
            aria-label="Cerrar"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          {popupContent}
        </div>
      </div>
    );
  }

  // ── Desktop: MapLibre popup ───────────────────────────
  return (
    <Popup
      longitude={info.lon}
      latitude={info.lat}
      anchor="bottom"
      offset={[0, -30]}
      closeOnClick={false}
      onClose={() => selectBuoy(null)}
      className="buoy-popup"
    >
      {popupContent}
    </Popup>
  );
});

// ── Data cell sub-component ─────────────────────────────

function DataCell({
  label,
  value,
  color,
  large,
}: {
  label: string;
  value: string;
  color?: string;
  large?: boolean;
}) {
  return (
    <div>
      <div style={{ color: '#94a3b8', fontSize: 10, marginBottom: 2 }}>{label}</div>
      <div
        style={{
          fontWeight: large ? 700 : 600,
          fontSize: large ? 14 : 12,
          color: color ?? '#e2e8f0',
        }}
      >
        {value}
      </div>
    </div>
  );
}
