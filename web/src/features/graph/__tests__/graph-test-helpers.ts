/** Test helpers for the graph: a recording 2D context, response builders, a manual frame clock. */
import { vi } from 'vitest';
import type { GraphEdge, GraphGroup, GraphNode, GraphResponse } from '../../../lib/api/graph-types';
import { createSimulation, seededRandom } from '../graph-layout';
import { buildGraphModel } from '../graph-model';
import type { FrameScheduler } from '../graph-motion-clock';
import { GraphScene } from '../graph-scene';

// The web test project loads CSS as empty modules (also with `?raw`), so read files from disk.
const FS = 'node:fs';

/** Reads a file next to this folder (`../graph.css`, `../../../styles/tokens.css`). */
export async function readSourceFile(relative: string): Promise<string> {
  const fs = (await import(/* @vite-ignore */ FS)) as {
    readFileSync(path: URL, encoding: 'utf8'): string;
  };
  return fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
}

export interface CanvasCall {
  method: string;
  args: unknown[];
  fillStyle: string;
  strokeStyle: string;
  globalAlpha: number;
}

export interface RecordingContext {
  ctx: CanvasRenderingContext2D;
  calls: CanvasCall[];
}

const METHODS = [
  'setTransform',
  'fillRect',
  'beginPath',
  'moveTo',
  'lineTo',
  'arc',
  'stroke',
  'fill',
  'strokeText',
  'fillText',
] as const;

export interface RecordedPath {
  kind: 'fill' | 'stroke';
  style: string;
  alpha: number;
  arcs: { x: number; y: number; r: number }[];
  lines: number;
}

/** Groups recorded calls into paths: what was traced since `beginPath` and how it was painted. */
export function recordedPaths(calls: CanvasCall[]): RecordedPath[] {
  const paths: RecordedPath[] = [];
  let arcs: RecordedPath['arcs'] = [];
  let lines = 0;
  for (const call of calls) {
    if (call.method === 'beginPath') {
      arcs = [];
      lines = 0;
    } else if (call.method === 'arc') {
      const [x, y, r] = call.args as number[];
      arcs.push({ x: x ?? 0, y: y ?? 0, r: r ?? 0 });
    } else if (call.method === 'lineTo') lines++;
    else if (call.method === 'fill' || call.method === 'stroke') {
      const kind = call.method;
      const style = kind === 'fill' ? call.fillStyle : call.strokeStyle;
      paths.push({ kind, style, alpha: call.globalAlpha, arcs, lines });
    }
  }
  return paths;
}

/** Width of one character in the recording context's `measureText`. */
export const LABEL_CHAR_PX = 7;

