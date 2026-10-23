/**
 * Scenes of past weeks for the time scrubber (SPEC F24.1). Nothing is laid out again: a node on
 * the live map keeps its live position (and drift phase), so changing week never makes the map
 * jump. A node only the history knows (deleted since, or no longer linked) gets one fixed spot
 * for every week: next to the live notes it was linked to, else on a ring just outside the map,
 * where design.md puts what is not connected.
 */
import type { GraphResponse } from '../../lib/api/graph-types';
import type { CompiledHistory } from './graph-history-model';
import { createSimulation, type Point } from './graph-layout';
import { buildGraphModel, type GraphModel } from './graph-model';
import { GraphScene } from './graph-scene';

/** Distance of a history-only node from the centre of its live neighbours. */
const NEIGHBOUR_OFFSET = 24;
/** Gap between the live map's outermost dot and the ring of unconnected history-only nodes. */
const RING_MARGIN = 60;

function hashAngle(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) / 4294967296) * Math.PI * 2;
}

/** One spot per id that is in the history but not on the live map. */
export function historyOnlyPositions(
  history: CompiledHistory,
  live: GraphModel,
): Map<string, Point> {
  let reach = 0;
  for (const node of live.nodes) reach = Math.max(reach, Math.hypot(node.x ?? 0, node.y ?? 0));
  const sums = new Map<number, { x: number; y: number; n: number }>();
  const add = (ghost: number, other: number) => {
    const id = history.ids[ghost] ?? '';
    const otherId = history.ids[other] ?? '';
    const liveIndex = live.indexById.get(otherId);
    if (live.indexById.has(id) || liveIndex === undefined) return;
    const node = live.nodes[liveIndex];
    const sum = sums.get(ghost) ?? { x: 0, y: 0, n: 0 };
    sum.x += node?.x ?? 0;
    sum.y += node?.y ?? 0;
    sum.n += 1;
    sums.set(ghost, sum);
  };
  for (let k = 0; k < history.edgeA.length; k++) {
    add(history.edgeA[k] ?? 0, history.edgeB[k] ?? 0);
    add(history.edgeB[k] ?? 0, history.edgeA[k] ?? 0);
  }
  const out = new Map<string, Point>();
  history.ids.forEach((id, i) => {
    if (live.indexById.has(id)) return;
    const angle = hashAngle(id);
    const sum = sums.get(i);
    if (sum && sum.n > 0) {
      out.set(id, {
        x: sum.x / sum.n + Math.cos(angle) * NEIGHBOUR_OFFSET,
        y: sum.y / sum.n + Math.sin(angle) * NEIGHBOUR_OFFSET,
      });
    } else {
      const radius = reach + RING_MARGIN;
      out.set(id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    }
  });
  return out;
}

/** A settled scene of `response` (a week's map) placed with the live scene's positions. */
export function buildWeekScene(
  response: GraphResponse,
  live: GraphScene,
  spots: ReadonlyMap<string, Point>,
): GraphScene {
  const model = buildGraphModel(response);
  const phaseIndex = new Int32Array(model.nodes.length);
  for (const node of model.nodes) {
    const liveIndex = live.model.indexById.get(node.id);
    const liveNode = liveIndex === undefined ? undefined : live.model.nodes[liveIndex];
    const spot = liveNode ? { x: liveNode.x ?? 0, y: liveNode.y ?? 0 } : spots.get(node.id);
    node.x = spot?.x ?? 0;
    node.y = spot?.y ?? 0;
    // A history-only node gets a phase index no live node has.
    phaseIndex[node.i] = liveIndex ?? live.model.nodes.length + node.i;
  }
  const simulation = createSimulation(model).alpha(0);
  return new GraphScene(model, simulation, { phaseIndex });
}
