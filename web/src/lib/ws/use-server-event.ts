import { useEffect, useRef } from 'react';
import { subscribeServerEvent } from './server-event-bus';
import type { ClientEvent, ClientEventOf, ClientEventType } from './server-event-types';

/**
 * Runs `handler` for every event of `type` (or `'*'`) while the component is mounted. The latest
 * handler is always used, so callers need not memoize it.
 */
export function useServerEvent<T extends ClientEventType>(
  type: T,
  handler: (event: ClientEventOf<T>) => void,
): void;
export function useServerEvent(type: '*', handler: (event: ClientEvent) => void): void;
export function useServerEvent(
  type: ClientEventType | '*',
  handler: (event: ClientEvent) => void,
): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(
    () => subscribeServerEvent(type as '*', (event: ClientEvent) => ref.current(event)),
    [type],
  );
}
