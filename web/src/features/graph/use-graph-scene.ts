import { useEffect, useRef, useState } from 'react';
import type { GraphResponse } from '../../lib/api/graph-types';
import { layoutGraph, positionsOf } from './graph-layout';
import { buildGraphModel } from './graph-model';
import { GraphScene } from './graph-scene';

export interface GraphSceneState {
  scene: GraphScene | null;
  /** The first scene of this screen (intro and fit); refreshes keep positions and the view. */
  first: boolean;
}

/**
 * Builds and lays out a scene for each new response. The layout blocks the main thread for up
 * to the layout budget, so it starts in a task after the loading state has been painted. A
 * refresh keeps the positions of nodes that were already on the map.
 */
export function useGraphScene(data: GraphResponse | null): GraphSceneState {
  const [state, setState] = useState<GraphSceneState>({ scene: null, first: true });
  const current = useRef<GraphScene | null>(null);

  useEffect(() => {
    if (!data) return;
    const timer = setTimeout(() => {
      const previous = current.current ? positionsOf(current.current.model) : undefined;
      const model = buildGraphModel(data);
      const { simulation } = layoutGraph(model, { previous });
      const scene = new GraphScene(model, simulation);
      current.current = scene;
      setState({ scene, first: previous === undefined });
    }, 0);
    return () => clearTimeout(timer);
  }, [data]);

  return state;
}
