import { memo, useCallback, useRef, useState } from 'react';
import { useWeatherStore, type WeatherSource } from '../../store/weatherStore';
import { isAemetRateLimited, aemetCooldownRemaining } from '../../api/aemetClient';
import { useDismiss } from '../../hooks/useDismiss';
import { WeatherIcon } from '../icons/WeatherIcons';

const SOURCE_NAMES: Record<WeatherSource, string> = {
  aemet: 'AEMET',
  meteogalicia: 'MeteoGalicia',
  meteoclimatic: 'Meteoclimatic',
  wunderground: 'Weather Underground',
  netatmo: 'Netatmo',
  skyx: 'SkyX',
  ipma: 'IPMA',
};

const SOURCE_ORDER: WeatherSource[] = ['aemet', 'meteogalicia', 'meteoclimatic', 'wunderground', 'netatmo', 'skyx', 'ipma'];

function formatAge(date: Date | null | undefined): string {
  if (!date) return 'sin datos';
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins} min`;
  return `hace ${Math.round(mins / 60)} h`;
}

type RowState = 'wait' | 'ok' | 'old' | 'bad' | 'none';

/**
 * Advanced mode: how many data sources answer, and on press which one and how old its data is.
 * It replaces a strip of initials (A MG MC WU NT SX PT) whose meaning only lived in a tooltip.
 */
export const SourceStatusIndicator = memo(function SourceStatusIndicator() {
  const sourceFreshness = useWeatherStore((s) => s.sourceFreshness);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);

  const rows = SOURCE_ORDER.map((source) => {
    const status = sourceFreshness.get(source);
    const hasData = !!status && status.readingCount > 0;
    const hasError = !!status?.lastError && (!status.lastSuccess || status.lastError > status.lastSuccess);
    const isOld = !!status?.lastSuccess && Date.now() - status.lastSuccess.getTime() > 30 * 60 * 1000;

    let state: RowState;
    let word: string;
    if (!status || (!status.lastSuccess && !status.lastError)) {
      state = 'wait'; word = 'esperando';
    } else if (source === 'aemet' && isAemetRateLimited()) {
      state = 'old'; word = `en pausa ${aemetCooldownRemaining()} s`;
    } else if (hasError && !hasData) {
      state = 'bad'; word = 'no responde';
    } else if (isOld) {
      state = 'old'; word = `dato ${formatAge(status.lastSuccess)}`;
    } else if (hasData) {
      state = 'ok'; word = formatAge(status.lastSuccess);
    } else {
      state = 'none'; word = 'sin estaciones';
    }
    return { source, state, word, stations: status?.readingCount ?? 0 };
  });

  const answering = rows.filter((r) => r.state === 'ok').length;
  const failing = rows.some((r) => r.state === 'bad');
  // Quiet while nothing is wrong: a count in the header that never changes is noise
  if (!failing && !rows.some((r) => r.state === 'old') && !open) return null;

  return (
    // Over the map's panels, under the dialogs and the guide (z-50): at 60 it showed through them
    <div ref={rootRef} style={{ position: 'relative', zIndex: 45 }}>
      <button
        type="button"
        className="gc-btn gc-btn--plain"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Fuentes de datos: ${answering} de ${rows.length} al día`}
        title="Fuentes de datos"
      >
        <WeatherIcon id="database" size={15} />
        <span>Fuentes {answering}/{rows.length}</span>
        {failing && <span className="gc-dot gc-t-alto" />}
      </button>
      {open && (
        <div className="g-theme gc-popover" style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, width: 320 }}>
          <div className="gc-popover-body">
            <div className="gc-popover-head">Fuentes de datos</div>
            <div>
              {rows.map((r) => (
                <div className="gc-status-row" key={r.source}>
                  <b>{SOURCE_NAMES[r.source]}</b>
                  <span>{r.stations > 0 ? `${r.stations} est.` : ''}</span>
                  <span data-state={r.state}>{r.word}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
