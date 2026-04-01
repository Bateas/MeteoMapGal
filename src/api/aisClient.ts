/**
 * AIS ship tracking via aisstream.io WebSocket.
 * Connects only when overlay is active (Rías sector).
 * Bounding box covers Ría de Vigo + Ría de Pontevedra area.
 */
import type { Vessel } from '../types/ais';
import { mapShipType } from '../types/ais';

const WS_URL = 'wss://stream.aisstream.io/v0/stream';
const API_KEY = import.meta.env.VITE_AISSTREAM_API_KEY || '';

/** Ría de Vigo + Pontevedra bounding box */
const BOUNDING_BOX = [
  [[-8.95, 42.05], [-8.45, 42.45]],
];

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectDelay = 1000;
let intentionalClose = false;

// Ship static data cache (name, type, destination from ShipStaticData messages)
const staticCache = new Map<number, { name: string; type: number; destination: string }>();

export type AISMessageCallback = (vessel: Vessel) => void;

function parsePositionReport(msg: any): Vessel | null {
  try {
    const meta = msg.MetaData;
    const pos = msg.Message?.PositionReport;
    if (!pos || !meta) return null;

    const mmsi = meta.MMSI;
    const lat = pos.Latitude;
    const lon = pos.Longitude;
    if (lat == null || lon == null || lat === 0 || lon === 0) return null;

    const heading = pos.TrueHeading === 511 ? pos.Cog ?? 0 : pos.TrueHeading;
    const cached = staticCache.get(mmsi);

    return {
      mmsi,
      name: cached?.name || meta.ShipName?.trim() || `MMSI ${mmsi}`,
      type: cached ? mapShipType(cached.type) : 'other',
      lat,
      lon,
      cog: pos.Cog ?? 0,
      heading,
      sog: pos.Sog ?? 0,
      destination: cached?.destination || '',
      lastUpdate: Date.now(),
    };
  } catch {
    return null;
  }
}

function parseShipStaticData(msg: any): void {
  try {
    const meta = msg.MetaData;
    const data = msg.Message?.ShipStaticData;
    if (!data || !meta) return;
    staticCache.set(meta.MMSI, {
      name: data.Name?.trim() || meta.ShipName?.trim() || '',
      type: data.Type ?? 0,
      destination: data.Destination?.trim() || '',
    });
  } catch {
    // ignore parse errors
  }
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send('{}'); // keepalive ping
    }
  }, 30_000);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

export function connectAIS(
  onMessage: AISMessageCallback,
  onConnect?: () => void,
  onDisconnect?: () => void,
  onError?: (err: string) => void,
): void {
  if (!API_KEY) {
    onError?.('VITE_AISSTREAM_API_KEY not configured');
    return;
  }
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;

  intentionalClose = false;

  try {
    ws = new WebSocket(WS_URL);
  } catch (e) {
    onError?.(`WebSocket creation failed: ${e}`);
    scheduleReconnect(onMessage, onConnect, onDisconnect, onError);
    return;
  }

  ws.onopen = () => {
    reconnectDelay = 1000; // reset backoff
    ws!.send(JSON.stringify({
      APIKey: API_KEY,
      BoundingBoxes: BOUNDING_BOX,
      FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
    }));
    startHeartbeat();
    onConnect?.();
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      const msgType = msg.MessageType;

      if (msgType === 'PositionReport') {
        const vessel = parsePositionReport(msg);
        if (vessel) onMessage(vessel);
      } else if (msgType === 'ShipStaticData') {
        parseShipStaticData(msg);
      }
    } catch {
      // ignore malformed messages
    }
  };

  ws.onclose = () => {
    stopHeartbeat();
    onDisconnect?.();
    if (!intentionalClose) {
      scheduleReconnect(onMessage, onConnect, onDisconnect, onError);
    }
  };

  ws.onerror = () => {
    onError?.('WebSocket error');
    ws?.close();
  };
}

function scheduleReconnect(
  onMessage: AISMessageCallback,
  onConnect?: () => void,
  onDisconnect?: () => void,
  onError?: (err: string) => void,
) {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    connectAIS(onMessage, onConnect, onDisconnect, onError);
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 30_000); // exponential backoff, max 30s
}

export function disconnectAIS(): void {
  intentionalClose = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  stopHeartbeat();
  if (ws) {
    ws.close();
    ws = null;
  }
  staticCache.clear();
}
