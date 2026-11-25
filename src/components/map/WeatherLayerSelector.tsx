/**
 * The one menu for what can be laid over the map by hand. What appears by itself (lightning, rain now,
 * fog, fires) has no switch. Simple mode has no menu and no layer button: it keeps what the map shows by itself.
 */
import { memo, useCallback, useRef, useState } from 'react';
import { useWeatherLayerStore } from '../../store/weatherLayerStore';
import { useUIStore } from '../../store/uiStore';
import { useSectorStore } from '../../store/sectorStore';
import { useWebcamStore } from '../../store/webcamStore';
import { useMapStyleStore } from '../../store/mapStyleStore';
import { useTemperatureOverlayStore } from '../../store/temperatureOverlayStore';
import { useDismiss } from '../../hooks/useDismiss';
import { WeatherIcon } from '../icons/WeatherIcons';
import { windSpeedColor, WIND_TONE_STEPS_KT } from '../../services/windUtils';
import { mapIsDark } from '../../hooks/useMapInk';

export const WeatherLayerSelector = memo(function WeatherLayerSelector() {
  const isMobile = useUIStore((s) => s.isMobile);
  const isCoastal = useSectorStore((s) => s.activeSector.coastal);
  const activeLayer = useWeatherLayerStore((s) => s.activeLayer);
  const layerOpacity = useWeatherLayerStore((s) => s.layerOpacity);
  const setActiveLayer = useWeatherLayerStore((s) => s.setActiveLayer);
  const setLayerOpacity = useWeatherLayerStore((s) => s.setLayerOpacity);
  const showTemperature = useTemperatureOverlayStore((s) => s.showOverlay);
  const toggleTemperature = useTemperatureOverlayStore((s) => s.toggleOverlay);
  const showWebcams = useWebcamStore((s) => s.showOverlay);
  const toggleWebcams = useWebcamStore((s) => s.toggleOverlay);
  const showSwan = useMapStyleStore((s) => s.showSwan);
  const toggleSwan = useMapStyleStore((s) => s.toggleSwan);
  const showChart = useMapStyleStore((s) => s.showNauticalChart);
  const toggleChart = useMapStyleStore((s) => s.toggleNauticalChart);

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);

  const toggleLayer = (id: 'wind-particles' | 'radar') => setActiveLayer(activeLayer === id ? 'none' : id);
  const coastOn = isCoastal && (showSwan || showChart);
  const onCount = [activeLayer !== 'none', showTemperature, showWebcams, coastOn && showSwan, coastOn && showChart].filter(Boolean).length;

  return (
    <div ref={rootRef} className="gc-layers" data-tour="layers">
      {open && (
        <div className="g-theme gc-popover gc-layers-menu" role="group" aria-label="Ver en el mapa">
          <Layer label="Viento" sub="Corriente entre las estaciones" on={activeLayer === 'wind-particles'} onClick={() => toggleLayer('wind-particles')} />
          <Layer label="Radar" sub="Eco de las últimas 2 horas, sin filtrar" on={activeLayer === 'radar'} onClick={() => toggleLayer('radar')} />
          <Layer label="Temperatura" sub="Cada estación y el agua" on={showTemperature} onClick={toggleTemperature} />
          <Layer label="Webcams" sub="Dónde hay cámara y hacia dónde mira" on={showWebcams} onClick={toggleWebcams} />
          {isCoastal && <Layer label="Oleaje (modelo)" sub="Altura de ola dentro de las rías, hasta 48 horas" on={showSwan} onClick={toggleSwan} />}
          {isCoastal && <Layer label="Carta náutica" sub="Carta oficial del IHM: bajos y zonas" on={showChart} onClick={toggleChart} />}
          {activeLayer !== 'none' && (
            <div className="gc-toolpanel" style={{ width: 'auto', maxWidth: 'none', borderBottom: 0, borderTop: '1px solid var(--g-hair)' }}>
              <label className="gc-toolpanel-row">
                <span>Opacidad</span>
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={Math.round(layerOpacity * 100)}
                  onChange={(e) => setLayerOpacity(Number(e.target.value) / 100)}
                  aria-label="Opacidad de la capa"
                  aria-valuetext={`${Math.round(layerOpacity * 100)} por ciento`}
                />
                <span className="gc-num">{Math.round(layerOpacity * 100)} %</span>
              </label>
              {activeLayer === 'wind-particles' && <WindLegend />}
              {activeLayer === 'radar' && <RadarLegend />}
            </div>
          )}
        </div>
      )}
      <button
        type="button"
        className="gc-tool"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={onCount > 0 ? `Ver en el mapa, ${onCount} encendido${onCount > 1 ? 's' : ''}` : 'Ver en el mapa'}
        title="Ver en el mapa: viento, radar, temperatura…"
      >
        <WeatherIcon id="layers" size={isMobile ? 18 : 15} />
        {!isMobile && <span>Ver en el mapa</span>}
        {onCount > 0 && <span className="gc-tool-count">{onCount}</span>}
      </button>
    </div>
  );
});

function Layer({ label, sub, on, onClick }: { label: string; sub: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="gc-option" onClick={onClick}>
      <span className="gc-option-text">
        <span>{label}</span>
        <span className="gc-option-sub">{sub}</span>
      </span>
      <span className="gc-switch" />
    </button>
  );
}

/* ─── Wind speed colour legend ───
   Each stop is a speed in m/s (windSpeedColor's input) and the knots from which that colour starts, so the
   legend reads the colour from the function that paints the layer and cannot drift from it. */
export const WIND_LEGEND_STOPS = [0, ...WIND_TONE_STEPS_KT].map((kt, i, all) => ({
  ms: kt === 0 ? 0 : (kt + 0.01) / 1.94384,
  label: i === all.length - 1 ? `${kt}+` : String(kt),
}));

function WindLegend() {
  const onDarkMap = mapIsDark();
  return (
    <div>
      <div className="gc-note" style={{ marginBottom: 4 }}>Viento, desde (kt)</div>
      <div className="gc-scale">
        {WIND_LEGEND_STOPS.map((s) => (
          <span key={s.label}><i style={{ background: windSpeedColor(s.ms, onDarkMap) }} />{s.label}</span>
        ))}
      </div>
    </div>
  );
}

/* ─── (SatelliteLegend removed — EUMETSAT non-commercial license incompatible) ─── */

/* ─── Radar info panel ─── */
function RadarLegend() {
  return (
    <div>
      <div className="gc-note" style={{ marginBottom: 6 }}>
        RainViewer: radar animado de las últimas 2 h. Pulsa el botón del mapa para reproducir.
        El beis claro es eco muy débil o ruido del mar.
      </div>
      {/* The colours RainViewer really draws (Universal Blue, the only scheme of the free tier;
          radarDecode.ts has the table): the old rainbow had a green it never uses (6-oct). */}
      <div className="gc-scale">
        {[
          { color: '#00a3e0', label: 'Débil' },
          { color: '#005588', label: 'Media' },
          { color: '#ffaa00', label: 'Fuerte' },
          { color: '#c10000', label: 'Tormenta' },
          { color: '#ff77ff', label: 'Granizo' },
        ].map((s) => (
          <span key={s.label}><i style={{ background: s.color }} />{s.label}</span>
        ))}
      </div>
    </div>
  );
}
