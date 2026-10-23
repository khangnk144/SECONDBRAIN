/**
 * The time scrubber's change of week without a layout jump (SPEC F24.1): positions come from the
 * live layout, so only presence changes. Nodes and edges that the new week adds are kept off the
 * normal passes (`hiddenNodes`/`hiddenEdges`) and fade in; those it removes are snapshotted from
 * the previous scene and fade out. Off under reduced motion, and skipped (an instant cut) when a
 * jump changes more than `MAX_FADE_NODES` nodes, so a frame never draws thousands one by one.
 */
import { EDGE_ALPHA, type FrameInput } from './graph-draw';
import { DIM_ALPHA } from './graph-highlight';
import { easeOutCubic } from './graph-motion';
import type { GraphScene } from './graph-scene';

export const FADE_MS = 250;
export const MAX_FADE_NODES = 1_500;
const NEXT_FRAME = -1;

interface Dots {
  x: Float32Array;
  y: Float32Array;
  r: Float32Array;
  alpha: Float32Array;
  group: Uint8Array;
  source: Uint8Array;
}

function pairKeys(scene: GraphScene): Set<string> {
  const { model } = scene;
  const keys = new Set<string>();
  for (let e = 0; e < model.edgeSource.length; e++) {
    const a = model.nodes[model.edgeSource[e] ?? 0]?.id ?? '';
    const b = model.nodes[model.edgeTarget[e] ?? 0]?.id ?? '';
    keys.add(a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
  }
  return keys;
}

export class GraphFade {
  readonly hiddenNodes: Uint8Array;
  readonly hiddenEdges: Uint8Array;
  /** 0 → 1 (eased) while running. */
  progress = 0;
  private start = NEXT_FRAME;
  private readonly enter: Int32Array;
  private readonly enterAlpha: Float32Array;
  private readonly enterEdges: Int32Array;
  private readonly leave: Dots;
  /** x1, y1, x2, y2 per edge that goes away. */
  private readonly leaveEdges: Float32Array;

  /** The fade from `prev` to `next`, or null when nothing changes or too much does. */
  static between(prev: GraphScene, next: GraphScene): GraphFade | null {
    const before = prev.model.indexById;
    const after = next.model.indexById;
    const enter = next.model.nodes.filter((node) => !before.has(node.id)).map((node) => node.i);
    const leave = prev.model.nodes.filter((node) => !after.has(node.id)).map((node) => node.i);
    if (enter.length + leave.length > MAX_FADE_NODES) return null;
    const prevPairs = pairKeys(prev);
    const nextPairs = pairKeys(next);
    if (enter.length + leave.length === 0 && prevPairs.size === nextPairs.size) {
      if ([...nextPairs].every((key) => prevPairs.has(key))) return null;
    }
    return new GraphFade(prev, next, enter, leave, prevPairs, nextPairs);
  }

  private constructor(
    prev: GraphScene,
    next: GraphScene,
    enter: number[],
    leave: number[],
    prevPairs: Set<string>,
    nextPairs: Set<string>,
  ) {
    const filter = next.filter;
    this.enter = Int32Array.from(enter);
    this.enterAlpha = Float32Array.from(enter, (i) => {
      const dim = filter !== null && filter[i] !== 1 ? DIM_ALPHA : 1;
      return (next.model.nodes[i]?.baseAlpha ?? 1) * dim;
    });
    this.hiddenNodes = new Uint8Array(next.model.nodes.length);
    for (const i of enter) this.hiddenNodes[i] = 1;
    const keyOf = (scene: GraphScene, e: number) => {
      const a = scene.model.nodes[scene.model.edgeSource[e] ?? 0]?.id ?? '';
      const b = scene.model.nodes[scene.model.edgeTarget[e] ?? 0]?.id ?? '';
      return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
    };
    this.hiddenEdges = new Uint8Array(next.model.edgeSource.length);
    const entering: number[] = [];
    for (let e = 0; e < next.model.edgeSource.length; e++) {
      if (prevPairs.has(keyOf(next, e))) continue;
      this.hiddenEdges[e] = 1;
      entering.push(e);
    }
    this.enterEdges = Int32Array.from(entering);
    const gone: number[] = [];
    for (let e = 0; e < prev.model.edgeSource.length; e++) {
      if (nextPairs.has(keyOf(prev, e))) continue;
      const a = prev.model.edgeSource[e] ?? 0;
      const b = prev.model.edgeTarget[e] ?? 0;
      gone.push(prev.px[a] ?? 0, prev.py[a] ?? 0, prev.px[b] ?? 0, prev.py[b] ?? 0);
    }
    this.leaveEdges = Float32Array.from(gone);
    this.leave = {
      x: Float32Array.from(leave, (i) => prev.px[i] ?? 0),
      y: Float32Array.from(leave, (i) => prev.py[i] ?? 0),
      r: Float32Array.from(leave, (i) => prev.radius[i] ?? 0),
      alpha: Float32Array.from(leave, (i) => prev.highlight.nodeAlpha[i] ?? 1),
      group: Uint8Array.from(leave, (i) => prev.model.nodes[i]?.groupIndex ?? 0),
      source: Uint8Array.from(leave, (i) => (prev.model.nodes[i]?.source ? 1 : 0)),
    };
  }

  /** Moves to the frame at `now`; returns false once the fade is over. */
  advance(now: number): boolean {
    if (this.start === NEXT_FRAME) this.start = now;
    const t = (now - this.start) / FADE_MS;
    this.progress = easeOutCubic(t);
    return t < 1;
  }

  /** Draws the fading dots and lines (over the normal passes, under the labels). */
  draw(ctx: CanvasRenderingContext2D, f: FrameInput): void {
    const t = this.progress;
    const { palette, view, model } = f;
    ctx.lineWidth = 1 / view.scale;
    ctx.strokeStyle = palette.edge;
    ctx.beginPath();
    for (const e of this.enterEdges) {
      const a = model.edgeSource[e] ?? 0;
      const b = model.edgeTarget[e] ?? 0;
      ctx.moveTo(f.px[a] ?? 0, f.py[a] ?? 0);
      ctx.lineTo(f.px[b] ?? 0, f.py[b] ?? 0);
    }
    ctx.globalAlpha = EDGE_ALPHA * t;
    ctx.stroke();
    ctx.beginPath();
    for (let k = 0; k + 3 < this.leaveEdges.length; k += 4) {
      ctx.moveTo(this.leaveEdges[k] ?? 0, this.leaveEdges[k + 1] ?? 0);
      ctx.lineTo(this.leaveEdges[k + 2] ?? 0, this.leaveEdges[k + 3] ?? 0);
    }
    ctx.globalAlpha = EDGE_ALPHA * (1 - t);
    ctx.stroke();
    this.enter.forEach((i, k) => {
      const node = model.nodes[i];
      if (!node) return;
      this.dot(ctx, f, palette.groups[node.groupIndex] ?? palette.edge, node.source, {
        x: f.px[i] ?? 0,
        y: f.py[i] ?? 0,
        r: f.radius[i] ?? 0,
        alpha: (this.enterAlpha[k] ?? 1) * t,
      });
    });
    const { leave } = this;
    for (let k = 0; k < leave.x.length; k++) {
      this.dot(ctx, f, palette.groups[leave.group[k] ?? 0] ?? palette.edge, leave.source[k] === 1, {
        x: leave.x[k] ?? 0,
        y: leave.y[k] ?? 0,
        r: leave.r[k] ?? 0,
        alpha: (leave.alpha[k] ?? 1) * (1 - t),
      });
    }
  }

  private dot(
    ctx: CanvasRenderingContext2D,
    f: FrameInput,
    color: string,
    hollow: boolean,
    d: { x: number; y: number; r: number; alpha: number },
  ): void {
    if (d.alpha <= 0) return;
    ctx.globalAlpha = d.alpha;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    if (hollow) {
      ctx.lineWidth = 1.25 / f.view.scale;
      ctx.strokeStyle = color;
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fill();
    }
  }
}

/**
 * A change of scene: the fade from `previous` (when `enabled`, e.g. a change of week with motion
 * allowed) or none; what fades in is hidden from the normal passes meanwhile.
 */
export function beginSceneFade(
  previous: GraphScene | null,
  next: GraphScene,
  enabled: boolean,
): GraphFade | null {
  const fade = enabled && previous && previous !== next ? GraphFade.between(previous, next) : null;
  previous?.setHidden(null, null);
  next.setHidden(fade?.hiddenNodes ?? null, fade?.hiddenEdges ?? null);
  return fade;
}

/** The fade still running at `now`, or null once over (everything is drawn normally again). */
export function stepSceneFade(
  fade: GraphFade | null,
  scene: GraphScene,
  now: number,
): GraphFade | null {
  if (!fade || fade.advance(now)) return fade;
  scene.setHidden(null, null);
  return null;
}
