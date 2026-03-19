import { useState, useCallback, useEffect, useRef, memo } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import type maplibregl from 'maplibre-gl';
import { useWeatherStore } from '../../store/weatherStore';
import { useWeatherSelectionStore } from '../../store/weatherSelectionStore';
import { useToastStore } from '../../store/toastStore';
import { WeatherIcon } from '../icons/WeatherIcons';

interface ContextMenuState {
  x: number;       // screen x
  y: number;       // screen y
  lng: number;     // map longitude
  lat: number;     // map latitude
}

/**
 * Right-click context menu for the map.
 * Shows coords, copy option, and distance to nearest station.
 */
export const MapContextMenu = memo(function MapContextMenu({
  mapRef,
}: {
  mapRef: React.RefObject<MapRef | null>;
}) {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const stations = useWeatherStore((s) => s.stations);
  const selectStation = useWeatherSelectionStore((s) => s.selectStation);

  // ── Open on right-click ────────────────────────────────
  const handleContextMenu = useCallback((e: maplibregl.MapMouseEvent) => {
    e.preventDefault();
    const { lng, lat } = e.lngLat;
    const { x, y } = e.point;
    setMenu({ x, y, lng, lat });
  }, []);

  // ── Close on click outside / Escape ────────────────────
  useEffect(() => {
    if (!menu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('keydown', handleKey);
    };
  }, [menu]);

  // ── Attach to map ─────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    map.on('contextmenu', handleContextMenu);
    // Close menu on map move
    const handleMove = () => setMenu(null);
    map.on('movestart', handleMove);
    return () => {
      map.off('contextmenu', handleContextMenu);
      map.off('movestart', handleMove);
    };
  }, [mapRef, handleContextMenu]);

  if (!menu) return null;

  // ── Compute nearest station ────────────────────────────
  const nearest = findNearestStation(menu.lat, menu.lng, stations);

  // ── Actions ────────────────────────────────────────────
  const copyCoords = () => {
    const text = `${menu.lat.toFixed(5)}, ${menu.lng.toFixed(5)}`;
    navigator.clipboard.writeText(text).then(() => {
      useToastStore.getState().addToast(`Coordenadas copiadas: ${text}`, 'success');
    });
    setMenu(null);
  };

  const goToNearest = () => {
    if (nearest) {
      selectStation(nearest.station.id);
    }
    setMenu(null);
  };

  // ── Position: keep menu inside viewport ────────────────
  const menuWidth = 220;
  const menuHeight = nearest ? 120 : 80;
  const left = menu.x + menuWidth > window.innerWidth ? menu.x - menuWidth : menu.x;
  const top = menu.y + menuHeight > window.innerHeight ? menu.y - menuHeight : menu.y;

  return (
    <div
      ref={menuRef}
      className="absolute z-50 bg-slate-900/95 backdrop-blur-md border border-slate-600/50 rounded-lg shadow-xl overflow-hidden"
      style={{ left, top, minWidth: menuWidth }}
    >
      {/* Coords header */}
      <div className="px-3 py-2 border-b border-slate-700/50">
        <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Coordenadas</div>
        <div className="text-xs text-slate-200 font-mono">
          {menu.lat.toFixed(5)}°N, {Math.abs(menu.lng).toFixed(5)}°{menu.lng < 0 ? 'W' : 'E'}
        </div>
      </div>

      {/* Actions */}
      <div className="py-1">
        <button
          onClick={copyCoords}
          className="w-full px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-slate-700/60 hover:text-white transition-colors flex items-center gap-2"
        >
          <span className="text-sm">📋</span>
          Copiar coordenadas
        </button>

        {nearest && (
          <button
            onClick={goToNearest}
            className="w-full px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-slate-700/60 hover:text-white transition-colors flex items-center gap-2"
          >
            <WeatherIcon id="map-pin" size={12} />
            <span className="flex-1 truncate">
              Ir a <span className="font-medium text-sky-400">{nearest.station.name}</span>
            </span>
            <span className="text-[10px] text-slate-500 font-mono shrink-0">
              {formatDistance(nearest.distanceKm)}
            </span>
          </button>
        )}
      </div>
    </div>
  );
});

// ── Helpers ──────────────────────────────────────────────

function findNearestStation(
  lat: number,
  lng: number,
  stations: { id: string; name: string; lat: number; lon: number }[],
): { station: typeof stations[0]; distanceKm: number } | null {
  if (stations.length === 0) return null;

  let closest = stations[0];
  let minDist = haversineKm(lat, lng, closest.lat, closest.lon);

  for (let i = 1; i < stations.length; i++) {
    const d = haversineKm(lat, lng, stations[i].lat, stations[i].lon);
    if (d < minDist) {
      minDist = d;
      closest = stations[i];
    }
  }

  return { station: closest, distanceKm: minDist };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}
