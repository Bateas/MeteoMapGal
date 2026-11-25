import { useMemo } from 'react';
import { LastUpdated } from '../common/LastUpdated';
import { SourceStatusIndicator } from '../common/SourceStatusIndicator';
import { WeatherIcon } from '../icons/WeatherIcons';
import { SectorSelector } from '../map/SectorSelector';
import { useSectorStore } from '../../store/sectorStore';
import { getSunTimes, formatTime } from '../../services/solarUtils';
import { useUIStore } from '../../store/uiStore';
import { useThemeStore } from '../../store/themeStore';
import { APP_VERSION } from '../../config/version';
import { CONDITIONS_LEVEL_WORD as LEVEL_WORD } from '../../config/levelWords';
import { useMinuteClock } from '../../hooks/useMinuteClock';

interface HeaderProps {
  onRefresh: () => void;
  fieldDrawerOpen?: boolean;
  onToggleFieldDrawer?: () => void;
  fieldAlertLevel?: 'none' | 'riesgo' | 'moderado' | 'alto' | 'critico';
}


export function Header({ onRefresh, fieldDrawerOpen, onToggleFieldDrawer, fieldAlertLevel = 'none' }: HeaderProps) {
  const activeSector = useSectorStore((s) => s.activeSector);
  const isMobile = useUIStore((s) => s.isMobile);
  const simpleMode = useUIStore((s) => s.simpleMode);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const theme = useThemeStore((s) => s.theme);

  // A minute clock: the installed app stays open for days, and the sun and moon, and the hours of sunrise and
  // sunset, stayed on the day it was opened (review, 18-nov).
  const clock = useMinuteClock();
  const day = new Date(clock).toDateString();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `day` is what changes the sun times, not every minute
  const sun = useMemo(() => getSunTimes(new Date(clock), activeSector.center), [activeSector.center, day]);
  const daylight = clock >= sun.sunrise.getTime() && clock <= sun.sunset.getTime();

  return (
    // .gc-header adds the safe-area inset: the page runs edge to edge on iOS (viewport-fit=cover,
    // translucent status bar), so the installed app would put the header under the clock otherwise.
    <header className="g-theme gc-header">
      <div className="gc-header-group">
        <h1 className="gc-brand" translate="no">MeteoMapGal</h1>
        {!isMobile && <span className="gc-version gc-xl" aria-label={`versión ${APP_VERSION}`}>v{APP_VERSION}</span>}
        <SectorSelector />
        {!isMobile && (
          // An action, not a switch: no aria-pressed ("Avanzado, activado" contradicted the
          // button label, which already names the other mode).
          <button
            type="button"
            data-tour="simple-toggle"
            onClick={() => useUIStore.getState().toggleSimpleMode()}
            className="gc-btn"
            aria-label={simpleMode ? 'Pasar a modo avanzado' : 'Pasar a modo simple'}
            title={simpleMode ? 'Ver también las capas, las estaciones y el historial' : 'Quedarse solo con lo esencial'}
          >
            <WeatherIcon id={simpleMode ? 'eye' : 'eye-off'} size={15} />
            <span>{simpleMode ? 'Avanzado' : 'Simple'}</span>
          </button>
        )}
        {/* Advanced only, and it says nothing while every source answers */}
        {!isMobile && !simpleMode && <span className="gc-xl"><SourceStatusIndicator /></span>}
      </div>

      <div className="gc-header-group">
        {!isMobile && (
          <span className="gc-meta gc-xl" title={`Mediodía solar: ${formatTime(sun.solarNoon)} | Térmico: ${formatTime(sun.thermalStart)}–${formatTime(sun.thermalEnd)}`}>
            <WeatherIcon id={daylight ? 'sun' : 'moon'} size={14} />
            <span>{formatTime(sun.sunrise)} / {formatTime(sun.sunset)}</span>
          </span>
        )}

        {/* On a phone these three live in the bottom bar's "Más" menu */}
        {!isMobile && onToggleFieldDrawer && (
          <button
            type="button"
            onClick={onToggleFieldDrawer}
            data-tour="panel"
            className="gc-btn"
            aria-expanded={!!fieldDrawerOpen}
            title="Condiciones (C)"
            aria-label={`Condiciones (tecla C).${LEVEL_WORD[fieldAlertLevel]}`}
          >
            <WeatherIcon id="activity" size={15} />
            <span className="gc-lg">Condiciones</span>
            {fieldAlertLevel !== 'none' && (
              <span className={`gc-dot gc-t-${fieldAlertLevel}${fieldAlertLevel === 'critico' && !fieldDrawerOpen ? ' animate-pulse' : ''}`} />
            )}
          </button>
        )}
        {!isMobile && (
          <>
            <button
              type="button"
              data-tour="guide"
              onClick={() => useUIStore.getState().toggleGuide()}
              className="gc-btn gc-btn--plain"
              title="Guía de la app (G)"
              aria-label="Abrir guía meteorológica (tecla G)"
            >
              <WeatherIcon id="book-open" size={15} />
              <span className="gc-lg">Guía</span>
            </button>
            <button
              type="button"
              onClick={() => useUIStore.getState().setFeedbackOpen(true)}
              className="gc-btn gc-btn--plain"
              aria-label="Enviar tu opinión"
              title="Enviar sugerencias o avisar de un problema"
            >
              <WeatherIcon id="message-square" size={15} />
              <span className="gc-lg">Opinión</span>
            </button>
          </>
        )}

        <button
          type="button"
          onClick={toggleTheme}
          className="gc-btn gc-btn--plain gc-btn--icon"
          aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          title={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
        >
          <WeatherIcon id={theme === 'dark' ? 'sun' : 'moon'} size={17} />
        </button>

        <LastUpdated onRefresh={onRefresh} compact={isMobile} />
      </div>
    </header>
  );
}
