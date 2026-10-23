/**
 * Which nodes and edges are emphasized, normal or dimmed, recomputed only when the hover or the
 * selection changes. Nodes are counting-sorted into draw buckets (kind × group × opacity) so the
 * draw loop fills one path per bucket instead of one per node, without allocating.
 */
import { GRAPH_GROUPS } from '../../lib/api/graph-types';
import { UNREACHED, type GraphModel } from './graph-model';

export const STATE_NORMAL = 0;
export const STATE_EMPHASIS = 1;
export const STATE_DIM = 2;
/** Not drawn by the normal passes (a node fading in when the time scrubber changes week). */
export const STATE_HIDDEN = 3;
/** design.md screen 6: everything outside the highlight sinks to 20 %. */
export const DIM_ALPHA = 0.2;
/** Labels drawn at once for a highlight (hover label always comes first). */
export const MAX_LABELS = 40;

const GROUPS = GRAPH_GROUPS.length;
/** Opacity classes: emphasis, then 4 base classes (orphan × archived) × normal/dim. */
export const ALPHA_CLASSES = 9;
export const BUCKETS = 2 * GROUPS * ALPHA_CLASSES;
/** Hidden nodes go to this extra bucket, which no draw pass reads. */
const HIDDEN_BUCKET = BUCKETS;

export interface HighlightInput {
  /** Hop counts from the selected node, or null without a selection. */
  levels: Int8Array | null;
  /** Nodes up to this many hops are lit (the signal lights the last ring when it arrives). */
  litDepth: number;
  /** Hovered node index or -1. */
  hover: number;
  /** A node always labelled (the note of a local graph) or -1. */
  pinnedLabel: number;
  /** Nodes "AI vừa chạm" lights (1 = lit): emphasized and named, whatever the selection. */
  touched?: Uint8Array | null;
  /**
   * Filter matches (1 = match) or null (F24.2): the other nodes sink to 20 % unless a hover, a
   * selection or "AI vừa chạm" lights them; an edge sinks when both its ends do.
   */
  filter?: Uint8Array | null;
  /** Nodes and edges left to the fade pass (1 = hidden here). */
  hiddenNodes?: Uint8Array | null;
  hiddenEdges?: Uint8Array | null;
}

export class GraphHighlight {
  readonly nodeState: Uint8Array;
  readonly nodeAlpha: Float32Array;
  readonly edgeState: Uint8Array;
  /** Node indices sorted by bucket; bucket `b` is `order[bucketStart[b] … bucketStart[b + 1])`. */
  readonly order: Int32Array;
  readonly bucketStart = new Int32Array(BUCKETS + 2);
  readonly bucketAlpha = new Float32Array(BUCKETS + 1);
  readonly labels = new Int32Array(MAX_LABELS);
  labelCount = 0;
  /** The first labels are always shown: the hovered node, the selected one, a pinned note. */
  forcedLabels = 0;
  /**
   * Every node, most links first (ties by title): the order in which names appear without a
   * hover as the view zooms in, so hubs such as course notes are named first.
   */
  readonly ambientOrder: Int32Array;
  /** True when some selection is active (the rest of the graph is dimmed). */
  dimming = false;
  private readonly hoverMark: Uint8Array;
  private readonly bucketOf: Int32Array;

