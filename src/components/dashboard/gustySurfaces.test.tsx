/**
 * «Racheado» on every surface that names a spot's verdict. The card and the marker said it; the list, the phone pill and
 * the shared card still read «Flojo 7 kt» over gusts of 20, which is the reading the word was written to stop.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const lightning = vi.hoisted(() => ({ risks: [] as unknown[] }));
vi.mock('../../hooks/useSpotLightningRisk', () => ({
  useSpotLightningRisk: () => lightning.risks,
}));

import { SpotSelector } from './SpotSelector';
import { MobileSailingBanner } from './MobileSailingBanner';
import { useSpotStore } from '../../store/spotStore';
import { useSectorStore } from '../../store/sectorStore';
import { useAlertStore } from '../../store/alertStore';
import { SECTORS } from '../../config/sectors';
import { ALL_SPOTS } from '../../config/spots';
import { GUSTY_LABEL } from '../../config/verdictStyles';
import { buildShareData, buildShareText, pillAside } from '../../services/shareImageGenerator';
import type { SpotScore } from '../../services/spotScoringEngine';

const VAO = ALL_SPOTS.find((s) => s.id === 'vao')!;
const rowOf = (id: string) => document.querySelector<HTMLElement>(`.gc-listrow[data-flip-key="${id}"]`)!;

function score(spotId: string, gustKt: number | null, verdict: SpotScore['verdict'] = 'light', kt = 7): SpotScore {
  return {
    spotId, spotName: spotId, verdict, score: 30, summary: '',
    wind: { stationCount: 3, avgSpeedKt: kt, rawAvgSpeedKt: kt, dominantDir: 'SW', dirDeg: 225 },
    waves: null, effectiveWindKt: kt, gustKt, windDirDeg: 225, provisional: false, hardGateTriggered: null, thermal: null,
    computedAt: new Date(),
  } as unknown as SpotScore;
}

beforeEach(() => {
  useSectorStore.setState({ activeSectorId: 'rias', activeSector: SECTORS.find((s) => s.id === 'rias')! } as never);
  useAlertStore.setState({ risk: { score: 0, severity: 'info', color: 'green', activeCount: 0 } } as never);
  lightning.risks = [];
});

afterEach(() => {
  cleanup();
  useSpotStore.setState({ scores: new Map(), surfWaveCache: new Map(), windHistory: new Map(), favoriteSpotId: null, activeSpotId: '' } as never);
});

describe('the row of the Spots list', () => {
  it('says «racheado» for a light mean with gusts of twice its size', () => {
    useSpotStore.setState({ scores: new Map([[VAO.id, score(VAO.id, 20)]]) } as never);
    render(<SpotSelector />);
    expect(rowOf(VAO.id).querySelector('.gc-rowsub')!.textContent).toContain(GUSTY_LABEL);
  });

  it('does not say it when the gust is an ordinary one', () => {
    useSpotStore.setState({ scores: new Map([[VAO.id, score(VAO.id, 11)]]) } as never);
    render(<SpotSelector />);
    expect(rowOf(VAO.id).textContent).not.toContain(GUSTY_LABEL);
  });

  it('nor on a spot that is already navigable: the word is for «Calma» and «Flojo»', () => {
    useSpotStore.setState({ scores: new Map([[VAO.id, score(VAO.id, 26, 'sailing', 10)]]) } as never);
    render(<SpotSelector />);
    expect(rowOf(VAO.id).textContent).not.toContain(GUSTY_LABEL);
  });
});

describe('the phone pill', () => {
  it('says «racheado» on screen and in its accessible name', () => {
    useSpotStore.setState({ activeSpotId: '', scores: new Map([[VAO.id, score(VAO.id, 20)]]) } as never);
    const { container } = render(<MobileSailingBanner />);
    const pill = container.querySelector('button')!;
    expect(pill.textContent).toContain(GUSTY_LABEL);
    expect(pill.getAttribute('aria-label')).toContain(`Flojo, ${GUSTY_LABEL}, 7 kt`);
  });

  it('stays as it was with an ordinary gust', () => {
    useSpotStore.setState({ activeSpotId: '', scores: new Map([[VAO.id, score(VAO.id, 11)]]) } as never);
    const { container } = render(<MobileSailingBanner />);
    const pill = container.querySelector('button')!;
    expect(pill.textContent).not.toContain(GUSTY_LABEL);
    expect(pill.getAttribute('aria-label')).not.toContain(GUSTY_LABEL);
  });
});

describe('the shared card', () => {
  it('carries the word in its data, beside the verdict and in the text that goes with the image', () => {
    const data = buildShareData(VAO, score(VAO.id, 20));
    expect(data.gusty).toBe(true);
    expect(pillAside(data)).toBe(GUSTY_LABEL);
    expect(buildShareText(data).split('\n')[0]).toContain(`Flojo, ${GUSTY_LABEL} · 7 kt SW · rachas 20 kt`);
  });

  it('joins it to the doubt between two levels when both apply', () => {
    expect(pillAside({ doubt: 'entre Calma y Flojo', gusty: true })).toBe(`entre Calma y Flojo, ${GUSTY_LABEL}`);
    expect(pillAside({ doubt: 'entre Calma y Flojo', gusty: false })).toBe('entre Calma y Flojo');
    expect(pillAside({ doubt: null, gusty: false })).toBeNull();
  });

  it('does not carry it with an ordinary gust', () => {
    const data = buildShareData(VAO, score(VAO.id, 11));
    expect(data.gusty).toBe(false);
    expect(buildShareText(data)).not.toContain(GUSTY_LABEL);
  });
});