/** A 2D context stand-in that records every call with the fill/stroke/alpha state at that time. */
export function recordingContext(): RecordingContext {
  const calls: CanvasCall[] = [];
  const state = {
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    lineWidth: 1,
    font: '',
    textBaseline: 'alphabetic',
    lineJoin: 'miter',
  };
  const ctx: Record<string, unknown> = state;
  // jsdom has no text metrics: 7 px per character, like a 12 px UI font.
  ctx.measureText = (text: string) => ({ width: Array.from(text).length * LABEL_CHAR_PX });
  for (const method of METHODS) {
    ctx[method] = (...args: unknown[]) => {
      calls.push({
        method,
        args,
        fillStyle: state.fillStyle,
        strokeStyle: state.strokeStyle,
        globalAlpha: state.globalAlpha,
      });
    };
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

/** Makes `canvas.getContext('2d')` return recording contexts (jsdom has no canvas). */
export function installCanvasMock(): { contexts: RecordingContext[] } {
  const contexts: RecordingContext[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
    const recorded = recordingContext();
    contexts.push(recorded);
    return recorded.ctx as never;
  });
  return { contexts };
}

export function graphNode(id: string, overrides: Partial<GraphNode> = {}): GraphNode {
  const title = id.slice(id.lastIndexOf('/') + 1).replace(/\.md$/i, '');
  const folder = id.split('/')[0] ?? '';
  const groups: Record<string, GraphGroup> = {
    '1 Projects': 'projects',
    '2 Areas': 'areas',
    '3 Resources': 'resources',
    wiki: 'wiki',
    Daily: 'daily',
  };
  return {
    id,
    title,
    kind: 'note',
    class: 'user',
    group: groups[folder] ?? 'other',
    degree: 0,
    orphan: true,
    ...overrides,
  };
}

/** Builds a response and fills `degree`/`orphan` from the edges, as the server does. */
export function graphResponse(nodes: GraphNode[], edges: [string, string][]): GraphResponse {
  const degree = new Map<string, Set<string>>();
  for (const [a, b] of edges) {
    if (!degree.has(a)) degree.set(a, new Set());
    if (!degree.has(b)) degree.set(b, new Set());
    degree.get(a)?.add(b);
    degree.get(b)?.add(a);
  }
  return {
    nodes: nodes.map((node) => {
      const count = degree.get(node.id)?.size ?? 0;
      return { ...node, degree: count, orphan: count === 0 };
    }),
    edges: edges.map(([source, target]): GraphEdge => ({ source, target })),
  };
}

/** A small vault: a hub with a project, a daily note and a linked PDF, a second area, an orphan. */
export const VAULT = {
  hub: '2 Areas/Giải tích 1.md',
  project: '1 Projects/Đồ án Giải tích.md',
  daily: 'Daily/2026-10-17.md',
  pdf: '3 Resources/papers/Newton 1687.pdf',
  other: '2 Areas/Xác suất.md',
  orphan: '0 Inbox/Mồ côi.md',
} as const;

export function vaultGraph(): GraphResponse {
  return graphResponse(
    [
      graphNode(VAULT.hub),
      graphNode(VAULT.project),
      graphNode(VAULT.daily),
      graphNode(VAULT.pdf, { kind: 'source', class: 'attachment' }),
      graphNode(VAULT.other),
      graphNode(VAULT.orphan),
    ],
    [
      [VAULT.project, VAULT.hub],
      [VAULT.daily, VAULT.hub],
      [VAULT.hub, VAULT.pdf],
      [VAULT.project, VAULT.other],
    ],
  );
}

/** A generated vault graph: `count` notes, `edgeCount` distinct links, hubs more likely. */
export function generatedGraph(count: number, edgeCount: number, seed = 7): GraphResponse {
  const random = seededRandom(seed);
  const folders = ['1 Projects', '2 Areas', '3 Resources', 'wiki', 'Daily', '0 Inbox'];
  const nodes = Array.from({ length: count }, (_, i) =>
    graphNode(`${folders[i % folders.length]}/Ghi chú ${i}.md`),
  );
  const seen = new Set<string>();
  const edges: [string, string][] = [];
  while (edges.length < edgeCount) {
    const a = Math.floor(random() * count);
    const b = Math.floor(random() * random() * count);
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (a === b || seen.has(key)) continue;
    seen.add(key);
    edges.push([nodes[a]?.id ?? '', nodes[b]?.id ?? '']);
  }
  return graphResponse(nodes, edges);
}

/**
 * A settled scene with known positions: node `i` sits at (`i` × `spacing`, 0) unless `place`
 * says otherwise, so tests can point at nodes exactly.
 */
export function staticScene(
  response: GraphResponse,
  place?: (index: number) => { x: number; y: number },
  spacing = 40,
): GraphScene {
  const model = buildGraphModel(response);
  model.nodes.forEach((node, i) => {
    const point = place?.(i) ?? { x: i * spacing, y: 0 };
    node.x = point.x;
    node.y = point.y;
  });
  const simulation = createSimulation(model).alpha(0);
  return new GraphScene(model, simulation);
}

/** Frames run only when the test says so: `flush(now)` runs the pending frame callbacks. */
export function manualScheduler(): FrameScheduler & {
  pending: () => number;
  flush: (now: number) => void;
} {
  let next = 1;
  const callbacks = new Map<number, (now: number) => void>();
  return {
    request: (callback) => {
      const handle = next++;
      callbacks.set(handle, callback);
      return handle;
    },
    cancel: (handle) => {
      callbacks.delete(handle);
    },
    pending: () => callbacks.size,
    flush: (now) => {
      const due = [...callbacks.values()];
      callbacks.clear();
      for (const callback of due) callback(now);
    },
  };
}
