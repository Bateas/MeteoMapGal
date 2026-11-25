/**
 * Floating map style selector — lets users switch base map tiles.
 *
 * Positioned top-right on desktop (beside the zoom buttons), and below the zoom buttons on
 * mobile (icon-only trigger).
 *
 * Auto (the grey canvas of the theme), streets, IGN topographic and aerial photo. All free, no API keys.
 * The layers over the map have their own menu (WeatherLayerSelector).
 */
import { memo, useState, useCallback, useRef, type CSSProperties } from 'react';
import { MAP_STYLES, PICKABLE_STYLES, useMapStyleStore, resolveStyleId } from '../../store/mapStyleStore';
import type { MapStyleChoice } from '../../store/mapStyleStore';
import { useThemeStore } from '../../store/themeStore';
import { useUIStore } from '../../store/uiStore';
import { useDismiss } from '../../hooks/useDismiss';
import { WeatherIcon } from '../icons/WeatherIcons';

export const MapStyleSelector = memo(function MapStyleSelector() {
  const isMobile = useUIStore((s) => s.isMobile);
  const activeStyleId = useMapStyleStore((s) => s.activeStyleId);
  const theme = useThemeStore((s) => s.theme);
  const setStyle = useMapStyleStore((s) => s.setStyle);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);

  const handleSelect = useCallback((id: MapStyleChoice) => {
    setStyle(id);
    setOpen(false);
  }, [setStyle]);

  // What is actually drawn: 'auto' resolves to the grey canvas of the theme.
  const isAuto = activeStyleId === 'auto';
  const drawnId = resolveStyleId(activeStyleId, theme);
  const activeStyle = MAP_STYLES.find((s) => s.id === drawnId) ?? MAP_STYLES[0];
  const activeLabel = isAuto ? 'Automático' : activeStyle.name;
  const activeShort = isAuto ? 'Auto' : activeStyle.shortName;

  return (
    <div
      ref={rootRef}
      className={`${isMobile ? `fixed right-2 ${open ? 'z-50 top-[4.5rem]' : 'z-30 top-[12rem]'}` : 'absolute z-30 top-2 right-12'}`}
      style={isMobile ? { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 } : { top: 'calc(0.5rem + var(--ticker-h, 0px))' }}
    >
      <button
        type="button"
        className="gc-tool"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title={`Mapa base: ${activeLabel}`}
        aria-label={`Cambiar mapa base (actual: ${activeLabel})`}
      >
        <WeatherIcon id="map" size={isMobile ? 18 : 15} />
        {!isMobile && <span>Mapa: {activeShort}</span>}
      </button>

      {open && (
        <div
          className="g-theme gc-popover"
          style={{
            width: 280,
            maxWidth: 'calc(100vw - 16px)',
            maxHeight: isMobile ? 'calc(100dvh - 16rem)' : '70vh',
            overflowY: 'auto',
            marginTop: isMobile ? 0 : 4,
          }}
        >
          <Group label="Mapa base" role="radiogroup">
            <StyleOption
              label="Auto"
              sub="Claro u oscuro, según el tema"
              swatch={['#e6e5e3', '#2b2b2b']}
              checked={isAuto}
              onClick={() => handleSelect('auto')}
            />
            {MAP_STYLES.filter((style) => PICKABLE_STYLES.includes(style.id)).map((style) => (
              <StyleOption
                key={style.id}
                label={style.shortName}
                sub={style.name}
                swatch={style.swatch}
                checked={style.id === activeStyleId}
                onClick={() => handleSelect(style.id)}
              />
            ))}
          </Group>

        </div>
      )}
    </div>
  );
});

function Group({ label, role, children }: { label: string; role?: string; children: React.ReactNode }) {
  return (
    <div role={role ?? 'group'} aria-label={label} style={{ padding: 4, borderBottom: '1px solid var(--g-hair)' }}>
      <div className="gc-menu-label">{label}</div>
      {children}
    </div>
  );
}

function StyleOption({ label, sub, swatch, checked, onClick }: {
  label: string;
  sub: string;
  swatch: readonly [string, string] | string[];
  checked: boolean;
  onClick: () => void;
}) {
  const style: CSSProperties = { background: `linear-gradient(135deg, ${swatch[0]} 50%, ${swatch[1]} 50%)` };
  return (
    <button type="button" role="radio" aria-checked={checked} className="gc-option" onClick={onClick}>
      <span className="gc-swatch" style={style} />
      <span className="gc-option-text">
        <span>{label}</span>
        <span className="gc-option-sub">{sub}</span>
      </span>
      {checked && <WeatherIcon id="check" size={16} />}
    </button>
  );
}
