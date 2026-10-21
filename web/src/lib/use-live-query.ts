/**
 * Server data that stays current by itself: fetched on mount and when `key` changes, refetched
 * (debounced, old data kept on screen) whenever the vault may have changed – file and folder
 * events, a reconnect, the end of an index rebuild – and when the local day changes (Today's
 * buckets move at midnight). A slower, older response never overwrites a newer one.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { debounce } from './debounce';
import { subscribeLocalDay } from './local-day';
import { subscribeServerEvent } from './ws/server-event-bus';
import type { ClientEvent } from './ws/server-event-types';

export const LIVE_QUERY_DEBOUNCE_MS = 150;

export type LiveQueryStatus = 'loading' | 'ready' | 'error';

export interface LiveQuery<T> {
  data: T | undefined;
  /** Error of the latest failed fetch; cleared by the next success. */
  error: unknown;
  /** `error` only while there is no data to show; a failed refetch keeps the old data `ready`. */
  status: LiveQueryStatus;
  /** Key the current `data` was fetched for (differs from `key` while a new key loads). */
  dataKey: string | undefined;
  /** Fetches now; resolves when that request settled (applied or dropped as stale). */
  refresh: () => Promise<void>;
  /** Local, optimistic change of the data on screen; older in-flight responses are dropped. */
  mutate: (update: (data: T) => T) => void;
}

interface State<T> {
  data: T | undefined;
  dataKey: string | undefined;
  error: unknown;
  status: LiveQueryStatus;
}

/** Events after which the deadline views and lists may be out of date. */
export function invalidatesVaultData(event: ClientEvent): boolean {
  switch (event.type) {
    case 'note:changed':
    case 'note:created':
    case 'note:deleted':
    case 'note:renamed':
    case 'folder:changed':
    case 'resync':
      return true;
    case 'index:progress':
      return event.phase === 'done';
    default:
      return false;
  }
}

export function useLiveQuery<T>(key: string, fetcher: () => Promise<T>): LiveQuery<T> {
  const [state, setState] = useState<State<T>>({
    data: undefined,
    dataKey: undefined,
    error: undefined,
    status: 'loading',
  });
  const fetcherRef = useRef(fetcher);
  const keyRef = useRef(key);
  useEffect(() => {
    fetcherRef.current = fetcher;
    keyRef.current = key;
  });
  /** Only the response of request number `seq` may land on screen. */
  const seq = useRef(0);
  const inFlight = useRef(0);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    const requestKey = keyRef.current;
    inFlight.current += 1;
    try {
      const data = await fetcherRef.current();
      if (mine !== seq.current || !mounted.current) return;
      setState({ data, dataKey: requestKey, error: undefined, status: 'ready' });
    } catch (error) {
      if (mine !== seq.current || !mounted.current) return;
      setState((s) => ({ ...s, error, status: s.data === undefined ? 'error' : 'ready' }));
    } finally {
      inFlight.current -= 1;
    }
  }, []);

  const [refetch] = useState(() => debounce(() => void load(), LIVE_QUERY_DEBOUNCE_MS));

  useEffect(() => {
    mounted.current = true;
    const stops = [
      subscribeServerEvent('*', (event) => {
        if (invalidatesVaultData(event)) refetch.schedule();
      }),
      subscribeLocalDay(() => refetch.schedule()),
    ];
    return () => {
      mounted.current = false;
      refetch.cancel();
      stops.forEach((stop) => stop());
    };
  }, [refetch]);

  useEffect(() => {
    // A new key loads at once; the previous key's data stays until the answer arrives.
    refetch.cancel();
    setState((s) => (s.status === 'loading' ? s : { ...s, status: 'loading' }));
    void load();
  }, [key, load, refetch]);

  const refresh = useCallback(() => {
    refetch.cancel();
    return load();
  }, [load, refetch]);

  const mutate = useCallback(
    (update: (data: T) => T) => {
      setState((s) => (s.data === undefined ? s : { ...s, data: update(s.data) }));
      // A request already in flight was asked before this change and would undo it on screen:
      // drop it and ask again once things settle.
      if (inFlight.current > 0) {
        seq.current += 1;
        refetch.schedule();
      }
    },
    [refetch],
  );

  return { ...state, refresh, mutate };
}
