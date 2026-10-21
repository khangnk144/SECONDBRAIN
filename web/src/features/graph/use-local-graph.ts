import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isApiError } from '../../lib/api-client';
import { getLocalGraph } from '../../lib/api/graph-api';
import type { GraphResponse, LocalGraphDepth } from '../../lib/api/graph-types';
import type { VaultPath } from '../../lib/api/vault-types';
import { debounce } from '../../lib/debounce';
import { useServerEvent } from '../../lib/ws/use-server-event';
import { isVaultChange } from '../backlinks/use-panel-note';
import { layoutGraph } from './graph-layout';
import { indexOfPath, buildGraphModel } from './graph-model';
import { GraphScene } from './graph-scene';
import { GRAPH_REFRESH_MS } from './use-graph-data';

export type LocalGraphState =
  | { status: 'loading' }
  | { status: 'ready'; data: GraphResponse }
  | { status: 'error'; notFound: boolean };

/**
 * `GET /graph/local` for the note's right panel, while the section is expanded; refetched after
 * vault changes (debounced) and after a reconnect.
 */
export function useLocalGraph(path: VaultPath, depth: LocalGraphDepth, enabled: boolean) {
  const [state, setState] = useState<LocalGraphState>({ status: 'loading' });
  const sequence = useRef(0);
  const latest = useRef({ path, depth, enabled });
  latest.current = { path, depth, enabled };

  const load = useCallback(async () => {
    const { path: target, depth: hops, enabled: active } = latest.current;
    if (!active) return;
    const id = ++sequence.current;
    try {
      const data = await getLocalGraph(target, hops);
      if (id === sequence.current) setState({ status: 'ready', data });
    } catch (error) {
      if (id !== sequence.current) return;
      const notFound = isApiError(error, 'NOT_FOUND');
      setState((previous) =>
        previous.status === 'ready' && !notFound ? previous : { status: 'error', notFound },
      );
    }
  }, []);

  // Another note starts from a loading state; another depth keeps the current graph (and the
  // focused depth checkbox) on screen until the answer arrives.
  const shownPath = useRef<VaultPath | null>(null);
  useEffect(() => {
    if (!enabled) return;
    if (shownPath.current !== path) setState({ status: 'loading' });
    shownPath.current = path;
    void load();
  }, [path, depth, enabled, load]);

  const refresh = useMemo(() => debounce(() => void load(), GRAPH_REFRESH_MS), [load]);
  useEffect(() => () => refresh.cancel(), [refresh]);
  useServerEvent('*', (event) => {
    if (isVaultChange(event)) refresh.schedule();
  });

  return state;
}

export interface LocalScene {
  scene: GraphScene;
  /** Index of the note itself, or -1 when the response does not contain it. */
  center: number;
}

/** Static scene of a local graph: laid out to the end at once, the note's own label pinned. */
export function useLocalScene(data: GraphResponse | null, path: VaultPath): LocalScene | null {
  return useMemo(() => {
    if (!data) return null;
    const model = buildGraphModel(data);
    const { simulation } = layoutGraph(model);
    const scene = new GraphScene(model, simulation);
    const center = indexOfPath(model, path);
    scene.pinnedLabel = center;
    scene.refreshHighlight();
    return { scene, center };
  }, [data, path]);
}
