import type { FastifyInstance } from 'fastify';
import type { ServerEvent } from './server-events.js';
import type { WebSocketHub } from './websocket-hub.js';

export interface HelloMessage {
  type: 'hello';
  version: string;
}

export interface WebSocketRouteOptions {
  /** Receives every accepted socket so vault and index events reach it. */
  hub?: WebSocketHub;
  /** Sends the connection-time state (e.g. unfinished journal operations) after `hello`. */
  onConnect?: (send: (event: ServerEvent) => void) => void | Promise<void>;
}

/**
 * `/ws` event channel. Authentication (token + Origin + Host) happens in the root security
 * hook before the upgrade is accepted; by the time this handler runs the client is trusted.
 * The client only ever sends `ping`; everything else flows server → client.
 */
export function registerWebSocketRoute(
  app: FastifyInstance,
  version: string,
  options: WebSocketRouteOptions = {},
): void {
  app.get('/ws', { websocket: true }, (socket) => {
    const hello: HelloMessage = { type: 'hello', version };
    socket.send(JSON.stringify(hello));
    socket.on('message', (data) => {
      if (String(data) === 'ping') socket.send('pong');
    });
    if (!options.hub) return;
    const hub = options.hub;
    hub.add(socket);
    void Promise.resolve(options.onConnect?.((event) => hub.send(socket, event))).catch(() => {
      // Connection-time state is best-effort; the client can still call the REST endpoints.
    });
  });
}
