import type { ClientEvent, ClientEventOf, ClientEventType } from './server-event-types';

type Handler = (event: ClientEvent) => void;

const handlers = new Map<ClientEventType | '*', Set<Handler>>();

/**
 * Subscribes to one event type (or `'*'` for all). Returns the unsubscribe function. A handler
 * that throws never stops the others.
 */
export function subscribeServerEvent<T extends ClientEventType>(
  type: T,
  handler: (event: ClientEventOf<T>) => void,
): () => void;
export function subscribeServerEvent(type: '*', handler: (event: ClientEvent) => void): () => void;
export function subscribeServerEvent(type: ClientEventType | '*', handler: Handler): () => void {
  let set = handlers.get(type);
  if (!set) {
    set = new Set();
    handlers.set(type, set);
  }
  set.add(handler);
  return () => {
    handlers.get(type)?.delete(handler);
  };
}

/** Delivers an event to its type's handlers, then to the `'*'` handlers. */
export function emitServerEvent(event: ClientEvent): void {
  for (const key of [event.type, '*'] as const) {
    for (const handler of [...(handlers.get(key) ?? [])]) {
      try {
        handler(event);
      } catch (error) {
        console.error('server event handler failed', error);
      }
    }
  }
}

/** Test helper: forget every subscription. */
export function clearServerEventHandlers(): void {
  handlers.clear();
}
