import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

/**
 * Simple mode used to drop the station markers and the wind arrows, and a new
 * visitor (who now starts in simple mode) landed on a map with nothing but the
 * spots. Both layers stay; simple mode only removes the source initials.
 */
const seen = vi.hoisted(() => ({ wind: 0, stations: [] as Array<{ hideSourceLabels?: boolean; muted?: boolean }> }));

vi.mock('./WindFieldOverlay', () => ({
  WindFieldOverlay: () => { seen.wind++; return null; },
}));
vi.mock('./StationSymbolLayer', () => ({
  StationSymbolLayer: (p: { hideSourceLabels?: boolean; muted?: boolean }) => { seen.stations.push(p); return null; },
}));
vi.mock('./TempOnlyMarker', () => ({ TempOnlyOverlay: () => null }));
vi.mock('./StationPopup', () => ({ StationPopup: () => null }));

import { ReadingsLayers } from './ReadingsLayers';

function renderLayers(simpleMode: boolean) {
  return render(
    <ReadingsLayers simpleMode={simpleMode} zoomLevel={10} selectedStationId={null} onSelectStation={() => {}} />,
  );
}

describe('ReadingsLayers — simple mode keeps stations and wind', () => {
  beforeEach(() => { cleanup(); seen.wind = 0; seen.stations = []; });

  it('simple mode still draws the wind arrows and the station markers', () => {
    renderLayers(true);
    expect(seen.wind).toBeGreaterThan(0);
    expect(seen.stations.length).toBeGreaterThan(0);
  });

  it('simple mode drops the source initials and mutes the stations', () => {
    renderLayers(true);
    expect(seen.stations.at(-1)?.hideSourceLabels).toBe(true);
    expect(seen.stations.at(-1)?.muted).toBe(true);
  });

  it('advanced mode shows the initials and the full colours', () => {
    renderLayers(false);
    expect(seen.stations.at(-1)?.hideSourceLabels).toBe(false);
    expect(seen.stations.at(-1)?.muted).toBe(false);
  });
});
