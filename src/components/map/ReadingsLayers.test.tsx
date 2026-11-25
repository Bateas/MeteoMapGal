import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

/**
 * Simple mode used to drop the station markers and the wind arrows, and a new
 * visitor (who now starts in simple mode) landed on a map with nothing but the
 * spots. Both layers stay; simple mode only removes the source initials.
 */
const seen = vi.hoisted(() => ({ wind: [] as Array<{ muted?: boolean }>, stations: [] as Array<{ hideSourceLabels?: boolean; muted?: boolean; faint?: boolean }> }));

vi.mock('./WindFieldOverlay', () => ({
  WindFieldOverlay: (p: { muted?: boolean }) => { seen.wind.push(p); return null; },
}));
vi.mock('./StationSymbolLayer', () => ({
  StationSymbolLayer: (p: { hideSourceLabels?: boolean; muted?: boolean; faint?: boolean }) => { seen.stations.push(p); return null; },
}));
vi.mock('./StationPopup', () => ({ StationPopup: () => null }));

import { ReadingsLayers } from './ReadingsLayers';

function renderLayers(simpleMode: boolean) {
  return render(
    <ReadingsLayers simpleMode={simpleMode} zoomLevel={10} selectedStationId={null} onSelectStation={() => {}} />,
  );
}

describe('ReadingsLayers — simple mode keeps stations and wind', () => {
  beforeEach(() => { cleanup(); seen.wind = []; seen.stations = []; });

  it('simple mode still draws the wind arrows and the station markers', () => {
    renderLayers(true);
    expect(seen.wind.length).toBeGreaterThan(0);
    expect(seen.stations.length).toBeGreaterThan(0);
  });

  it('simple mode drops the source initials and mutes the stations', () => {
    renderLayers(true);
    expect(seen.stations.at(-1)?.hideSourceLabels).toBe(true);
    expect(seen.stations.at(-1)?.faint).toBe(true);
  });

  it('simple mode mutes the wind arrows too, so the spots lead', () => {
    renderLayers(true);
    expect(seen.wind.at(-1)?.muted).toBe(true);
  });

  it('advanced mode shows the initials and the full colours', () => {
    renderLayers(false);
    expect(seen.stations.at(-1)?.hideSourceLabels).toBe(false);
    expect(seen.stations.at(-1)?.faint).toBe(false);
    expect(seen.wind.at(-1)?.muted).toBe(false);
  });
});
