/**
 * Pairs equal nodes of the current and the original sequence in order (a common subsequence),
 * however far apart the edits are:
 * 1. nodes the editor kept (the same object as in the snapshot) anchor the alignment; their
 *    longest increasing run is kept, so a moved node does not break it;
 * 2. between anchors, equal prefixes and suffixes are paired; the rest is compared by class ids
 *    (equal under `eq()`, see block-classes): an exact LCS when it is small, else a Myers diff
 *    while the edit distance stays small, else it is split at ids that occur once on each side
 *    (patience diff) and each part is aligned again. This also covers documents whose nodes
 *    lost their identity (rebuilt from JSON).
 */
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeClasses } from './block-classes';
import { lcsPairs, longestIncreasing, myersPairs, uniquePairs, type Pair } from './sequence-diff';

const LCS_LIMIT = 250_000;
const MYERS_MAX_DISTANCE = 512;

/** For each current index, the paired original index, or -1. */
export function alignBlocks(
  current: readonly ProseMirrorNode[],
  original: readonly ProseMirrorNode[],
): Int32Array {
  const paired = new Int32Array(current.length).fill(-1);
  const byIdentity = new Map<ProseMirrorNode, number>();
  original.forEach((node, j) => {
    if (!byIdentity.has(node)) byIdentity.set(node, j);
  });
  const taken = new Uint8Array(original.length);
  const pairs: Pair[] = [];
  current.forEach((node, i) => {
    const j = byIdentity.get(node);
    if (j !== undefined && !taken[j]) {
      taken[j] = 1;
      pairs.push([i, j]);
    }
  });
  const aligner = new Aligner(current, original, paired);
  aligner.between(longestIncreasing(pairs), 0, current.length, 0, original.length);
  return paired;
}

class Aligner {
  private readonly classes = new NodeClasses();

  constructor(
    private readonly current: readonly ProseMirrorNode[],
    private readonly original: readonly ProseMirrorNode[],
    private readonly paired: Int32Array,
  ) {}

  /** Pairs the anchors and aligns each stretch between them. */
  between(anchors: readonly Pair[], c0: number, c1: number, o0: number, o1: number): void {
    let i = c0;
    let j = o0;
    for (const [ai, aj] of anchors) {
      this.range(i, ai, j, aj);
      this.paired[ai] = aj;
      i = ai + 1;
      j = aj + 1;
    }
    this.range(i, c1, j, o1);
  }

  private range(c0: number, c1: number, o0: number, o1: number): void {
    const { paired } = this;
    while (c0 < c1 && o0 < o1 && this.equal(c0, o0)) paired[c0++] = o0++;
    while (c1 > c0 && o1 > o0 && this.equal(c1 - 1, o1 - 1)) paired[--c1] = --o1;
    if (c0 === c1 || o0 === o1) return;
    const a = this.classes.idsOf(this.current, c0, c1);
    const b = this.classes.idsOf(this.original, o0, o1);
    const pairs =
      a.length * b.length <= LCS_LIMIT ? lcsPairs(a, b) : myersPairs(a, b, MYERS_MAX_DISTANCE);
    if (pairs) {
      for (const [i, j] of pairs) paired[c0 + i] = o0 + j;
      return;
    }
    const anchors = longestIncreasing(uniquePairs(a, b));
    if (anchors.length === 0) return;
    this.between(
      anchors.map(([i, j]) => [c0 + i, o0 + j] as const),
      c0,
      c1,
      o0,
      o1,
    );
  }

  private equal(i: number, j: number): boolean {
    const a = this.current[i]!;
    const b = this.original[j]!;
    return a === b || this.classes.idOf(a) === this.classes.idOf(b);
  }
}
