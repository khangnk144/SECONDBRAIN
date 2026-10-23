/**
 * Where the dots of the "Não hôm nay" mini map sit: a deterministic layout (no physics, no
 * motion) seeded by each note's path, so the same notes always draw the same picture. Nodes come
 * most connected first; the first sits near the middle, each next one takes the spot (out of a
 * few seeded candidates) farthest from the dots already placed. Dots grow with their links.
 */
import type { TodayBrain, TodayBrainNode } from '../../lib/api/deadlines-types';

export interface PlacedNode extends TodayBrainNode {
  x: number;
  y: number;
  r: number;
}

export interface PlacedEdge {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface BrainLayout {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
}

export interface BrainLayoutBox {
  width: number;
  height: number;
  /** Smallest and largest dot radius. */
  minR: number;
  maxR: number;
  /** At most this many dots (the most connected ones). */
  limit: number;
}

const CANDIDATES = 14;

/** FNV-1a of the path: the seed of its candidate spots. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, deterministic. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (value: number) => Math.round(value * 10) / 10;

export function layoutBrain(
  brain: Pick<TodayBrain, 'nodes' | 'edges'>,
  box: BrainLayoutBox,
): BrainLayout {
  const nodes = brain.nodes.slice(0, box.limit);
  const shown = new Set(nodes.map((node) => node.path));
  const edges = brain.edges.filter((edge) => shown.has(edge.from) && shown.has(edge.to));
  const degree = new Map<string, number>();
  for (const { from, to } of edges) {
    degree.set(from, (degree.get(from) ?? 0) + 1);
    degree.set(to, (degree.get(to) ?? 0) + 1);
  }
  const maxDegree = Math.max(1, ...degree.values());
  const placed: PlacedNode[] = [];
  for (const [index, node] of nodes.entries()) {
    const r = box.minR + ((box.maxR - box.minR) * (degree.get(node.path) ?? 0)) / maxDegree;
    const next = random(hash(node.path));
    // The first dot near the middle; the others anywhere inside, away from the edge.
    const spread = index === 0 ? 0.3 : 1;
    let best = { x: box.width / 2, y: box.height / 2, score: -1 };
    for (let i = 0; i < CANDIDATES; i += 1) {
      const x = box.width / 2 + (next() - 0.5) * spread * (box.width - 2 * box.maxR - 4);
      const y = box.height / 2 + (next() - 0.5) * spread * (box.height - 2 * box.maxR - 4);
      const score =
        placed.length === 0
          ? 0
          : Math.min(...placed.map((p) => Math.hypot(p.x - x, p.y - y) - p.r));
      if (score > best.score) best = { x, y, score };
    }
    placed.push({ ...node, x: round(best.x), y: round(best.y), r: round(r) });
  }
  const at = new Map(placed.map((node) => [node.path, node]));
  return {
    nodes: placed,
    edges: edges.map(({ from, to }) => {
      const a = at.get(from)!;
      const b = at.get(to)!;
      return { key: `${from}\n${to}`, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    }),
  };
}