  constructor(private readonly model: GraphModel) {
    const n = model.nodes.length;
    this.nodeState = new Uint8Array(n);
    this.nodeAlpha = new Float32Array(n);
    this.edgeState = new Uint8Array(model.edgeSource.length);
    this.order = new Int32Array(n);
    this.hoverMark = new Uint8Array(n);
    this.bucketOf = new Int32Array(n);
    this.ambientOrder = Int32Array.from(
      [...model.nodes]
        .sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title))
        .map((node) => node.i),
    );
  }

  /** Bucket = (source? 1 : 0, group, opacity class). */
  static bucketKey(source: boolean, groupIndex: number, alphaClass: number): number {
    return ((source ? 1 : 0) * GROUPS + groupIndex) * ALPHA_CLASSES + alphaClass;
  }

  update(input: HighlightInput): void {
    const { model } = this;
    const { levels, litDepth, hover } = input;
    this.hoverMark.fill(0);
    if (hover >= 0) {
      this.hoverMark[hover] = 1;
      for (const neighbor of model.neighbors[hover] ?? []) this.hoverMark[neighbor] = 1;
    }
    this.dimming = levels !== null;
    const touched = input.touched ?? null;
    const lit = (i: number) => {
      const level = levels?.[i] ?? UNREACHED;
      return level !== UNREACHED && level <= litDepth;
    };
    const isTouched = (i: number) => touched !== null && touched[i] === 1;
    const filter = input.filter ?? null;
    const filteredOut = (i: number) => filter !== null && filter[i] !== 1;
    const hidden = input.hiddenNodes ?? null;
    const hiddenEdges = input.hiddenEdges ?? null;

    this.bucketStart.fill(0);
    for (const node of model.nodes) {
      const i = node.i;
      let state: number;
      if (hidden !== null && hidden[i] === 1) state = STATE_HIDDEN;
      else if (isTouched(i)) state = STATE_EMPHASIS;
      else if (levels)
        state = lit(i) ? STATE_EMPHASIS : this.hoverMark[i] ? STATE_NORMAL : STATE_DIM;
      else state = this.hoverMark[i] ? STATE_EMPHASIS : STATE_NORMAL;
      if (state === STATE_NORMAL && filteredOut(i)) state = STATE_DIM;
      const baseClass = (node.orphan ? 1 : 0) + (node.archived ? 2 : 0);
      const alphaClass =
        state === STATE_EMPHASIS ? 0 : 1 + baseClass + (state === STATE_DIM ? 4 : 0);
      const alpha =
        state === STATE_EMPHASIS ? 1 : node.baseAlpha * (state === STATE_DIM ? DIM_ALPHA : 1);
      const bucket =
        state === STATE_HIDDEN
          ? HIDDEN_BUCKET
          : GraphHighlight.bucketKey(node.source, node.groupIndex, alphaClass);
      this.nodeState[i] = state;
      this.nodeAlpha[i] = alpha;
      this.bucketOf[i] = bucket;
      this.bucketAlpha[bucket] = alpha;
      this.bucketStart[bucket + 1] = (this.bucketStart[bucket + 1] ?? 0) + 1;
    }
    for (let b = 0; b <= BUCKETS; b++) {
      this.bucketStart[b + 1] = (this.bucketStart[b + 1] ?? 0) + (this.bucketStart[b] ?? 0);
    }
    const fill = this.bucketStart.slice(0, BUCKETS + 1);
    for (let i = 0; i < model.nodes.length; i++) {
      const bucket = this.bucketOf[i] ?? 0;
      this.order[fill[bucket] ?? 0] = i;
      fill[bucket] = (fill[bucket] ?? 0) + 1;
    }

    for (let e = 0; e < this.edgeState.length; e++) {
      const a = model.edgeSource[e] ?? 0;
      const b = model.edgeTarget[e] ?? 0;
      const touchesHover = hover >= 0 && (a === hover || b === hover);
      const bothTouched = isTouched(a) && isTouched(b);
      const isHidden =
        (hiddenEdges !== null && hiddenEdges[e] === 1) ||
        (hidden !== null && (hidden[a] === 1 || hidden[b] === 1));
      if (isHidden) this.edgeState[e] = STATE_HIDDEN;
      else if (touchesHover || bothTouched || (levels && lit(a) && lit(b))) {
        this.edgeState[e] = STATE_EMPHASIS;
      } else if (levels || (filteredOut(a) && filteredOut(b))) this.edgeState[e] = STATE_DIM;
      else this.edgeState[e] = STATE_NORMAL;
    }
    this.collectLabels(input, lit, filteredOut);
  }

  private collectLabels(
    input: HighlightInput,
    lit: (i: number) => boolean,
    filteredOut: (i: number) => boolean,
  ): void {
    const picked: number[] = [];
    const selected = input.levels ? input.levels.indexOf(0) : -1;
    for (const index of [input.hover, selected, input.pinnedLabel]) {
      if (index >= 0 && !picked.includes(index)) picked.push(index);
    }
    this.forcedLabels = picked.length;
    const touched = input.touched;
    if (touched) {
      for (const node of this.model.nodes) {
        if (touched[node.i] === 1 && !picked.includes(node.i)) picked.push(node.i);
      }
    }
    if (input.levels) {
      const levels = input.levels;
      const rest = this.model.nodes
        .filter((node) => lit(node.i) && !picked.includes(node.i))
        .sort((a, b) => (levels[a.i] ?? 0) - (levels[b.i] ?? 0) || b.degree - a.degree);
      for (const node of rest) picked.push(node.i);
    } else if (input.filter) {
      // A filter without a selection names its best-linked matches ("hôm nay": today's notes).
      const matches = this.model.nodes
        .filter((node) => !filteredOut(node.i) && !picked.includes(node.i))
        .sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title))
        .slice(0, MAX_LABELS);
      for (const node of matches) picked.push(node.i);
    }
    this.labelCount = Math.min(MAX_LABELS, picked.length);
    for (let k = 0; k < this.labelCount; k++) this.labels[k] = picked[k] ?? 0;
  }
}
