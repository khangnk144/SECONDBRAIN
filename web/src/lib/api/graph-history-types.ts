/**
 * `GET /api/graph/history` (SPEC F24.1), mirrored by hand from `server/src/graph/graph-history.ts`:
 * when each node and edge of the brain map existed. Instants are epoch ms; an entry without
 * `removedAt` still exists. An id appears once per lifetime (a note deleted and restored twice).
 */
import type { GraphGroup } from './graph-types';
import type { ContentClass, VaultPath } from './vault-types';

export interface GraphHistoryNode {
  /** Current path (a deleted note: the path it last had). */
  id: VaultPath;
  kind: 'note' | 'source';
  firstSeen: number;
  removedAt?: number;
  /** Only for ids not on the live map. */
  title?: string;
  group?: GraphGroup;
  class?: ContentClass;
}

export interface GraphHistoryEdge {
  /** The smaller id of the pair. */
  from: VaultPath;
  to: VaultPath;
  addedAt: number;
  removedAt?: number;
}

export interface GraphHistoryResponse {
  /** Monday (local `YYYY-MM-DD`) of the earliest event's week, null for an empty log. */
  firstWeek: string | null;
  /** Monday (local) of the current week. */
  currentWeek: string;
  /** Exact history starts here (epoch ms); before it, creation times are estimates. */
  exactSince: number | null;
  nodes: GraphHistoryNode[];
  edges: GraphHistoryEdge[];
}
