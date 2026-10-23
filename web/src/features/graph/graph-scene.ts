/**
 * Everything the canvas knows about one laid-out graph: drawn positions, hover, selection
 * (hop levels and how far the signal has lit them) and the hit-test index. No DOM here, so the
 * hover/click rules can be tested directly.
 */
import type { FrameInput } from './graph-draw';
import { GraphHighlight } from './graph-highlight';
import { HitGrid, findNearestLinear } from './graph-hit-grid';
import type { GraphSimulation } from './graph-layout';
import { neighborLevels, type GraphModel } from './graph-model';
import { driftOffsetX, driftOffsetY, driftPhase } from './graph-motion';
import type { GraphPalette } from './graph-palette';
import type { Viewport } from './graph-viewport';

export interface CanvasSize {
  /** CSS pixels. */
  width: number;
  height: number;
  dpr: number;
}

export interface SceneSelection {
  index: number;
  depth: 1 | 2;
}

export class GraphScene {
  readonly highlight: GraphHighlight;
  /** Drawn positions (world units) and radii, indexed like `model.nodes`. */
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly radius: Float32Array;
  hover = -1;
  selection: SceneSelection | null = null;
  levels: Int8Array | null = null;
  /** Rings lit so far; the signal lights `selection.depth` when it arrives. */
  litDepth = 0;
  /** The running signal goes from this level outward (-1: no signal). */
  signalFrom = -1;
  pinnedLabel = -1;
  /** Nodes lit by "AI vừa chạm" (1 = lit), or null; owned by the view's touch effects. */
  touched: Uint8Array | null = null;
  /** Filter matches (1 = match), or null without a filter: the rest is dimmed (F24.2). */
  filter: Uint8Array | null = null;
  /** Notes edited in the last 24 h (indices, by colour group), or null: they pulse (F24.3). */
  recent: Int32Array | null = null;
  /** Nodes and edges kept off the normal passes while they fade in (time scrubber). */
  hiddenNodes: Uint8Array | null = null;
  hiddenEdges: Uint8Array | null = null;
  private readonly baseX: Float32Array;
  private readonly baseY: Float32Array;
  private readonly phase: Float32Array;
  private readonly grid = new HitGrid();
  private gridStale = true;

  /**
   * `phaseIndex[i]`: the drift phase of node `i` (default `i`); the time scrubber's week scenes
   * pass the live node's index so a dot keeps swaying in step when the week changes.
   */
  constructor(
    readonly model: GraphModel,
    readonly simulation: GraphSimulation,
    options: { phaseIndex?: ArrayLike<number> } = {},
  ) {
    const n = model.nodes.length;
    this.highlight = new GraphHighlight(model);
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.radius = Float32Array.from(model.nodes, (node) => node.radius);
    this.baseX = new Float32Array(n);
    this.baseY = new Float32Array(n);
    const phaseIndex = options.phaseIndex;
    this.phase = Float32Array.from(model.nodes, (node) =>
      driftPhase(phaseIndex?.[node.i] ?? node.i),
    );
    this.refreshHighlight();
    this.computePositions(1, null, 1);
  }

  refreshHighlight(): void {
    this.highlight.update({
      levels: this.levels,
      litDepth: this.litDepth,
      hover: this.hover,
      pinnedLabel: this.pinnedLabel,
      touched: this.touched,
      filter: this.filter,
      hiddenNodes: this.hiddenNodes,
      hiddenEdges: this.hiddenEdges,
    });
  }

  setTouched(mask: Uint8Array | null): void {
    this.touched = mask;
    this.refreshHighlight();
  }

  /** A mask of another model's size is ignored (no filter). */
  setFilter(mask: Uint8Array | null): void {
    const fits = mask !== null && mask.length === this.model.nodes.length;
    const next = fits ? mask : null;
    if (next === this.filter) return;
    this.filter = next;
    this.refreshHighlight();
  }

  setRecent(indices: Int32Array | null): void {
    this.recent = indices;
  }

