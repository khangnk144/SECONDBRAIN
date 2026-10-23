import { useCallback, useEffect, useRef, useState } from 'react';
import { vaultStorage } from '../../lib/vault-storage';
import { useVaultStore } from '../../lib/vault-store';
import {
  GRAPH_FILTER_STORAGE_KEY,
  NO_GRAPH_FILTER,
  parseStoredGraphFilter,
  parseWhenParam,
  type GraphFilterState,
} from './graph-filter-state';

function initial(when: string | null): GraphFilterState {
  const window = parseWhenParam(when);
  if (window) return { ...NO_GRAPH_FILTER, time: window };
  return parseStoredGraphFilter(vaultStorage.get<unknown>(GRAPH_FILTER_STORAGE_KEY, null));
}

/**
 * The map's filter state (SPEC F24.2): remembered per vault; `?when=today|7d|30d` starts a visit
 * with only that time window (other filters cleared, the remembered ones kept for later visits).
 * Only changes the person makes are saved.
 */
export function useGraphFilter(when: string | null) {
  const [state, setState] = useState<GraphFilterState>(() => initial(when));
  const appliedWhen = useRef(when);
  const vaultId = useVaultStore((store) => store.vaultId);
  const readFor = useRef(vaultId);

  // The vault id arrives after the first render on a reload straight into the map (and changes
  // on a vault switch): read that vault's remembered filter then, unless a `?when=` visit runs.
  useEffect(() => {
    if (readFor.current === vaultId) return;
    readFor.current = vaultId;
    if (parseWhenParam(appliedWhen.current)) return;
    setState(initial(null));
  }, [vaultId]);

  // Following a `?when=` link while the map is already open applies it too.
  useEffect(() => {
    if (appliedWhen.current === when) return;
    appliedWhen.current = when;
    const window = parseWhenParam(when);
    if (window) setState({ ...NO_GRAPH_FILTER, time: window });
  }, [when]);

  const update = useCallback((next: GraphFilterState) => {
    setState(next);
    vaultStorage.set(GRAPH_FILTER_STORAGE_KEY, next);
  }, []);

  const clear = useCallback(() => update(NO_GRAPH_FILTER), [update]);

  return { state, update, clear };
}
