import { memo } from 'react';
import { SECTORS } from '../../config/sectors';
import { useSectorStore } from '../../store/sectorStore';
import { useUIStore } from '../../store/uiStore';
import { WeatherIcon } from '../icons/WeatherIcons';

/**
 * The zone switch, in the header on every screen. It is the big decision of the page, so it is
 * the one control drawn with a full line around it; the selected zone is filled with ink.
 */
export const SectorSelector = memo(function SectorSelector() {
  const isMobile = useUIStore((s) => s.isMobile);
  const activeSectorId = useSectorStore((s) => s.activeSector.id);
  const switchSector = useSectorStore((s) => s.switchSector);

  return (
    <div className="gc-seg" role="group" aria-label="Zona" data-tour="sectors">
      {SECTORS.map((sector) => (
        <button
          key={sector.id}
          type="button"
          onClick={() => switchSector(sector.id)}
          aria-pressed={sector.id === activeSectorId}
          aria-label={`Cambiar a sector ${sector.name}`}
          title={sector.name}
        >
          {!isMobile && <WeatherIcon id={sector.icon} size={15} />}
          <span>{sector.shortName}</span>
        </button>
      ))}
    </div>
  );
});
