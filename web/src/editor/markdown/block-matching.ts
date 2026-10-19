/**
 * Matches the current sibling nodes to the original ones. Equal nodes are paired in order (see
 * block-alignment: node identity first, then `eq()`), so an unchanged block is always written
 * from its original bytes, however far it is from an edit. Unmatched current nodes replace the
 * unmatched originals between the same two pairs one by one; an unmatched node equal to an
 * unused original elsewhere is a move.
 */
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { alignBlocks } from './block-alignment';

export type BlockMatch =
  /** Unchanged, at its original place in the sequence. */
  | { kind: 'same'; original: number }
  /** Unchanged content that moved: original bytes, but its surroundings changed. */
  | { kind: 'moved'; original: number }
  /** New or edited; `replaces` is the original it takes the place of, if any. */
  | { kind: 'changed'; replaces: number | null };

export function matchBlocks(
  current: readonly ProseMirrorNode[],
  original: readonly ProseMirrorNode[],
): BlockMatch[] {
  const paired = alignBlocks(current, original);
  const result: BlockMatch[] = new Array(current.length);
  const used = new Uint8Array(original.length);
  let runStart = 0;
  let previousOriginal = -1;
  for (let i = 0; i <= current.length; i += 1) {
    const j = i < current.length ? paired[i]! : original.length;
    if (j < 0) continue;
    // Unmatched nodes between two pairs replace the unmatched originals there, in order.
    for (let k = runStart; k < i; k += 1) {
      const replaced = previousOriginal + 1 + (k - runStart);
      result[k] = { kind: 'changed', replaces: replaced < j ? replaced : null };
    }
    if (i < current.length) {
      result[i] = { kind: 'same', original: j };
      used[j] = 1;
    }
    runStart = i + 1;
    previousOriginal = j;
  }
  detectMoves(result, current, original, used);
  return result;
}

/** Unmatched nodes equal to an unused original (same object first, else equal content). */
function detectMoves(
  result: BlockMatch[],
  current: readonly ProseMirrorNode[],
  original: readonly ProseMirrorNode[],
  used: Uint8Array,
): void {
  const unmatched = result.flatMap((match, i) => (match.kind === 'changed' ? [i] : []));
  if (unmatched.length === 0) return;
  const unused = new Map<ProseMirrorNode, number>();
  const byText = new Map<string, number[]>();
  original.forEach((node, j) => {
    if (used[j]) return;
    unused.set(node, j);
    const key = `${node.type.name}|${node.textContent}`;
    const candidates = byText.get(key);
    if (candidates) candidates.push(j);
    else byText.set(key, [j]);
  });
  for (const i of unmatched) {
    const node = current[i]!;
    let j = unused.get(node);
    if (j === undefined || used[j]) {
      const candidates = byText.get(`${node.type.name}|${node.textContent}`) ?? [];
      j = candidates.find((k) => !used[k] && node.eq(original[k]!));
    }
    if (j === undefined || used[j]) continue;
    result[i] = { kind: 'moved', original: j };
    used[j] = 1;
  }
}
