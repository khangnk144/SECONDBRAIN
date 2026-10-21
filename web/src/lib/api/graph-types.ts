/**
 * `GET /api/graph` and `GET /api/graph/local`, mirrored by hand from the server's graph route
 * (SPEC F16, §4.2 graph column). Filters (folder, tag, since) arrive in Phase 2.
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
}

/** One per unordered pair of linked files; resolved links only, never a self-link. */
export interface GraphEdge {
  source: VaultPath;
  target: VaultPath;
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Hops followed (both link directions) around the note in `GET /graph/local`. */
export type LocalGraphDepth = 1 | 2;
