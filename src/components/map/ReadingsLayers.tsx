/**
 * ReadingsLayers — per-poll commit isolation for the weather map.
 *
 * `weatherStore.currentReadings` (Map) and `stations` (array) get a NEW
 * reference on every 60s poll. When WeatherMap itself subscribed to them,
 * the ENTIRE map tree committed on each poll — a hitch if the update landed
 * mid-pan gesture. This wrapper subscribes to those two fields itself, so a
 * poll only re-renders the three station layers (and the selected-station
 * popup), not the whole map.
 *
 * IMPORTANT: render order here mirrors the exact previous JSX order inside
 * WeatherMap (WindFieldOverlay -> StationSymbolLayer) —
 * Source/Layer mount order determines MapLibre z-order. Do not reorder.
 */
import { memo, useMemo } from 'react';
import { useWeatherStore } from '../../store/weatherStore';
import { StationSymbolLayer } from './StationSymbolLayer';
import { WindFieldOverlay } from './WindFieldOverlay';
import { StationPopup } from './StationPopup';
import type { BuoyReading } from '../../api/buoyClient';

interface ReadingsLayersProps {
  /** Simple mode keeps stations and their wind, quieter so the spots lead, and drops the source initials. */
  simpleMode: boolean;
  /** Buoy readings for hex wind arrows — pass undefined for inland sectors. */
  buoys?: BuoyReading[];
  zoomLevel: number;
  selectedStationId: string | null;
  onSelectStation: (id: string | null) => void;
}

export const ReadingsLayers = memo(function ReadingsLayers({
  simpleMode,
  buoys,
  zoomLevel,
  selectedStationId,
  onSelectStation,
}: ReadingsLayersProps) {
  const stations = useWeatherStore((s) => s.stations);
  const currentReadings = useWeatherStore((s) => s.currentReadings);

  return (
    <>
      {/* Wind field arrows around stations + buoys. Shown in simple mode too:
          a map with only the spots looked empty, and the arrows are the wind.
          There they are smaller and fainter, keeping their colour, so the spots lead. */}
      <WindFieldOverlay
        stations={stations}
        readings={currentReadings}
        buoys={buoys}
        compact={stations.length > 35}
        zoomLevel={zoomLevel}
        muted={simpleMode}
      />


      {/* Station markers — GPU symbol layer. In simple mode they stay, without
          the source initials and fainter, so the spots lead. */}
      <StationSymbolLayer
        stations={stations}
        readings={currentReadings}
        selectedStationId={selectedStationId}
        onSelectStation={onSelectStation}
        zoomLevel={zoomLevel}
        hideSourceLabels={simpleMode}
        faint={simpleMode}
      />
    </>
  );
});

/** Selected-station popup, isolated for the same per-poll reason: it needs
 *  `stations` (to resolve the id) and `currentReadings` (fresh reading), so
 *  subscribing here keeps WeatherMap free of both fields. Renders null when
 *  nothing is selected — the per-poll re-render is then trivially cheap. */
export function SelectedStationPopup({ selectedStationId }: { selectedStationId: string | null }) {
  const stations = useWeatherStore((s) => s.stations);
  const currentReadings = useWeatherStore((s) => s.currentReadings);

  const selectedStation = useMemo(
    () => stations.find((s) => s.id === selectedStationId),
    [stations, selectedStationId],
  );

  if (!selectedStation) return null;
  return (
    <StationPopup
      key={selectedStation.id}
      station={selectedStation}
      reading={currentReadings.get(selectedStation.id)}
    />
  );
}
