import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getGraph } from '../../lib/api/graph-api';
import type { GraphResponse } from '../../lib/api/graph-types';
import { debounce } from '../../lib/debounce';
import { useServerEvent } from '../../lib/ws/use-server-event';
import { isVaultChange } from '../backlinks/use-panel-note';

/** Vault changes come in bursts (autosave, relink): the map refetches once they settle. */
export const GRAPH_REFRESH_MS = 500;

export type GraphDataState =
  { status: 'loading' } | { status: 'ready'; data: GraphResponse } | { status: 'error' };

/**
 * `GET /graph` on open, again after vault changes (debounced) and after a reconnect; `reload`
 * refetches at once.
 */
export function useGraphData() {
  const [state, setState] = useState<GraphDataState>({ status: 'loading' });
  const sequence = useRef(0);

  /** Resolves false when the request failed. */
  const load = useCallback(async () => {
    const id = ++sequence.current;
    try {
      const data = await getGraph();
      if (id === sequence.current) setState({ status: 'ready', data });
      return true;
    } catch {
      // A failed refresh keeps the map on screen.
      if (id === sequence.current) {
        setState((previous) => (previous.status === 'ready' ? previous : { status: 'error' }));
      }
      return false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useMemo(() => debounce(() => void load(), GRAPH_REFRESH_MS), [load]);
  useEffect(() => () => refresh.cancel(), [refresh]);
  useServerEvent('*', (event) => {
    if (isVaultChange(event)) refresh.schedule();
  });

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    void load();
  }, [load]);

  /** Refetches at once, keeping the map on screen (nodes named by "AI vừa chạm" are missing). */
  const reload = useCallback(() => {
    refresh.cancel();
    return load();
  }, [load, refresh]);

  return { state, retry, reload };
}