  setHidden(nodes: Uint8Array | null, edges: Uint8Array | null): void {
    if (nodes === this.hiddenNodes && edges === this.hiddenEdges) return;
    this.hiddenNodes = nodes;
    this.hiddenEdges = edges;
    this.refreshHighlight();
  }

  /** Returns true when the hovered node changed. */
  setHover(index: number): boolean {
    if (index === this.hover) return false;
    this.hover = index;
    this.refreshHighlight();
    return true;
  }

  /**
   * Selects a node (`index` -1 clears). With `animate`, the newly reached ring lights up only
   * when the signal arrives (`finishSignal`); otherwise everything lights at once.
   */
  select(index: number, depth: 1 | 2, animate: boolean): void {
    if (index < 0 || index >= this.model.nodes.length) {
      this.selection = null;
      this.levels = null;
      this.signalFrom = -1;
      this.litDepth = 0;
    } else {
      const previous = this.selection;
      const extends_ = previous !== null && previous.index === index && depth > previous.depth;
      this.levels = neighborLevels(this.model, index, depth, this.levels ?? undefined);
      this.selection = { index, depth };
      const from = extends_ ? previous.depth : 0;
      this.signalFrom = animate ? from : -1;
      this.litDepth = animate ? from : depth;
    }
    this.refreshHighlight();
  }

  finishSignal(): void {
    if (!this.selection) return;
    this.signalFrom = -1;
    this.litDepth = this.selection.depth;
    this.refreshHighlight();
  }

  /** Layout positions changed (tick, drag): the hit index is rebuilt on the next query. */
  markMoved(): void {
    this.gridStale = true;
  }

  /** Drawn = layout × intro expansion + drift (screen px converted to world units). */
  computePositions(intro: number, driftClock: number | null, scale: number): void {
    const nodes = this.model.nodes;
    const k = driftClock === null ? 0 : 1 / scale;
    const clock = driftClock ?? 0;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const x = node?.x ?? 0;
      const y = node?.y ?? 0;
      const phase = this.phase[i] ?? 0;
      this.px[i] = x * intro + (k === 0 ? 0 : driftOffsetX(clock, phase) * k);
      this.py[i] = y * intro + (k === 0 ? 0 : driftOffsetY(clock, phase) * k);
    }
  }

  /** The draw input for this scene; the view updates its per-frame fields in place. */
  frameInput(palette: GraphPalette, view: Viewport, size: CanvasSize): FrameInput {
    return {
      model: this.model,
      highlight: this.highlight,
      palette,
      labelFont: `500 12px ${palette.font}`,
      view,
      width: size.width,
      height: size.height,
      dpr: size.dpr,
      px: this.px,
      py: this.py,
      radius: this.radius,
      ring: -1,
      hover: -1,
      signalProgress: -1,
      signalFromLevel: 0,
      levels: null,
      ambientLabels: false,
      labelWidths: new Float32Array(this.model.nodes.length).fill(Number.NaN),
      labelMark: new Uint32Array(this.model.nodes.length),
      labelPass: 0,
      labelExclusions: [],
      touch: null,
      recent: null,
      pulse: -1,
      fade: null,
    };
  }

  /** Node under the world point (x, y) within `slack`, or -1. `linear` while the intro runs. */
  hitTest(x: number, y: number, slack: number, margin: number, linear: boolean): number {
    const n = this.model.nodes.length;
    if (linear) return findNearestLinear(x, y, slack, n, this.px, this.py, this.radius);
    if (this.gridStale) {
      this.model.nodes.forEach((node, i) => {
        this.baseX[i] = node.x ?? 0;
        this.baseY[i] = node.y ?? 0;
      });
      this.grid.build({ baseX: this.baseX, baseY: this.baseY, radius: this.radius, count: n });
      this.gridStale = false;
    }
    return this.grid.find(x, y, slack, margin, this.px, this.py, this.radius);
  }
}
