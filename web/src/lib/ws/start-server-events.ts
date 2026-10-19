import { useConnectionStore } from './connection-store';
import { emitServerEvent } from './server-event-bus';
import { createWsClient, type WsClient, type WsClientOptions } from './ws-client';

/** `ws://<host>/ws?token=…` on the page's own origin (the server checks Host, Origin and token). */
export function serverEventsUrl(token: string | null, loc: Location = window.location): string {
  const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${protocol}//${loc.host}/ws${query}`;
}

/**
 * Connects the app's single WebSocket: events go to the bus, the state to the connection store.
 * Returns a stop function.
 */
export function startServerEvents(
  token: string | null,
  overrides: Partial<Pick<WsClientOptions, 'createSocket' | 'url'>> = {},
): () => void {
  const client: WsClient = createWsClient({
    url: overrides.url ?? serverEventsUrl(token),
    createSocket: overrides.createSocket,
    onEvent: emitServerEvent,
    onStateChange: (state) => useConnectionStore.getState().setState(state),
  });
  client.start();
  return () => client.stop();
}
