/**
 * `GET /api/graph` and `GET /api/graph/local`, mirrored by hand from the server's graph route
 * (SPEC F16, F24, §4.2 graph column). The map filters on the client with the shared predicate
 * (`features/graph/graph-filter.ts`), so it never asks the API for `matches`.
 */
import type { ContentClass, VaultPath } from './vault-types';

/** Color group of a node: the note's first folder (`1 Projects` → projects, …). */
export type GraphGroup = 'projects' | 'areas' | 'resources' | 'wiki' | 'daily' | 'other';

/** Legend and color order. */
export const GRAPH_GROUPS: readonly GraphGroup[] = [
  'projects',
  'areas',
  'resources',
  'wiki',
  'daily',
  'other',
];

export interface GraphNode {
  /** The file's vault path. */
  id: VaultPath;
  title: string;
  /** `source`: an attachment or raw source linked from at least one note (hollow dot). */
  kind: 'note' | 'source';
  class: ContentClass;
  group: GraphGroup;
  /** Number of distinct neighbours. */
  degree: number;
  /** No link in or out (degree 0). */
  orphan: boolean;
  /** `GET /graph` only, notes: last modification (epoch ms). */
  mtimeMs?: number;
  /** `GET /graph` only, notes the app saw created: when (epoch ms). */
  createdMs?: number;
  /** `GET /graph` only: tags in normalized form (SPEC §4.14); empty for sources. */
  tags?: string[];
}

/** One per unordered pair of linked files; resolved links only, never a self-link. */
export interface GraphEdge {
  source: VaultPath;
  target: VaultPath;
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Only with filter parameters (`folder`, `group`, `tag`, `since`): ids of matching nodes. */
  matches?: string[];
}

/** Hops followed (both link directions) around the note in `GET /graph/local`. */
export type LocalGraphDepth = 1 | 2;
