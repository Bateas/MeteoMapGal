/**
 * Escape closes the station, buoy and webcam popups.
 *
 * None of them listened for the key: the mobile sheets had only the close
 * button and the swipe, and MapLibre's desktop popup ignores Escape. The same
 * two exceptions as SpotPopup apply to all of them: an aria-modal dialog on
 * top owns the key, and so does a focused text field.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';

import { StationPopup } from './StationPopup';
import { BuoyPopup } from './BuoyPopup';
import { WebcamPopup } from './WebcamPopup';
import { useWeatherSelectionStore } from '../../store/weatherSelectionStore';
import { useBuoyStore } from '../../store/buoyStore';
import { useUIStore } from '../../store/uiStore';
import { RIAS_WEBCAMS } from '../../config/webcams';
import type { NormalizedStation } from '../../types/station';
import type { BuoyReading } from '../../api/buoyClient';

const station: NormalizedStation = {
  id: 'mg_10125',
  source: 'meteogalicia',
  name: 'Estación de prueba',
  lat: 42.3,
  lon: -8.7,
  altitude: 20,
};

const buoy: BuoyReading = {
  stationId: 2248,
  stationName: 'Cabo Silleiro',
  timestamp: new Date().toISOString(),
  waveHeight: 1.2, waveHeightMax: null, wavePeriod: 9, wavePeriodMean: null, waveDir: 300,
  windSpeed: 5, windDir: 320, windGust: null,
  waterTemp: 16, airTemp: 18, airPressure: 1018,
  currentSpeed: null, currentDir: null, salinity: null, seaLevel: null,
  humidity: null, dewPoint: null,
};

function pressEscape(target: Element = document.body) {
  fireEvent.keyDown(target, { key: 'Escape' });
}

function openModalOnTop() {
  const modal = document.createElement('div');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  document.body.appendChild(modal);
}

function focusTextField() {
  const input = document.createElement('input');
  document.body.appendChild(input);
  input.focus();
  return input;
}

beforeEach(() => {
  // Nothing here should reach the network; a pending promise keeps it that way.
  vi.stubGlobal('fetch', vi.fn(() => new Promise<never>(() => {})));
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  useUIStore.setState({ isMobile: false });
});

describe.each([false, true])('isMobile=%s', (isMobile) => {
  beforeEach(() => {
    useUIStore.setState({ isMobile });
  });

  it('Escape closes the station popup', () => {
    useWeatherSelectionStore.getState().selectStation(station.id);
    render(<StationPopup station={station} />);
    pressEscape();
    expect(useWeatherSelectionStore.getState().selectedStationId).toBeNull();
  });

  it('Escape closes the buoy popup', () => {
    useBuoyStore.getState().selectBuoy(buoy.stationId);
    render(<BuoyPopup reading={buoy} />);
    pressEscape();
    expect(useBuoyStore.getState().selectedBuoyId).toBeNull();
  });

  it('Escape closes the webcam popup', () => {
    const onClose = vi.fn();
    render(<WebcamPopup webcam={RIAS_WEBCAMS[0]} onClose={onClose} />);
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Escape belongs to whatever is on top', () => {
  it('a modal dialog keeps the station popup open', () => {
    useWeatherSelectionStore.getState().selectStation(station.id);
    render(<StationPopup station={station} />);
    openModalOnTop();
    pressEscape();
    expect(useWeatherSelectionStore.getState().selectedStationId).toBe(station.id);
  });

  it('a modal dialog keeps the buoy popup open', () => {
    useBuoyStore.getState().selectBuoy(buoy.stationId);
    render(<BuoyPopup reading={buoy} />);
    openModalOnTop();
    pressEscape();
    expect(useBuoyStore.getState().selectedBuoyId).toBe(buoy.stationId);
  });

  it('a modal dialog keeps the webcam popup open', () => {
    const onClose = vi.fn();
    render(<WebcamPopup webcam={RIAS_WEBCAMS[0]} onClose={onClose} />);
    openModalOnTop();
    pressEscape();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a focused text field keeps every popup open', () => {
    useWeatherSelectionStore.getState().selectStation(station.id);
    useBuoyStore.getState().selectBuoy(buoy.stationId);
    const onClose = vi.fn();
    render(
      <>
        <StationPopup station={station} />
        <BuoyPopup reading={buoy} />
        <WebcamPopup webcam={RIAS_WEBCAMS[0]} onClose={onClose} />
      </>,
    );
    pressEscape(focusTextField());
    expect(useWeatherSelectionStore.getState().selectedStationId).toBe(station.id);
    expect(useBuoyStore.getState().selectedBuoyId).toBe(buoy.stationId);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('other keys do nothing', () => {
    const onClose = vi.fn();
    render(<WebcamPopup webcam={RIAS_WEBCAMS[0]} onClose={onClose} />);
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
