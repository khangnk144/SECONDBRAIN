/** Selection on the brain map: shared by canvas clicks and the side panel. */
import type { VaultPath } from '../../lib/api/vault-types';
import { GRAPH_ROUTE } from '../../lib/app-navigation';
import { withQuery } from '../../lib/api/query-string';

export interface GraphSelection {
  id: string;
  /** Rings of neighbours highlighted around the node. */
  depth: 1 | 2;
}

/** A first click selects with its neighbours; a second click on the same node adds the next ring. */
export function nextSelection(current: GraphSelection | null, id: string): GraphSelection {
  if (current && current.id === id) return { id, depth: 2 };
  return { id, depth: 1 };
}

/** `/graph?focus=<path>`: opens the brain map with that node selected. */
export function graphRoute(focus?: VaultPath): string {
  return withQuery(GRAPH_ROUTE, { focus });
}
