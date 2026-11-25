/**
 * The guide states numbers the engine decides, so they are checked against it. And the sections are
 * lazy: nothing else would notice one that crashes on render.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { windVerdict } from '../../../ingestor/analyzerLogic';
import { WIND_SCALE, WindTonesStrip, CESANTES_DAY, AFTERNOON_RIBADAVIA, MeasuredVsForecast, TypicalAfternoon, LightningRings, WindScale } from './guideCharts';
import { QuickStartSection } from './sections/QuickStartSection';
import { ReadingMapSection } from './sections/ReadingMapSection';
import { useSectorStore } from '../../store/sectorStore';
import { SECTORS } from '../../config/sectors';
import { LIGHTNING_DANGER_KM, LIGHTNING_WARN_KM } from '../../services/lightningProximityService';
import { windTone } from '../../services/windUtils';

vi.mock('../../../ingestor/db.js', () => ({}));

describe('the wind scale in the guide', () => {
  it('matches the engine at every whole knot', () => {
    for (let kt = 0; kt <= 30; kt++) {
      const band = WIND_SCALE.find((b) => kt >= b.fromKt && kt < b.toKt) ?? WIND_SCALE[WIND_SCALE.length - 1];
      expect(band.verdict).toBe(windVerdict(kt, 'cesantes'));
    }
  });

  it('every band has its name next to the colour', () => {
    render(<WindScale />);
    for (const b of WIND_SCALE) expect(screen.getByText(b.name)).toBeTruthy();
  });

  it('past Fuerte the colour goes on at the Beaufort cuts the app paints (18-nov)', () => {
    render(<WindScale />);
    for (const [kt, tone] of [[22, 5], [34, 6], [48, 7], [56, 8]]) {
      expect(screen.getByText(`${kt} kt o más`)).toBeTruthy();
      expect(windTone(kt - 1)).toBe(tone - 1);
      expect(windTone(kt)).toBe(tone);
    }
    expect(screen.getByText('Huracanado')).toBeTruthy();
    expect(screen.getByText(/El spot sigue diciendo Fuerte/)).toBeTruthy();
  });

  it('the arrow strip has the nine colours, the last open-ended', () => {
    const { container } = render(<WindTonesStrip />);
    expect(container.querySelectorAll('.gg-tonestrip i')).toHaveLength(9);
    expect(container.querySelector('.gg-tonestrip')?.textContent).toMatch(/22.*34.*48.*56\+$/);
  });
});

describe('the charts', () => {
  it('the measured day says the peak its note says', () => {
    const peak = CESANTES_DAY.reduce((a, d) => (d[1] > a[1] ? d : a));
    expect(peak[0]).toBe(17);
    expect(peak[1]).toBe(9.7);
  });

  it('hovering the day shows both figures', () => {
    const { container } = render(<MeasuredVsForecast />);
    const svg = container.querySelector('svg[role="img"]')!;
    fireEvent.pointerMove(svg, { clientX: 0, clientY: 0 });
    expect(container.querySelector('.gg-tip')?.textContent).toMatch(/Medido .* kt.*Previsión .* kt/);
  });

  it('the afternoon percentiles are ordered at every hour', () => {
    for (const p of Object.values(AFTERNOON_RIBADAVIA.perHour)) {
      expect(p[0]).toBeLessThanOrEqual(p[1]);
      expect(p[1]).toBeLessThanOrEqual(p[2]);
      expect(p[2]).toBeLessThanOrEqual(p[3]);
    }
    expect(() => render(<TypicalAfternoon data={AFTERNOON_RIBADAVIA} title="t" />)).not.toThrow();
  });

  it('the rings use the distances of the lightning service', () => {
    render(<LightningRings />);
    expect(screen.getByText(`PELIGRO, a ${LIGHTNING_DANGER_KM} km o menos`)).toBeTruthy();
    expect(screen.getByText(`AVISO, a ${LIGHTNING_WARN_KM} km o menos`)).toBeTruthy();
  });
});

describe('the sections', () => {
  it.each(SECTORS.map((s) => s.id))('first page and map page render in %s', (id) => {
    useSectorStore.setState({ activeSector: SECTORS.find((s) => s.id === id)! });
    expect(() => render(<QuickStartSection />)).not.toThrow();
    expect(() => render(<ReadingMapSection />)).not.toThrow();
  });

  it('surf is only explained where there is sea', () => {
    useSectorStore.setState({ activeSector: SECTORS.find((s) => !s.coastal)! });
    const { queryByText } = render(<QuickStartSection />);
    expect(queryByText(/SURF OK/)).toBeNull();
  });
});
