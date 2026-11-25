/**
 * SpotWarningNotice — reads an orange marine warning as what it actually is:
 * a numeric threshold, not a binary "do not go out".
 *
 * The component only renders text produced by `sportWarningService` so the
 * legal boundary lives in one tested place: we state the warning, the
 * published threshold and the two current values. No verdict, no permission,
 * no green tick — and no numbers at all when a value is missing.
 *
 * Density: by default the block is ONE line (headline + which threshold
 * decides here) and expands on tap to the full detail (threshold, values,
 * source, official link). Safety information is never hidden behind a tap:
 * when a value sits ABOVE the threshold, or the warning is RED, the block
 * renders fully expanded and cannot be collapsed.
 *
 * Dev/demo: `?simorange=1` injects a synthetic orange warning (see
 * SIM_CASES below) so the block can be reviewed without waiting for a real
 * one, same pattern as `?simfog=` and `?simstrike=`.
 */

import { useMemo, useState } from 'react';
import { WeatherIcon } from '../icons/WeatherIcons';
import { Chevron } from '../map/Ficha';
import { useWarningsStore } from '../../hooks/useWarnings';
import {  type MGWarning } from '../../api/mgWarningsClient';
import {
  buildSportWarningNotice,
  createSimulatedWarning,
  type SportWarningSimCase,
} from '../../services/sportWarningService';

interface SpotWarningNoticeProps {
  /** Active sector id — the notice is marine, so inland sectors render nothing */
  sectorId: string;
  /** Current wave height at the spot (m). Null/undefined = no comparison shown */
  waveHeightM?: number | null;
  /** The wave is a model value (surf beach): the figure says so */
  waveIsModel?: boolean;
  /** Current wind at the spot (kt). Null/undefined = no comparison shown */
  windKt?: number | null;
  /** Override the sector warnings from the store (tests, previews) */
  warnings?: MGWarning[];
  className?: string;
}

/** `?simorange=<value>` → which demo case to render */
const SIM_CASES: Record<string, SportWarningSimCase> = {
  '1': 'below',
  'true': 'below',
  'bajo': 'below',
  'alta': 'above',
  'above': 'above',
  'sindato': 'missing',
  'missing': 'missing',
  'rojo': 'red',
  'red': 'red',
};

function readSimCase(): SportWarningSimCase | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = new URLSearchParams(window.location.search).get('simorange');
    if (!raw) return null;
    return SIM_CASES[raw.trim().toLowerCase()] ?? 'below';
  } catch {
    return null;
  }
}

export function SpotWarningNotice({
  sectorId,
  waveHeightM,
  waveIsModel,
  windKt,
  warnings,
  className,
}: SpotWarningNoticeProps) {
  const storeWarnings = useWarningsStore((s) => s.sectorWarnings);
  // User-driven expansion. The safety cases below force the block open
  // regardless of this state, so a stale "collapsed" can never hide them.
  const [expanded, setExpanded] = useState(false);

  const notice = useMemo(() => {
    const simCase = readSimCase();
    if (simCase) {
      // Deterministic demo: synthetic warning AND synthetic readings, so the
      // block looks the same regardless of what the sea is doing today.
      const sim = createSimulatedWarning(simCase);
      return buildSportWarningNotice({
        warnings: sim.warnings,
        sectorId,
        waveHeightM: sim.waveHeightM,
        waveIsModel,
        windKt: sim.windKt,
      });
    }
    return buildSportWarningNotice({
      warnings: warnings ?? storeWarnings ?? [],
      sectorId,
      waveHeightM,
      waveIsModel,
      windKt,
    });
  }, [sectorId, waveHeightM, waveIsModel, windKt, warnings, storeWarnings]);

  if (!notice) return null;

  // Safety gate: values over the threshold or a red warning are never a
  // tap away — they render open and the toggle disappears entirely.
  const forceOpen = notice.comparison === 'above' || notice.level === 3;
  const isOpen = forceOpen || expanded;
  const toneClass = notice.level === 3 ? 'gc-t-critico' : notice.level === 2 ? 'gc-t-alto' : 'gc-t-moderado';

  const headlineRow = (
    <>
      <span className="flex shrink-0" style={{ color: 'var(--tone)', marginTop: 2 }}>
        <WeatherIcon id="alert-triangle" size={14} />
      </span>
      <span className="min-w-0" style={{ flex: forceOpen ? undefined : 1 }}>
        {notice.headline}
        {!isOpen && notice.bindingText && (
          <small style={{ display: 'block', fontWeight: 400 }}>{notice.bindingText}</small>
        )}
      </span>
    </>
  );

  return (
    <div className={`gf-note gf-note--block ${toneClass} ${className ?? ''}`} style={{ display: 'block' }}>
      {forceOpen ? (
        <div className="flex items-start gf-strong" style={{ gap: 6 }}>
          {headlineRow}
        </div>
      ) : (
        <button type="button" onClick={() => setExpanded((e) => !e)} aria-expanded={isOpen}>
          {headlineRow}
          <Chevron open={isOpen} />
        </button>
      )}

      {isOpen && (
        <div className="flex flex-col" style={{ gap: 3, marginTop: 4 }}>
          {notice.thresholdText && <div>{notice.thresholdText}</div>}
          {notice.currentText && <div className="gf-mono gf-strong">{notice.currentText}</div>}
          {notice.bindingText && <div>{notice.bindingText}</div>}
          {notice.statusText && <div className="gf-strong">{notice.statusText}</div>}
          <div className="gf-hint">{notice.sourceText}</div>
          {notice.link && (
            <a href={notice.link} target="_blank" rel="noopener noreferrer" className="gf-link">
              Aviso oficial de MeteoGalicia
            </a>
          )}
        </div>
      )}
    </div>
  );
}
