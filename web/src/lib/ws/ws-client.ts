import type { ConnectionState } from './connection-store';
import type { ClientEvent } from './server-event-types';

/** The part of the browser WebSocket the client uses (lets tests pass a fake). */
export interface WebSocketLike {
  onopen: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  close(): void;
}

export interface WsClientOptions {
  url: string;
  onEvent: (event: ClientEvent) => void;
  onStateChange: (state: ConnectionState) => void;
  createSocket?: (url: string) => WebSocketLike;
  /** First retry delay; doubles after every failed attempt up to `maxDelayMs`. */
  minDelayMs?: number;
  maxDelayMs?: number;
}

export interface WsClient {
  start(): void;
  stop(): void;
}

export const WS_MIN_DELAY_MS = 500;
export const WS_MAX_DELAY_MS = 10_000;

function parseEvent(data: unknown): ClientEvent | null {
  if (typeof data !== 'string' || data === 'pong') return null;
  try {
    const value = JSON.parse(data) as { type?: unknown };
    return value && typeof value.type === 'string' ? (value as ClientEvent) : null;
  } catch {
    return null;
  }
}

/**
 * One WebSocket with reconnect (backoff 0.5 s → 10 s). After a reconnect it emits a synthetic
 * `resync` event, because changes made while the socket was down were never pushed.
 */
export function createWsClient(options: WsClientOptions): WsClient {
  const minDelay = options.minDelayMs ?? WS_MIN_DELAY_MS;
  const maxDelay = options.maxDelayMs ?? WS_MAX_DELAY_MS;
  const createSocket = options.createSocket ?? ((url) => new WebSocket(url));
  let socket: WebSocketLike | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let delay = minDelay;
  let hasOpened = false;
  let stopped = true;

  function scheduleReconnect() {
    if (stopped || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      connect();
    }, delay);
    delay = Math.min(delay * 2, maxDelay);
  }

  function connect() {
    if (stopped) return;
    options.onStateChange('connecting');
    let current: WebSocketLike;
    try {
      current = createSocket(options.url);
    } catch {
      options.onStateChange('closed');
      scheduleReconnect();
      return;
    }
    socket = current;
    current.onopen = () => {
      if (socket !== current) return;
      delay = minDelay;
      options.onStateChange('open');
      if (hasOpened) options.onEvent({ type: 'resync' });
      hasOpened = true;
    };
    current.onmessage = (message) => {
      if (socket !== current) return;
      const event = parseEvent(message.data);
      if (event) options.onEvent(event);
    };
    current.onerror = () => {
      // Every error is followed by a close event; reconnecting happens there.
    };
    current.onclose = () => {
      if (socket !== current) return;
      socket = null;
      options.onStateChange('closed');
      scheduleReconnect();
    };
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      connect();
    },
    stop() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      const current = socket;
      socket = null;
      if (current) {
        current.onclose = null;
        current.close();
      }
    },
  };
}
