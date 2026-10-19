import type { ServerEvent } from './server-events.js';

/** The part of a `ws` WebSocket the hub needs (keeps the hub testable without a server). */
export interface HubSocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string): void;
  terminate(): void;
  on(event: 'close', listener: () => void): unknown;
}

const OPEN = 1;
/** A client that stopped reading (sleeping tab, stuck devtools) must not grow server memory. */
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

export interface WebSocketHub {
  /** Tracks a connected socket until it closes. */
  add(socket: HubSocket): void;
  send(socket: HubSocket, event: ServerEvent): void;
  broadcast(event: ServerEvent): void;
  readonly size: number;
}

export function createWebSocketHub(): WebSocketHub {
  const sockets = new Set<HubSocket>();

  function send(socket: HubSocket, payload: string): void {
    if (socket.readyState !== OPEN) return;
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      // The client reconnects and reloads its views; better than unbounded buffering.
      sockets.delete(socket);
      socket.terminate();
      return;
    }
    try {
      socket.send(payload);
    } catch {
      sockets.delete(socket);
    }
  }

  return {
    add(socket) {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    },
    send(socket, event) {
      send(socket, JSON.stringify(event));
    },
    broadcast(event) {
      const payload = JSON.stringify(event);
      for (const socket of [...sockets]) send(socket, payload);
    },
    get size() {
      return sockets.size;
    },
  };
}
