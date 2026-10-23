/**
 * The brain graph (SPEC F16 Phase 1, §4.2 "Graph node" column): notes of the classes the table
 * draws (user, archived, wiki) plus source nodes for raw sources and attachments that at least
 * one of those notes links to. Edges are resolved links only (ghost and ambiguous links resolve
 * to nothing), one per unordered pair, never a self-link, both ends drawn.
 */
import {
  CLASS_RULES,
  classifyPath,
  noteTitleFromPath,
  topFolderOfPath,
} from '../markdown/content-classes.js';
import type { ContentClass } from '../markdown/markdown-types.js';
import type { GraphRows } from '../index/view-row-queries.js';
import type { VaultPath } from '../vault/vault-types.js';

export type GraphGroup = 'projects' | 'areas' | 'resources' | 'wiki' | 'daily' | 'other';

export interface GraphNode {
  id: VaultPath;
  title: string;
  kind: 'note' | 'source';
  class: ContentClass;
  /** Colour group by first folder. */
  group: GraphGroup;
  /** Number of distinct neighbours in the whole graph. */
  degree: number;
  orphan: boolean;
}

/** `source` is the linking note (the smaller path when the two link each other). */
export interface GraphEdge {
  source: VaultPath;
  target: VaultPath;
}

export interface GraphView {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const GROUPS: Readonly<Record<string, GraphGroup>> = {
  '1 projects': 'projects',
  '2 areas': 'areas',
  '3 resources': 'resources',
  wiki: 'wiki',
  daily: 'daily',
};

/** Colour group of a path by its first folder (also used for nodes only the history knows). */
export const groupOf = (path: VaultPath): GraphGroup =>
  GROUPS[topFolderOfPath(path).normalize('NFC').toLowerCase()] ?? 'other';

const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function node(id: VaultPath, title: string, kind: GraphNode['kind'], cls: ContentClass): GraphNode {
  return { id, title, kind, class: cls, group: groupOf(id), degree: 0, orphan: true };
}

export function buildGraph(rows: GraphRows): GraphView {
  const nodes = new Map<VaultPath, GraphNode>();
  const linkedOnly = new Map<VaultPath, { title: string; class: ContentClass }>();
  for (const note of rows.notes) {
    const rule = CLASS_RULES[note.class].graphNode;
    if (rule === 'yes' || rule === 'dimmed') {
      nodes.set(note.path, node(note.path, note.title, 'note', note.class));
    } else if (rule === 'linked-only') {
      linkedOnly.set(note.path, { title: note.title, class: note.class });
    }
  }
  for (const file of rows.files) {
    const cls = classifyPath(file);
    if (CLASS_RULES[cls].graphNode === 'linked-only') {
      linkedOnly.set(file, { title: noteTitleFromPath(file), class: cls });
    }
  }
  // A source becomes a node only through a link from a drawn note (not from another source).
  const notes = new Set(nodes.keys());
  for (const { from, to } of rows.links) {
    const source = notes.has(from) && !nodes.has(to) ? linkedOnly.get(to) : undefined;
    if (source) nodes.set(to, node(to, source.title, 'source', source.class));
  }
  const pairs = new Map<string, GraphEdge>();
  for (const { from, to } of rows.links) {
    if (from === to || !nodes.has(from) || !nodes.has(to)) continue;
    const key = from < to ? `${from}\u0000${to}` : `${to}\u0000${from}`;
    const existing = pairs.get(key);
    if (!existing) pairs.set(key, { source: from, target: to });
    else if (existing.source !== from && from < to) pairs.set(key, { source: from, target: to });
  }
  const edges = [...pairs.values()];
  for (const { source, target } of edges) {
    nodes.get(source)!.degree += 1;
    nodes.get(target)!.degree += 1;
  }
  for (const n of nodes.values()) n.orphan = n.degree === 0;
  return {
    nodes: [...nodes.values()].sort((a, b) => byPath(a.id, b.id)),
    edges: edges.sort((a, b) => byPath(a.source, b.source) || byPath(a.target, b.target)),
  };
}

/**
 * The part of `graph` within `depth` hops of `center` (links followed both ways), center
 * included; nodes keep their whole-graph degree so sizes match the full graph. Empty when
 * `center` is not drawn in the graph at all.
 */
export function localGraph(graph: GraphView, center: VaultPath, depth: number): GraphView {
  if (!graph.nodes.some((n) => n.id === center)) return { nodes: [], edges: [] };
  const neighbours = new Map<VaultPath, VaultPath[]>();
  const add = (a: VaultPath, b: VaultPath) => {
    const list = neighbours.get(a);
    if (list) list.push(b);
    else neighbours.set(a, [b]);
  };
  for (const { source, target } of graph.edges) {
    add(source, target);
    add(target, source);
  }
  const reached = new Set([center]);
  let frontier = [center];
  for (let hop = 0; hop < depth; hop += 1) {
    frontier = frontier.flatMap((id) => (neighbours.get(id) ?? []).filter((n) => !reached.has(n)));
    for (const id of frontier) reached.add(id);
  }
  return {
    nodes: graph.nodes.filter((n) => reached.has(n.id)),
    edges: graph.edges.filter((e) => reached.has(e.source) && reached.has(e.target)),
  };
}
