/**
 * Force layout (d3-force): link + Barnes–Hut many-body + weak gravity toward the center, with a
 * light collide pass at the end. Positions are seeded from the node ids, so the same vault always
 * starts from the same picture. The initial layout runs synchronously before the first frame and
 * stops early when its time budget is spent; the canvas then finishes the remaining ticks live.
 */
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
} from 'd3-force';
import type { GraphModel, GraphModelNode } from './graph-model';

export type GraphLink = SimulationLinkDatum<GraphModelNode>;
export type GraphSimulation = Simulation<GraphModelNode, GraphLink>;

export interface Point {
  x: number;
  y: number;
}

/** Ticks of a full layout; alpha decays from 1 to `ALPHA_MIN` over them. */
export const LAYOUT_TICKS = 120;
/** The collide force (costly) only runs over the last ticks, once clusters have formed. */
export const COLLIDE_TICKS = 25;
/** SPEC §5 allows 3 s for 3,000 nodes; stopping at 2.5 s keeps a margin on slow machines. */
export const LAYOUT_BUDGET_MS = 2_500;
/** Ticks after a refresh that only added a few nodes (existing nodes are pinned meanwhile). */
const REFRESH_TICKS = 60;
const REFRESH_BUDGET_MS = 500;
const ALPHA_MIN = 0.001;
const LINK_DISTANCE = 30;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** FNV-1a: a small stable hash of a node id. */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic PRNG (mulberry32) so d3's jiggle does not depend on `Math.random`. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Gives every node a starting position: kept from `previous` when the id was already laid out,
 * next to an already placed neighbour for a new node, otherwise on a sunflower spiral ranked by
 * id (folders cluster because ids start with the folder). Returns the number of new nodes.
 */
export function seedPositions(model: GraphModel, previous?: ReadonlyMap<string, Point>): number {
  const placed = new Uint8Array(model.nodes.length);
  let fresh = 0;
  for (const node of model.nodes) {
    const old = previous?.get(node.id);
    node.vx = 0;
    node.vy = 0;
    node.fx = null;
    node.fy = null;
    if (old) {
      node.x = old.x;
      node.y = old.y;
      placed[node.i] = 1;
    } else fresh++;
  }
  const ranked = model.nodes.filter((node) => placed[node.i] === 0);
  ranked.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  ranked.forEach((node, rank) => {
    const hash = hashString(node.id);
    const anchor = (model.neighbors[node.i] ?? []).find((n) => placed[n] === 1);
    const anchorNode = anchor === undefined ? undefined : model.nodes[anchor];
    if (anchorNode && previous) {
      const angle = (hash / 4294967296) * 2 * Math.PI;
      node.x = (anchorNode.x ?? 0) + Math.cos(angle) * LINK_DISTANCE;
      node.y = (anchorNode.y ?? 0) + Math.sin(angle) * LINK_DISTANCE;
    } else {
      const radius = 10 * Math.sqrt(0.5 + rank);
      node.x = radius * Math.cos(rank * GOLDEN_ANGLE);
      node.y = radius * Math.sin(rank * GOLDEN_ANGLE);
    }
    placed[node.i] = 1;
  });
  return fresh;
}

export function createSimulation(model: GraphModel): GraphSimulation {
  const links: GraphLink[] = Array.from(model.edgeSource, (source, e) => ({
    source,
    target: model.edgeTarget[e] ?? source,
  }));
  return forceSimulation<GraphModelNode, GraphLink>(model.nodes)
    .stop()
    .randomSource(seededRandom(1))
    .alphaMin(ALPHA_MIN)
    .alphaDecay(1 - Math.pow(ALPHA_MIN, 1 / LAYOUT_TICKS))
    .force('link', forceLink<GraphModelNode, GraphLink>(links).distance(LINK_DISTANCE))
    .force('charge', forceManyBody<GraphModelNode>().strength(-30).theta(1.2))
    .force('x', forceX<GraphModelNode>(0).strength(0.04))
    .force('y', forceY<GraphModelNode>(0).strength(0.04));
}

/** Turns on the light collide pass (kept on for the rest of the simulation's life). */
function enableCollide(simulation: GraphSimulation): void {
  if (simulation.force('collide')) return;
  simulation.force(
    'collide',
    forceCollide<GraphModelNode>((node) => node.radius + 1)
      .strength(0.2)
      .iterations(1),
  );
}

/** True while the simulation still has heat left to settle. */
export function isSettling(simulation: GraphSimulation): boolean {
  return simulation.alpha() > simulation.alphaMin();
}

/** One live tick (the canvas calls this once per frame until the layout has settled). */
export function tickLive(simulation: GraphSimulation): void {
  enableCollide(simulation);
  simulation.tick();
}

export interface LayoutResult {
  simulation: GraphSimulation;
  /** Ticks run synchronously. */
  ticks: number;
  elapsedMs: number;
}

/** Runs ticks synchronously until settled, `maxTicks` or the time budget, whichever is first. */
function runTicks(simulation: GraphSimulation, maxTicks: number, budgetMs: number) {
  const start = performance.now();
  let ticks = 0;
  while (ticks < maxTicks && isSettling(simulation)) {
    const remaining =
      Math.log(simulation.alphaMin() / simulation.alpha()) / Math.log(1 - simulation.alphaDecay());
    if (remaining <= COLLIDE_TICKS) enableCollide(simulation);
    simulation.tick();
    ticks++;
    if (performance.now() - start >= budgetMs) break;
  }
  return { ticks, elapsedMs: performance.now() - start };
}

/**
 * Lays the model out. Without `previous` (first open) this is the full layout; with it (a refresh
 * after vault changes) existing nodes keep their positions and only new nodes find a place,
 * while the others stay pinned.
 */
export function layoutGraph(
  model: GraphModel,
  options: { previous?: ReadonlyMap<string, Point>; budgetMs?: number } = {},
): LayoutResult {
  const fresh = seedPositions(model, options.previous);
  const simulation = createSimulation(model);
  const incremental = options.previous !== undefined && options.previous.size > 0;
  if (!incremental) {
    const run = runTicks(simulation, LAYOUT_TICKS, options.budgetMs ?? LAYOUT_BUDGET_MS);
    return { simulation, ...run };
  }
  if (fresh === 0) {
    simulation.alpha(0);
    return { simulation, ticks: 0, elapsedMs: 0 };
  }
  const pinned = model.nodes.filter((node) => options.previous?.has(node.id));
  for (const node of pinned) {
    node.fx = node.x;
    node.fy = node.y;
  }
  simulation.alpha(0.3);
  const run = runTicks(simulation, REFRESH_TICKS, options.budgetMs ?? REFRESH_BUDGET_MS);
  for (const node of pinned) {
    node.fx = null;
    node.fy = null;
  }
  simulation.alpha(0);
  return { simulation, ...run };
}

/** Current positions by id, to carry over into the next layout after a refresh. */
export function positionsOf(model: GraphModel): Map<string, Point> {
  const out = new Map<string, Point>();
  for (const node of model.nodes) out.set(node.id, { x: node.x ?? 0, y: node.y ?? 0 });
  return out;
}

/** Finishes a layout synchronously (reduced motion and the static local graph never animate). */
export function settleNow(simulation: GraphSimulation, budgetMs = LAYOUT_BUDGET_MS): void {
  runTicks(simulation, LAYOUT_TICKS * 2, budgetMs);
  simulation.alpha(0);
}
