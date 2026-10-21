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

/** `GET /graph` on open, again after vault changes (debounced) and after a reconnect. */
export function useGraphData() {
  const [state, setState] = useState<GraphDataState>({ status: 'loading' });
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const id = ++sequence.current;
    try {
      const data = await getGraph();
      if (id === sequence.current) setState({ status: 'ready', data });
    } catch {
      // A failed refresh keeps the map on screen.
      if (id === sequence.current) {
        setState((previous) => (previous.status === 'ready' ? previous : { status: 'error' }));
      }
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

  return { state, retry };
}
