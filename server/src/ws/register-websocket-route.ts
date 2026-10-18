import type { FastifyInstance } from 'fastify';

export interface HelloMessage {
  type: 'hello';
  version: string;
}

/**
 * `/ws` event channel. Authentication (token + Origin + Host) happens in the root security
 * hook before the upgrade is accepted; by the time this handler runs the client is trusted.
 * Later milestones broadcast note/index/reminder events over these sockets.
 */
export function registerWebSocketRoute(app: FastifyInstance, version: string): void {
  app.get('/ws', { websocket: true }, (socket) => {
    const hello: HelloMessage = { type: 'hello', version };
    socket.send(JSON.stringify(hello));
    socket.on('message', (data) => {
      // Only a ping/pong keep-alive is understood for now.
      if (String(data) === 'ping') socket.send('pong');
    });
  });
}
