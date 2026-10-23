/**
 * What the brain map's filters and pulse read about each node (SPEC F24.2, F24.3), added to the
 * `GET /api/graph` payload: the note's index `mtime`, its tags in normalized form and, when the
 * event log saw it created exactly, its creation instant. Sources carry no facts (no edit time,
 * no tags). `buildGraph` itself stays as it is (MCP `graph_neighbors` uses it unchanged).
 */
import type { IndexService } from '../index/index-types.js';
import { graphFilterMatches, normalizeGraphTag, type GraphFilter } from './graph-filter.js';
import type { GraphNode, GraphView } from './vault-graph.js';

export interface GraphNodeWithFacts extends GraphNode {
  /** Notes: last modification (epoch ms). */
  mtimeMs?: number;
  /** Notes created while the app was watching: when (epoch ms). */
  createdMs?: number;
  /** Normalized tags (§4.14); empty for sources. */
  tags: string[];
}

export interface GraphResponseBody {
  nodes: GraphNodeWithFacts[];
  edges: GraphView['edges'];
  /** With a filter in the query: ids of the matching nodes (the client dims the others). */
  matches?: string[];
}

export function withNodeFacts(
  graph: GraphView,
  index: Pick<IndexService, 'listNotes' | 'noteTags' | 'noteTagsByPath'>,
  created: ReadonlyMap<string, number>,
): GraphResponseBody {
  const mtimes = new Map<string, number>();
  for (const note of index.listNotes()) mtimes.set(note.path, note.mtimeMs);
  // One query for every note's tags instead of one per node (5,000 on a big vault), and each
  // distinct tag normalized once (the same course tags repeat across hundreds of notes).
  const allTags = index.noteTagsByPath?.();
  const tagsOf = (path: string) => (allTags ? (allTags.get(path) ?? []) : index.noteTags(path));
  const normalized = new Map<string, string>();
  const normalize = (tag: string) => {
    let norm = normalized.get(tag);
    if (norm === undefined) normalized.set(tag, (norm = normalizeGraphTag(tag)));
    return norm;
  };
  const nodes = graph.nodes.map((node): GraphNodeWithFacts => {
    if (node.kind !== 'note') return { ...node, tags: [] };
    const tags = [...new Set(tagsOf(node.id).map(normalize))].filter(Boolean);
    const mtimeMs = mtimes.get(node.id);
    const createdMs = created.get(node.id);
    return {
      ...node,
      ...(mtimeMs === undefined ? {} : { mtimeMs }),
      ...(createdMs === undefined ? {} : { createdMs }),
      tags,
    };
  });
  return { nodes, edges: graph.edges };
}

/** Adds `matches` for an active filter (null: none asked). */
export function withMatches(
  body: GraphResponseBody,
  filter: GraphFilter | null,
): GraphResponseBody {
  return filter === null ? body : { ...body, matches: graphFilterMatches(filter, body.nodes) };
}
