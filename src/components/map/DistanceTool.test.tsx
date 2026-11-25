/** The measuring tool (P3 review, batch 2, 19-nov): a change of sector ends the measure. */
import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';

vi.mock('react-map-gl/maplibre', () => ({ Source: () => null, Layer: () => null, Marker: () => null }));

import { DistanceTool } from './DistanceTool';
import { useSectorStore } from '../../store/sectorStore';

describe('the measuring tool', () => {
  it('turns off when the sector changes, and only then', () => {
    useSectorStore.getState().switchSector('rias');
    const onDeactivate = vi.fn();
    const mapRef = { current: null };
    const view = render(<DistanceTool mapRef={mapRef} isActive onDeactivate={onDeactivate} />);
    view.rerender(<DistanceTool mapRef={mapRef} isActive onDeactivate={onDeactivate} />);
    expect(onDeactivate).not.toHaveBeenCalled();
    act(() => { useSectorStore.getState().switchSector('embalse'); });
    expect(onDeactivate).toHaveBeenCalledTimes(1);
  });
});
