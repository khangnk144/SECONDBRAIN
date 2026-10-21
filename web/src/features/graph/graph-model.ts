/**
 * Pure graph model built from the API response: simulation nodes with their look (radius,
 * group, base opacity), deduplicated edges as typed arrays (the draw loop reads them without
 * allocating) and adjacency lists for highlights and the side panel.
 */
import type { SimulationNodeDatum } from 'd3-force';
import {
  GRAPH_GROUPS,
  type GraphGroup,
  type GraphNode,
  type GraphResponse,
} from '../../lib/api/graph-types';
import type { ContentClass } from '../../lib/api/vault-types';
import { foldText } from '../../lib/fold-text';
import { parentFolder, pathKey } from '../../lib/vault-paths';

/** Orphan notes are drawn at half opacity (SPEC F16.2). */
export const ORPHAN_ALPHA = 0.5;
/** Archived notes stay on the map, dimmed (SPEC §4.2). */
export const ARCHIVED_ALPHA = 0.55;
/** Source nodes (attachments, raw sources) are small hollow circles. */
export const SOURCE_RADIUS = 3;

/** SPEC F16: "4 px + log(links)"; natural log of 1 + degree so a lone note is exactly 4 px. */
export function nodeRadius(degree: number): number {
  return 4 + Math.log(1 + Math.max(0, degree));
}

export interface GraphModelNode extends SimulationNodeDatum {
  /** Position in `GraphModel.nodes` (d3 also writes `index`; this one never changes). */
  i: number;
  id: string;
  title: string;
  /** Parent folder of the file ('' at the vault root). */
  folder: string;
  kind: GraphNode['kind'];
  cls: ContentClass;
  group: GraphGroup;
  groupIndex: number;
  degree: number;
  orphan: boolean;
  archived: boolean;
  source: boolean;
  radius: number;
  /** Opacity before any highlight: orphans 50 %, archived dimmed. */
  baseAlpha: number;
  /** Folded title for diacritic-insensitive search. */
  searchText: string;
}

export interface GraphModel {
  nodes: GraphModelNode[];
  indexById: Map<string, number>;
  /** Edge `e` joins `nodes[edgeSource[e]]` and `nodes[edgeTarget[e]]`. */
  edgeSource: Int32Array;
  edgeTarget: Int32Array;
  /** Neighbour indices of each node, deduplicated. */
  neighbors: number[][];
  /** Groups that occur among the nodes, in legend order. */
  groups: GraphGroup[];
  hasSources: boolean;
  hasOrphans: boolean;
}

function groupOf(value: string): GraphGroup {
  return (GRAPH_GROUPS as readonly string[]).includes(value) ? (value as GraphGroup) : 'other';
}

function toModelNode(node: GraphNode, i: number): GraphModelNode {
  const group = groupOf(node.group);
  const source = node.kind === 'source';
  const degree = Number.isFinite(node.degree) && node.degree > 0 ? node.degree : 0;
  const archived = node.class === 'archived';
  const orphan = node.orphan === true;
  return {
    i,
    id: node.id,
    title: node.title,
    folder: parentFolder(node.id),
    kind: source ? 'source' : 'note',
    cls: node.class,
    group,
    groupIndex: GRAPH_GROUPS.indexOf(group),
    degree,
    orphan,
    archived,
    source,
    radius: source ? SOURCE_RADIUS : nodeRadius(degree),
    baseAlpha: (orphan ? ORPHAN_ALPHA : 1) * (archived ? ARCHIVED_ALPHA : 1),
    searchText: foldText(node.title),
  };
}

/**
 * Builds the model. Defensive about the input: a repeated node id keeps its first entry, and
 * edges that are self-links, repeat a pair (in either direction) or name an unknown id are dropped.
 */
export function buildGraphModel(response: GraphResponse): GraphModel {
  const nodes: GraphModelNode[] = [];
  const indexById = new Map<string, number>();
  for (const node of response.nodes) {
    if (indexById.has(node.id)) continue;
    indexById.set(node.id, nodes.length);
    nodes.push(toModelNode(node, nodes.length));
  }

  const count = nodes.length;
  const seen = new Set<number>();
  const sources: number[] = [];
  const targets: number[] = [];
  const neighbors: number[][] = nodes.map(() => []);
  for (const edge of response.edges) {
    const a = indexById.get(edge.source);
    const b = indexById.get(edge.target);
    if (a === undefined || b === undefined || a === b) continue;
    const key = Math.min(a, b) * count + Math.max(a, b);
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(a);
    targets.push(b);
    neighbors[a]?.push(b);
    neighbors[b]?.push(a);
  }

  const present = new Set(nodes.map((node) => node.group));
  return {
    nodes,
    indexById,
    edgeSource: Int32Array.from(sources),
    edgeTarget: Int32Array.from(targets),
    neighbors,
    groups: GRAPH_GROUPS.filter((group) => present.has(group)),
    hasSources: nodes.some((node) => node.source),
    hasOrphans: nodes.some((node) => node.orphan),
  };
}

/** Marks nodes not reached by a highlight. */
export const UNREACHED = -1;

/**
 * Breadth-first hop count from `start` up to `depth` (links followed both ways): `out[i]` is
 * 0 for the start, 1 for its neighbours, … and `UNREACHED` beyond `depth`. Reuses `out` when it
 * has the right length (the canvas recomputes this on every selection change).
 */
export function neighborLevels(
  model: GraphModel,
  start: number,
  depth: number,
  out?: Int8Array,
): Int8Array {
  const levels = out && out.length === model.nodes.length ? out : new Int8Array(model.nodes.length);
  levels.fill(UNREACHED);
  if (start < 0 || start >= model.nodes.length) return levels;
  levels[start] = 0;
  let frontier = [start];
  for (let level = 1; level <= depth && frontier.length > 0; level++) {
    const next: number[] = [];
    for (const index of frontier) {
      for (const neighbor of model.neighbors[index] ?? []) {
        if (levels[neighbor] !== UNREACHED) continue;
        levels[neighbor] = level;
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  return levels;
}

/**
 * Index of the node for a vault path (`?focus=`, the note of a local graph), tolerant of case
 * and Unicode normalization like every path comparison in the app; -1 when absent.
 */
export function indexOfPath(model: GraphModel, path: string): number {
  const exact = model.indexById.get(path);
  if (exact !== undefined) return exact;
  const key = pathKey(path);
  return model.nodes.findIndex((node) => pathKey(node.id) === key);
}

/** Nodes at exactly `level` hops, sorted by title (side panel, local graph list). */
export function nodesAtLevel(
  model: GraphModel,
  levels: Int8Array,
  level: number,
): GraphModelNode[] {
  return model.nodes
    .filter((node) => levels[node.i] === level)
    .sort((a, b) => a.title.localeCompare(b.title));
}
