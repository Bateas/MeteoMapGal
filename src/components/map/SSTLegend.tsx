import { useUIStore } from '../../store/uiStore';
import { useSectorStore } from '../../store/sectorStore';

/**
 * Color legend for the CMEMS SST overlay.
 * Shows the cmap:thermal palette (cmocean) with temperature labels.
 * Only visible when SST overlay is active in Rías Baixas sector.
 *
 * Range: 5.6 – 26.3 °C (from CMEMS GetLegend for IBI Atlantic L4 NRT).
 * Galician coast in winter/spring: ~12-16 °C (purple-mauve zone).
 */

/** cmap:thermal gradient stops from CMEMS (11 key stops at 10% intervals) */
const GRADIENT = [
  '#042333', // 5.6 °C
  '#10326c', // 7.7
  '#40349f', // 9.7
  '#674396', // 11.8
  '#8b538d', // 13.9
  '#b15f82', // 16.0
  '#d66c6c', // 18.0
  '#f2814e', // 20.1
  '#fca63c', // 22.2
  '#f7d045', // 24.3
  '#e8fa5b', // 26.3 °C
].join(', ');

const LABELS = [
  { pct: '0%',   text: '6°' },
  { pct: '25%',  text: '11°' },
  { pct: '50%',  text: '16°' },
  { pct: '75%',  text: '21°' },
  { pct: '100%', text: '26°' },
];

export function SSTLegend() {
  const visible = useUIStore((s) => s.sstVisible);
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const isMobile = useUIStore((s) => s.isMobile);

  if (!visible || sectorId !== 'rias') return null;

  return (
    <div
      className={`absolute z-20 flex flex-col items-center gap-0.5 pointer-events-none
        ${isMobile ? 'right-2 top-[12.5rem]' : 'left-2 top-20'}`}
    >
      {/* Title */}
      <span className="text-[11px] font-semibold text-white/80 tracking-wide drop-shadow-md">
        SST °C
      </span>

      {/* Gradient bar + labels */}
      <div className="flex items-stretch gap-1">
        {/* Vertical gradient bar — warm on top, cold on bottom */}
        <div
          className="w-3 rounded-sm border border-white/20 shadow-md"
          style={{
            height: isMobile ? 100 : 130,
            background: `linear-gradient(to bottom, ${GRADIENT.split(', ').reverse().join(', ')})`,
          }}
        />

        {/* Temperature labels */}
        <div
          className="flex flex-col justify-between"
          style={{ height: isMobile ? 100 : 130 }}
        >
          {[...LABELS].reverse().map((l) => (
            <span
              key={l.pct}
              className="text-[11px] leading-none font-medium text-white/90 drop-shadow-md"
            >
              {l.text}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
